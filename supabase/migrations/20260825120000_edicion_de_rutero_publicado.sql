-- Corregir un rutero YA PUBLICADO sin tirar el día entero.
--
-- Hoy, para quitar UNA tienda mal puesta de un rutero publicado hay que borrar el
-- rutero completo: el trigger corta cualquier cambio de la planeación y la única
-- salida es la cascada. Una tienda de más cuesta el día entero.
--
-- Lo que se abre es UNA ventana estrecha, no la regla: se puede quitar una parada
-- y reordenar las que quedan, en `publicado`, mientras esa parada no tenga visita
-- y el día no haya pasado. Todo lo demás sigue como estaba — añadir una tienda a
-- un rutero publicado se sigue rechazando, y cambiarle la tienda a una parada
-- existente también (sería sustituir el destino sin dejar rastro).
--
-- Lo que NO se toca, y conviene decir por qué: `fijar_hora_parada` sigue
-- rechazando fuera de borrador. Su comentario explica que la hora es la vara con
-- la que se mide la puntualidad del mercaderista, y que moverla después de ver a
-- qué hora fichó no es planificar sino fabricar el resultado. Esa verja se queda;
-- lo que aporta este cambio es un sitio donde EXPLICARLA en vez de esconder el
-- campo.

-- ---------------------------------------------------------------------------
-- 1. El rastro de auditoría
--
-- Una fila borrada no puede llevar encima quién la borró, que es como el resto
-- del proyecto audita (`solicitud_cambio_ruta.resuelta_por`,
-- `pase_acceso_temporal.generado_por`). Así que el rastro va a una tabla aparte.
--
-- Y SIN clave foránea a `rutero`, a propósito: `rutero_parada` cuelga de `rutero`
-- con `on delete cascade`, de modo que una FK aquí se llevaría por delante el
-- registro de auditoría justo cuando se borra lo que audita. Un rastro que
-- desaparece con su objeto no es un rastro.
--
-- Las columnas de contexto (`fecha`, `mercaderista_id`, `orden`,
-- `hora_planificada`, `estado_rutero`) van desnormalizadas por lo mismo: son el
-- estado en el INSTANTE del retiro, y el rutero puede desaparecer después.
-- ---------------------------------------------------------------------------
create table public.rutero_parada_retirada (
  id               uuid primary key default gen_random_uuid(),
  tenant_id        uuid not null references public.tenant (id) on delete restrict,
  rutero_id        uuid not null,
  fecha            date not null,
  mercaderista_id  uuid not null references public.profile (id) on delete restrict,
  tienda_id        uuid not null,
  orden            integer not null,
  hora_planificada time,
  estado_rutero    public.estado_rutero not null,
  retirada_por     uuid not null references public.profile (id) on delete restrict,
  retirada_at      timestamptz not null default now(),
  -- Nullable: el criterio pide saber QUIÉN quitó QUÉ, no por qué. La columna
  -- queda lista por si se decide exigirlo, sin migración de datos.
  motivo           text check (motivo is null or length(btrim(motivo)) > 0),

  constraint retirada_tienda_fk foreign key (tienda_id, tenant_id)
    references public.tienda (id, tenant_id) on delete restrict
);

create index rutero_parada_retirada_tenant_idx
  on public.rutero_parada_retirada (tenant_id, retirada_at desc);
create index rutero_parada_retirada_rutero_idx
  on public.rutero_parada_retirada (rutero_id);

comment on table public.rutero_parada_retirada is
  'Quién quitó qué parada de qué rutero, y en qué estado estaba el rutero al hacerlo. Sin FK a `rutero` a propósito: la cascada del rutero se llevaría el rastro de lo que audita. Solo la escribe `public.quitar_parada_rutero`.';

alter table public.rutero_parada_retirada enable row level security;

-- El staff la lee; nadie la escribe desde la app. El GRANT es la puerta y aquí
-- solo abre `select`: la única escritora es la función `security definer` de más
-- abajo, así que una fila de auditoría no se puede forjar ni borrar con un JWT.
create policy retirada_staff_lee on public.rutero_parada_retirada
  for select to authenticated
  using ((select app.es_staff()));

grant select on public.rutero_parada_retirada to authenticated;
grant all    on public.rutero_parada_retirada to service_role;

-- ---------------------------------------------------------------------------
-- 2. El trigger se relaja SOLO para `publicado`, y solo para quitar y reordenar
--
-- `estado_rutero` tiene cuatro valores, no dos: la regla no puede ser «borrador
-- contra el resto». En `en_curso` el mercaderista está en la calle con la ruta
-- replicada en el teléfono; en `completado` sería reescribir historia que los
-- informes y el Perfect Merchandiser dan por cerrada.
--
-- El SQLSTATE pasa a `55000` (`object_not_in_prerequisite_state`) en vez del
-- genérico: «este rutero ya no admite cambios» no es «no tienes permiso», y la
-- acción de servidor necesita distinguirlos para dar dos mensajes distintos. El
-- texto conserva «ya salió del borrador» — hay tests que lo fijan.
-- ---------------------------------------------------------------------------
create or replace function public.parada_solo_se_planifica_en_borrador()
returns trigger
language plpgsql
-- `definer`: si la RLS del que llama no le dejara ver la fila de `rutero`, el
-- `select` de abajo no encontraría nada y el guard se abriría en vez de cerrarse.
security definer
set search_path = ''
as $$
declare
  v_rutero uuid := coalesce(new.rutero_id, old.rutero_id);
  v_estado public.estado_rutero;
begin
  -- Un UPDATE que no toca la FORMA de la planeación pasa siempre. `estado` avanza
  -- con la jornada, y `hora_planificada` tiene su propia RPC con su propia regla.
  if tg_op = 'UPDATE'
     and new.rutero_id is not distinct from old.rutero_id
     and new.tienda_id is not distinct from old.tienda_id
     and new.orden is not distinct from old.orden
  then
    return new;
  end if;

  select estado into v_estado from public.rutero where id = v_rutero;

  -- Sin fila padre es un borrado en cascada del rutero entero: no es replanificar.
  if not found then
    return coalesce(new, old);
  end if;

  if v_estado = 'borrador' then
    return coalesce(new, old);
  end if;

  -- La ventana nueva. Un INSERT cae fuera a propósito: colgar una tienda nueva de
  -- un rutero publicado es el caso simétrico y no se pidió. Un UPDATE de
  -- `tienda_id` también: cambiarle el destino a una parada existente sustituiría
  -- la tienda sin dejar rastro, que es justo lo que la auditoría viene a evitar.
  --
  -- Y esto NO sustituye a la verja de la visita: esa la pone
  -- `visita_parada_fk ... on delete restrict`, más abajo que este trigger.
  if v_estado = 'publicado'
     and (
       tg_op = 'DELETE'
       or (tg_op = 'UPDATE'
           and new.rutero_id is not distinct from old.rutero_id
           and new.tienda_id is not distinct from old.tienda_id)
     )
  then
    return coalesce(new, old);
  end if;

  raise exception
    'La planeación de un rutero % no se modifica: ya salió del borrador', v_estado
    using errcode = '55000';
end;
$$;

revoke execute on function public.parada_solo_se_planifica_en_borrador() from public;

-- ---------------------------------------------------------------------------
-- 3. Reordenar acepta `publicado`
--
-- Y se lee el estado con `for update`: entre comprobarlo y renumerar, otra sesión
-- puede publicar o avanzar el rutero. El bloqueo sostiene la comprobación hasta
-- el commit; sin él la comprobación es una foto vieja.
-- ---------------------------------------------------------------------------
create or replace function public.reordenar_paradas(p_rutero_id uuid, p_paradas uuid[])
returns void
language plpgsql
set search_path = ''
as $$
declare
  v_estado public.estado_rutero;
begin
  -- La lista tiene que ser EXACTAMENTE el conjunto de paradas del rutero. Comparar
  -- solo el tamaño no basta: `[a,a,c]` sobre las paradas {a,b,c} mide 3 igual que
  -- {a,b,c}, pero dejaría a `b` sin renumerar y a `a` con un orden indeterminado
  -- (el `update ... from` casa dos filas contra el mismo destino).
  if exists (
    select id from public.rutero_parada where rutero_id = p_rutero_id
    except
    select unnest(p_paradas)
  ) or exists (
    select unnest(p_paradas)
    except
    select id from public.rutero_parada where rutero_id = p_rutero_id
  ) or coalesce(array_length(p_paradas, 1), 0) <> (
    select count(distinct u) from unnest(p_paradas) u
  )
  then
    raise exception 'La lista debe incluir todas las paradas del rutero, una sola vez cada una';
  end if;

  select estado into v_estado from public.rutero where id = p_rutero_id for update;

  -- Un rutero EN CURSO le cambiaría el orden de las tiendas al mercaderista a
  -- media jornada, con la réplica ya en el teléfono. Uno COMPLETADO reescribiría
  -- el histórico. Publicado sí: el día todavía no ha arrancado.
  if v_estado is null or v_estado not in ('borrador', 'publicado') then
    raise exception
      'Solo se reordena un rutero en borrador o publicado: este ya salió del borrador (%)', v_estado
      using errcode = '55000';
  end if;

  -- Un solo `update`: la clave natural `(rutero_id, orden)` es `deferrable
  -- initially immediate`, así que la comprobación cae al final de la SENTENCIA y
  -- un intercambio no choca a mitad de camino.
  update public.rutero_parada rp
  set orden = nueva.posicion
  from (
    select id, ordinality::integer as posicion
    from unnest(p_paradas) with ordinality as u(id, ordinality)
  ) as nueva
  where rp.id = nueva.id and rp.rutero_id = p_rutero_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- 4. Quitar una parada, con su rastro
--
-- Pasa a ser una RPC en vez de un `delete` por PostgREST porque hacen falta tres
-- cosas en la MISMA transacción: comprobar el estado con bloqueo, escribir la
-- auditoría y borrar. Con el delete suelto, la auditoría sería una escritura
-- aparte que puede quedarse sin su borrado (o al revés).
--
-- Los dos guardarraíles que el trigger no da:
--
--   · la VISITA — `visita_parada_fk` es una verja dura por debajo del trigger,
--     pero levanta un error de FK crudo; aquí se comprueba antes para poder dar
--     un mensaje que se entienda.
--   · el DÍA PASADO — y este no es cosmético. `rutero.estado` no sale nunca de
--     `publicado` (nada en el repo lo avanza), así que «solo en publicado»
--     incluye el rutero de hace tres meses. Y `puntualidad_paradas` cuenta las
--     paradas de todo rutero distinto de borrador: borrar una parada de un día
--     pasado borra un `falto` y sube el bono del periodo abierto. `cerrado_at`
--     protege los periodos ya sellados, no el mes en curso.
-- ---------------------------------------------------------------------------
create function public.quitar_parada_rutero(
  p_parada uuid,
  p_motivo text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_parada public.rutero_parada%rowtype;
  v_rutero public.rutero%rowtype;
begin
  if not app.es_staff() then
    raise exception 'solo el staff diseña ruteros' using errcode = '42501';
  end if;

  select * into v_parada from public.rutero_parada where id = p_parada;
  if not found then
    raise exception 'la parada % ya no existe', p_parada using errcode = 'P0002';
  end if;

  -- `for update`: el estado puede cambiar entre que la pantalla se pinta y el
  -- supervisor pulsa. El bloqueo sostiene la comprobación hasta el commit.
  select * into v_rutero from public.rutero where id = v_parada.rutero_id for update;

  if v_rutero.estado not in ('borrador', 'publicado') then
    raise exception
      'El día ya empezó: la ruta de un rutero % no se toca', v_rutero.estado
      using errcode = '55000';
  end if;

  -- El día del negocio es el de Lima, no el de UTC.
  if v_rutero.fecha < app.hoy_lima() then
    raise exception
      'Ese día ya pasó: su planificación es histórico y sostiene la asistencia'
      using errcode = '55000';
  end if;

  -- El MISMO SQLSTATE que levantaría `visita_parada_fk`, a propósito: si entre
  -- este `exists` y el `delete` entra un check-in, la FK corta con 23503 y la
  -- acción de servidor traduce las dos por la misma rama. Una carrera, un mensaje.
  if exists (select 1 from public.visita where rutero_parada_id = p_parada) then
    raise exception 'esa parada ya tiene una visita registrada'
      using errcode = '23503';
  end if;

  insert into public.rutero_parada_retirada
    (tenant_id, rutero_id, fecha, mercaderista_id, tienda_id, orden,
     hora_planificada, estado_rutero, retirada_por, motivo)
  values
    (v_parada.tenant_id, v_rutero.id, v_rutero.fecha, v_rutero.mercaderista_id,
     v_parada.tienda_id, v_parada.orden, v_parada.hora_planificada,
     v_rutero.estado, (select auth.uid()), nullif(btrim(p_motivo), ''));

  delete from public.rutero_parada where id = p_parada;
end;
$$;

comment on function public.quitar_parada_rutero(uuid, text) is
  'Quita una parada de un rutero en borrador o publicado y deja constancia de quién la quitó. Rechaza la parada que ya tiene visita, el rutero que salió de esos dos estados y el día ya pasado (su planificación sostiene la asistencia del periodo abierto).';

revoke execute on function public.quitar_parada_rutero(uuid, text) from public;
revoke execute on function public.quitar_parada_rutero(uuid, text) from anon;
grant execute on function public.quitar_parada_rutero(uuid, text)
  to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 5. La planeación dice si cada parada ya tiene visita
--
-- Es lo que deja al panel inhabilitar "Eliminar" CON SU MOTIVO en vez de
-- esconderlo. Y sale de `visita`, no de `rutero_parada.estado`: esa columna no la
-- escribe nadie hoy —el móvil deriva su estado visual de la visita local—, así
-- que usarla como señal daría `pendiente` siempre.
--
-- `drop` + `create` y no `create or replace`: cambia el tipo de retorno, y
-- Postgres rechaza el replace con "cannot change return type of existing
-- function". Misma razón que dejó escrita la migración de la hora.
-- ---------------------------------------------------------------------------
drop function if exists public.planeacion_ruteros(uuid, date, date);

create function public.planeacion_ruteros(
  p_mercaderista uuid,
  p_desde date,
  p_hasta date
)
returns table (
  rutero_id uuid,
  fecha date,
  estado public.estado_rutero,
  parada_id uuid,
  orden integer,
  tienda_id uuid,
  tienda_nombre text,
  parada_estado public.estado_parada,
  hora_planificada time,
  tiene_visita boolean
)
language sql
stable
set search_path = ''
as $$
  select
    r.id, r.fecha, r.estado,
    rp.id, rp.orden, t.id, t.nombre, rp.estado, rp.hora_planificada,
    -- Usa `visita_rutero_parada_idx`, que ya existe.
    rp.id is not null and exists (
      select 1 from public.visita v where v.rutero_parada_id = rp.id
    )
  from public.rutero r
  left join public.rutero_parada rp on rp.rutero_id = r.id
  left join public.tienda t on t.id = rp.tienda_id
  where r.mercaderista_id = p_mercaderista
    and r.fecha between p_desde and p_hasta
  order by r.fecha, rp.orden;
$$;

comment on function public.planeacion_ruteros(uuid, date, date) is
  'Los ruteros de un mercaderista en un rango de fechas, con sus paradas, la hora esperada de cada una y si ya tiene visita registrada. Alimenta la vista semanal y la mensual del panel: ambas son ventanas sobre las mismas filas diarias.';

revoke execute on function public.planeacion_ruteros(uuid, date, date) from public;
grant execute on function public.planeacion_ruteros(uuid, date, date)
  to authenticated, service_role;
