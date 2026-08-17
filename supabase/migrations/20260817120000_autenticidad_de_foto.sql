-- Autenticidad de `foto`: una columna que SOLO el servidor escribe, sellada tras
-- comprobar contra R2 que el binario existe.
--
-- QUÉ PRUEBA `verificada_at`: que existe un objeto en R2 bajo la key de esa foto
-- (`tenant/visita/foto`). Cierra la falsificación barata —una fila `foto` sin un
-- solo byte subido—, que es la que hoy podría inflar el bono del mercaderista:
-- `hash` y `subida_at` los escribe el móvil, y el mercaderista tiene política de
-- INSERT sobre `foto` para sus propias visitas.
--
-- QUÉ NO PRUEBA: el contenido de la imagen. El mercaderista tiene una URL PUT
-- firmada para cualquier `foto_id` de su visita y podría subir un JPEG negro. Eso
-- lo acotan el watermark en captura (ADR-0006) y los `least(...)` del motor.
--
-- EL MOTOR NO CAMBIA EN ESTE DESPLIEGUE. `app.calcular_puntaje_merchandiser`
-- sigue acreditando fotos por `hash is not null`. El cambio a `verificada_at is
-- not null` está decidido y va en un despliegue posterior, cuando el barrido haya
-- sellado el histórico en producción: cambiar la lectura antes pondría a cero la
-- calidad de registro y las herramientas del periodo abierto (los despliegues no
-- son atómicos: columna → confirmación operando → backfill → cambio de lectura).
--
-- CÓMO SE SELLA: un barrido programado (pg_cron, cada 5 min) invoca la Edge
-- Function `fotos-verificar` con un secreto compartido; la función reclama un lote
-- de fotos subidas y sin verificar, hace un HEAD contra R2 por cada una y sella
-- las que existen. 404 no sella; 5xx/timeout no sella y se reintenta después.
-- Nunca borra ni desactiva nada: una caída de R2 no es evidencia de fraude
-- (ADR-0003). Sin trigger por fila a propósito: nadie consume el sello en tiempo
-- real (el motor corre por periodo), y un trigger dispararía una invocación por
-- foto cuando un teléfono vuelve de un sótano con 200 filas en cola.

alter table public.foto
  add column verificada_at           timestamptz,
  add column bytes_r2                integer,
  add column verificacion_intento_at timestamptz;

comment on column public.foto.verificada_at is
  'Sello del SERVIDOR (Edge Function fotos-verificar, service_role): en este instante se comprobó con un HEAD que existe un objeto en R2 bajo la key de la foto. La app no puede escribirla (trigger). Prueba existencia del binario, no su contenido. El motor de puntaje TODAVÍA lee `hash`; el cambio a esta columna es un despliegue posterior.';
comment on column public.foto.bytes_r2 is
  'Content-Length que devolvió R2 al sellar; null si no lo informó. Solo servidor.';
comment on column public.foto.verificacion_intento_at is
  'Último intento de verificación (lo estampa el barrido al reclamar el lote). Ordena la cola: sin esto, un 404 permanente bloquearía la cabeza para siempre. Solo servidor.';

-- La cola de pendientes, y solo ella: el índice se ENCOGE según se sella.
create index foto_pendiente_verificacion_idx
  on public.foto (verificacion_intento_at nulls first, subida_at)
  where subida_at is not null and verificada_at is null;

-- ---------------------------------------------------------------------------
-- El guardián: la autenticidad la escribe el servidor y la identidad de la foto
-- no se reescribe.
--
-- UN TRIGGER, NO UN GRANT POR COLUMNA — mismo motivo que
-- `app.respuesta_identidad_inmutable()`: el conector de PowerSync reenvía los
-- INSERT como upsert de la fila ENTERA y reintenta lotes completos; un grant por
-- columna daría 42501 en ese reintento y `esRechazoPermanente()` DESCARTARÍA la
-- operación: el mercaderista perdería la foto que capturó en tienda. El trigger
-- compara VALORES: un upsert que reescribe todo con lo mismo pasa sin ruido. Y
-- el esquema del móvil no declara estas tres columnas, así que el sync jamás las
-- manda; solo una escritura a mano por PostgREST puede tropezar aquí.
--
-- La identidad (id, visita, levantamiento, tipo, hash, hora de captura, tenant)
-- se congela en el mismo trigger: sin eso, tras el sellado se podría MOVER el
-- crédito de un slot del motor a otro (cambiar `tipo` de 'antes' a 'despues', o
-- `levantamiento_id` a otro levantamiento propio) y el sello certificaría bytes
-- de una afirmación distinta. El móvil solo hace INSERT y `update ... set
-- subida_at`, así que congelarlas no toca el sync.
--
-- ⚠️ SECURITY INVOKER, jamás DEFINER: con DEFINER, `current_user` sería el dueño
-- (postgres) y el guardián dejaría pasar a todo el mundo en silencio. Bajo
-- PostgREST/`set role`, `current_user` vale `service_role` o `authenticated`.
-- ---------------------------------------------------------------------------
create function app.foto_autenticidad_del_servidor()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  -- El servidor (Edge Function con service_role) y las migraciones/seed pasan.
  if current_user in ('service_role', 'postgres', 'supabase_admin') then
    return new;
  end if;

  if tg_op = 'INSERT' then
    if new.verificada_at is not null
       or new.bytes_r2 is not null
       or new.verificacion_intento_at is not null then
      raise exception 'la autenticidad de una foto la sella el servidor, no la app';
    end if;
    return new;
  end if;

  if new.verificada_at is distinct from old.verificada_at
     or new.bytes_r2 is distinct from old.bytes_r2
     or new.verificacion_intento_at is distinct from old.verificacion_intento_at then
    raise exception 'la autenticidad de una foto no se reescribe desde la app';
  end if;
  -- `id` incluido: PowerSync lo usa como clave de reconciliación.
  if new.id is distinct from old.id then
    raise exception 'id no se puede cambiar: es la identidad de la foto';
  end if;
  if new.tenant_id is distinct from old.tenant_id then
    raise exception 'tenant_id no se puede cambiar';
  end if;
  if new.visita_id is distinct from old.visita_id
     or new.levantamiento_id is distinct from old.levantamiento_id then
    raise exception 'una foto no se mueve de visita ni de levantamiento';
  end if;
  if new.tipo is distinct from old.tipo then
    raise exception 'tipo no se puede cambiar: es lo que la foto afirma ser';
  end if;
  -- El hash y la hora se fijan al capturar (ADR-0006); reescribirlos rompería esa promesa.
  if new.hash is distinct from old.hash
     or new.capturada_at is distinct from old.capturada_at then
    raise exception 'hash y capturada_at se fijan al capturar y no se reescriben';
  end if;
  return new;
end;
$$;

revoke execute on function app.foto_autenticidad_del_servidor() from public;

comment on function app.foto_autenticidad_del_servidor() is
  'Guardián de `foto`: verificada_at/bytes_r2/verificacion_intento_at solo las escribe el servidor (service_role), y la identidad de la foto (id, tenant, visita, levantamiento, tipo, hash, capturada_at) no se reescribe. Un trigger y no un grant por columna: el upsert de reintento de PowerSync manda todas las columnas y un grant las rechazaría, descartando datos de campo. SECURITY INVOKER a propósito.';

create trigger foto_autenticidad_del_servidor
  before insert or update on public.foto
  for each row execute function app.foto_autenticidad_del_servidor();

-- ---------------------------------------------------------------------------
-- Las dos RPC del barrido. Viven en `public` (el único esquema que PostgREST
-- expone, para que `.rpc()` las encuentre) pero SOLO service_role puede
-- ejecutarlas. SECURITY INVOKER: service_role ya salta la RLS y el GRANT es la
-- única puerta — no hace falta una DEFINER más.
-- ---------------------------------------------------------------------------

-- RECLAMA el lote: no solo lista, estampa el intento. Así dos barridos solapados
-- no se pisan (`skip locked`) y un 404 permanente no bloquea la cabeza de la cola
-- (lo intentado hace menos de una hora se salta). Tope duro de 500 aunque el
-- llamante pida más.
create function public.fotos_pendientes_de_verificacion(p_limite integer default 100)
returns table (id uuid, tenant_id uuid, visita_id uuid)
language sql
set search_path = ''
as $$
  with bloqueadas as (
    select f.id, f.verificacion_intento_at, f.subida_at
    from public.foto f
    where f.subida_at is not null
      and f.verificada_at is null
      and (f.verificacion_intento_at is null
           or f.verificacion_intento_at < now() - interval '1 hour')
    order by f.verificacion_intento_at nulls first, f.subida_at
    limit least(greatest(coalesce(p_limite, 100), 1), 500)
    for update skip locked
  ),
  -- Numeradas aparte: `for update` no admite funciones ventana en la misma consulta.
  candidatas as (
    select b.id,
           row_number() over (
             order by b.verificacion_intento_at nulls first, b.subida_at
           ) as orden
    from bloqueadas b
  ),
  reclamadas as (
    update public.foto f
       set verificacion_intento_at = now()
      from candidatas c
     where f.id = c.id
    returning f.id, f.tenant_id, f.visita_id
  )
  -- El ORDER BY del CTE decide QUÉ filas entran, no en qué orden salen del
  -- UPDATE ... RETURNING (el join de vuelta puede reordenarlas). El orden lo
  -- garantiza este SELECT final: la Edge Function corta por plazo y tiene que
  -- procesar primero lo más viejo.
  select r.id, r.tenant_id, r.visita_id
  from reclamadas r
  join candidatas c on c.id = r.id
  order by c.orden;
$$;

comment on function public.fotos_pendientes_de_verificacion(integer) is
  'Reclama (y estampa el intento de) un lote de fotos subidas y sin verificar, la más vieja primero, saltando lo intentado hace menos de una hora. Solo service_role.';

-- Idempotente: `where verificada_at is null` hace que sellar dos veces sea no-op
-- y que dos sellados concurrentes no se pisen.
create function public.sellar_fotos_verificadas(p_sellos jsonb)
returns integer
language plpgsql
set search_path = ''
as $$
declare
  v_n integer;
begin
  if p_sellos is null or jsonb_typeof(p_sellos) <> 'array' then
    raise exception 'lote de sellado inválido: se espera un array';
  end if;
  if jsonb_array_length(p_sellos) > 500 then
    raise exception 'lote de sellado por encima del tope';
  end if;

  update public.foto f
     set verificada_at = now(),
         bytes_r2      = s.bytes
    from jsonb_to_recordset(p_sellos) as s(foto_id uuid, bytes integer)
   where f.id = s.foto_id
     and f.verificada_at is null;
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;

comment on function public.sellar_fotos_verificadas(jsonb) is
  'Sella verificada_at (y bytes_r2) de las fotos del lote `[{foto_id, bytes}]` que aún no lo estaban; devuelve cuántas selló. Idempotente. Solo service_role.';

-- Los tres revokes: local y la nube conceden distinto por defecto.
revoke execute on function public.fotos_pendientes_de_verificacion(integer) from public;
revoke execute on function public.fotos_pendientes_de_verificacion(integer) from anon;
revoke execute on function public.fotos_pendientes_de_verificacion(integer) from authenticated;
grant  execute on function public.fotos_pendientes_de_verificacion(integer) to service_role;

revoke execute on function public.sellar_fotos_verificadas(jsonb) from public;
revoke execute on function public.sellar_fotos_verificadas(jsonb) from anon;
revoke execute on function public.sellar_fotos_verificadas(jsonb) from authenticated;
grant  execute on function public.sellar_fotos_verificadas(jsonb) to service_role;

-- ---------------------------------------------------------------------------
-- El barrido programado. Mismo patrón que `app.notificar_alerta_email()`: la
-- URL de las funciones y el secreto vienen de settings por entorno
-- (`alter database ... set app.settings.*`, ver SETUP.md); sin ellos es un no-op
-- silencioso — en local no hay R2 que consultar. Una sesión de pg_cron solo ve
-- GUCs puestas a nivel de base o de rol, no de sesión.
-- ---------------------------------------------------------------------------
create extension if not exists pg_cron;

create function app.barrer_fotos_sin_verificar()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  base_url text := current_setting('app.settings.functions_url', true);
  secret   text := current_setting('app.settings.foto_verificacion_secret', true);
begin
  if base_url is null or base_url = '' then
    return;
  end if;
  perform net.http_post(
    url := base_url || '/fotos-verificar',
    body := jsonb_build_object('modo', 'barrer', 'limite', 100),
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-webhook-secret', coalesce(secret, '')
    ),
    timeout_milliseconds := 5000
  );
end;
$$;

revoke execute on function app.barrer_fotos_sin_verificar() from public;

comment on function app.barrer_fotos_sin_verificar() is
  'Pide a la Edge Function fotos-verificar que procese un lote de fotos subidas y sin verificar. La programa pg_cron cada 5 min. No-op si app.settings.functions_url no está configurada.';

select cron.schedule(
  'barrer_fotos_sin_verificar',
  '*/5 * * * *',
  $$select app.barrer_fotos_sin_verificar()$$
);

-- Puntero al cambio pendiente, sin editar la migración del motor (append-only).
comment on function app.calcular_puntaje_merchandiser(uuid, public.periodo_puntaje, date) is
  'Calcula (o recalcula) el puntaje del plan de lealtad de un mercaderista en un periodo. Un periodo ya cerrado no se toca. Pasada la ventana de gracia, el cálculo lo sella. HOY acredita fotos por `foto.hash is not null`, que lo escribe el móvil: los least() acotan cuántas filas cuentan, no si son reales. El cambio a `foto.verificada_at is not null` (sello del servidor) está decidido y TODAVÍA NO IMPLEMENTADO: va en un despliegue posterior, cuando el barrido haya sellado el histórico.';
