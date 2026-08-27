-- El tope de pases por usuario y ventana pasa a imponerse en la BASE.
--
-- Hasta ahora lo contaba solo la Edge Function `emitir-pase`, y por debajo
-- `authenticated` tiene grant de `insert` con políticas de emisión para admin y
-- supervisor: quien podía emitir podía saltarse el tope insertando directo por
-- PostgREST. No permitía fabricar un pase utilizable —el código se canjea contra
-- su HMAC y el secreto vive solo en la función— pero sí llenar la ventana de un
-- usuario con filas basura y dejarlo sin poder recibir un pase legítimo. Justo el
-- escenario para el que el pase existe.
--
-- Es la versión de escritura de la regla que este proyecto ya tiene escrita: si
-- una regla solo vive en la función, el mismo write por PostgREST se la salta.
--
-- Y de paso cierra una carrera: entre el `select count(*)` de la función y su
-- `insert` cabían dos emisiones simultáneas que pasaban las dos.

create function app.pase_tope_por_ventana()
returns trigger
language plpgsql
-- `security definer`: el conteo tiene que ver TODAS las filas del usuario
-- objetivo, no solo las que la RLS le deje ver a quien inserta. Si contara con
-- los ojos del llamante, un emisor con visibilidad parcial creería que hay cupo.
security definer
set search_path = ''
as $$
declare
  -- El tope y la ventana viven AQUÍ Y EN NINGÚN OTRO SITIO. La Edge Function ya
  -- no cuenta: inserta y traduce el rechazo de este trigger a su 429. Dos
  -- definiciones del mismo número divergen, y la que se salta el rodeo es esta.
  c_limite  constant integer  := 3;
  c_ventana constant interval := interval '24 hours';
  v_emitidos integer;
begin
  -- Un pase "generado" en el futuro no existe todavía, y aceptarlo dejaría
  -- RESERVAR bloqueos con fecha: como la ventana se mide contra la propia fila,
  -- una fila futura no gasta cupo hoy —así que entra sin levantar sospecha— pero
  -- lo gastará cuando el reloj llegue. Un bloqueo programado e invisible hasta
  -- que cae. Antedatar sí se permite: lo necesitan el seed y los tests, y una
  -- fila vieja no le quita el cupo a nadie.
  --
  -- `check_violation` y no el código del tope: esto no es "te pasaste del
  -- límite", es una fila mal formada, y la función tiene que traducirlo a 500 y
  -- no a 429.
  if new.generado_at > pg_catalog.now() then
    raise exception 'un pase no se puede fechar en el futuro'
      using errcode = 'check_violation';
  end if;

  -- Y antedatar no abre la puerta por atrás, aunque a primera vista lo parezca:
  -- espaciando fechas viejas más de 24 h cada fila ve su ventana vacía y entra,
  -- así que se pueden crear más de tres. Pero nacen CADUCADAS y son inertes, y
  -- eso no lo decide este trigger sino el CHECK que ya existía:
  --
  --   check (expira_at <= generado_at + interval '15 minutes')
  --
  -- La banda en la que una fila antedatada sigue siendo canjeable son los
  -- últimos 15 minutos — y esas ventanas solapan la de hoy, así que cuentan y
  -- topan. Medido: cinco filas antedatadas 48 h entran, y ninguna queda vigente.
  --
  -- Se apoya en ese CHECK a propósito, en vez de repetir la regla aquí: si
  -- alguien lo relaja, este comentario es el que dice qué se llevó por delante.

  -- Serializa por usuario OBJETIVO. Sin esto, dos inserciones simultáneas leen
  -- las dos "hay cupo" y entran las dos: contar y luego insertar no es atómico
  -- ni dentro de un trigger. El candado es de transacción, así que se suelta
  -- solo al terminar, y solo bloquea a quien emite para el MISMO usuario.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtext('pase_acceso_temporal'),
    pg_catalog.hashtext(new.profile_id::text)
  );

  -- Cuenta TODOS los emitidos en la ventana, revocados incluidos: el tope es
  -- sobre cuántos se han generado, no sobre cuántos siguen vivos. Contar solo
  -- los vivos lo volvía reiniciable — se emiten tres, se revocan dos y se emiten
  -- dos más.
  select count(*)
    into v_emitidos
    from public.pase_acceso_temporal p
   where p.profile_id = new.profile_id
     -- La ventana se mide contra la PROPIA fila, no contra `now()`. Importa
     -- porque `authenticated` puede fijar `generado_at`: con `now()`, una fila
     -- antedatada —que cae FUERA de la ventana y por tanto no le quita el cupo a
     -- nadie— se rechazaba igual solo porque la ventana de hoy estuviera llena.
     -- Y no abre evasión: para bloquear a un usuario hay que meter filas DENTRO
     -- de su ventana actual, y esas se cuentan igual.
     and p.generado_at >  new.generado_at - c_ventana
     and p.generado_at <= new.generado_at;

  if v_emitidos >= c_limite then
    -- `configuration_limit_exceeded` y no `check_violation`: la función tiene
    -- que distinguir "se pasó del tope" (429) de cualquier otro rechazo de la
    -- tabla (500), y hacerlo por el texto del mensaje sería frágil.
    raise exception 'límite diario de pases alcanzado para este usuario'
      using errcode = 'configuration_limit_exceeded';
  end if;

  return new;
end;
$$;

revoke execute on function app.pase_tope_por_ventana() from public;

create trigger pase_tope_por_ventana
  before insert on public.pase_acceso_temporal
  for each row execute function app.pase_tope_por_ventana();

comment on function app.pase_tope_por_ventana() is
  'Impone el tope de pases por usuario y ventana en la base, para que no se pueda rodear insertando por PostgREST. Cuenta también los revocados y serializa por usuario objetivo con un candado de transacción.';
