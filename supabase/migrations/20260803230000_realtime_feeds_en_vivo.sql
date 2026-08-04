-- ---------------------------------------------------------------------------
-- Feeds en vivo: el tablero del supervisor y el feed del portal del cliente.
--
-- POR QUÉ BROADCAST Y NO POSTGRES CHANGES
--
-- Con Postgres Changes la tabla entera entra en la publicación `supabase_realtime`
-- y el aislamiento depende de que Realtime evalúe la RLS fila por fila sobre todo
-- lo que pasa por el WAL. Con Broadcast el tenant va DENTRO del nombre del topic,
-- así que el aislamiento es estructural: quien no puede unirse al canal no recibe
-- nada, y no hay filtrado por fila que revisar. La documentación vigente de
-- Supabase recomienda Broadcast para cambios de base de datos justamente por eso
-- (escalabilidad y seguridad); Postgres Changes queda como la vía simple.
--
-- QUIÉN ESCUCHA
--
--   staff:alerta / staff:visita          → admin y supervisor (ven toda la operación)
--   tenant:<uuid>:alerta / :visita       → el cliente-marca, solo lo suyo
--
-- El MERCADERISTA no escucha nada a propósito. La app de campo es offline-first:
-- lee de la réplica local de PowerSync y no abre websockets en una tienda sin
-- señal. Dejarle el canal abierto sería una vía de red en un flujo de campo.
--
-- El gate `aal2` viaja de regalo: los topics se resuelven con `app.tenant_actual()`
-- y `app.es_staff()`, que cuelgan de `app.perfil_efectivo()`. Una sesión sin
-- segundo factor no resuelve ningún topic y no se une a ningún canal.
-- ---------------------------------------------------------------------------

-- --- El formato del topic tiene un solo dueño en SQL -------------------------
--
-- Lo usan los dos triggers y las dos políticas de abajo. Si el formato viviera
-- suelto en cada sitio, una política y un trigger podrían dejar de coincidir y el
-- síntoma sería "no llega nada", que es el bug más caro de diagnosticar.
-- El espejo en TypeScript es `packages/shared/src/realtime/topicos.ts`; el test
-- `realtime.db.test.ts` fija las dos cadenas para que no se separen.

create function app.topico_tenant(tenant uuid, feed text)
returns text
language sql
immutable
set search_path = ''
as $$ select 'tenant:' || tenant::text || ':' || feed $$;

comment on function app.topico_tenant(uuid, text) is
  'Topic privado del cliente-marca. El tenant va en el nombre: el aislamiento es la pertenencia al canal, no un filtro por fila.';

create function app.topico_staff(feed text)
returns text
language sql
immutable
set search_path = ''
as $$ select 'staff:' || feed $$;

comment on function app.topico_staff(text) is
  'Topic privado del personal de la outsourcing (admin/supervisor), que ve la operación de todos los clientes.';

-- --- El emisor ---------------------------------------------------------------
--
-- Un solo trigger para las dos tablas: el nombre del feed sale de `TG_TABLE_NAME`.
-- SECURITY DEFINER porque `realtime.broadcast_changes` escribe en el esquema
-- `realtime`, donde `authenticated` no tiene nada que hacer.

create function app.difundir_cambio_en_vivo()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- El feed en vivo NUNCA puede tumbar la escritura que lo origina.
  --
  -- Este trigger corre dentro de la transacción del check-in o de la alerta, y el
  -- mercaderista sube su visita después de horas sin señal: ese dato es el
  -- producto; el tile del supervisor, no.
  --
  -- `realtime.send` ya degrada a WARNING el fallo de su propio INSERT (partición
  -- del día que aún no existe, por ejemplo), así que ese caso está cubierto aguas
  -- abajo. Lo que este bloque ataja es el resto: `realtime.broadcast_changes`
  -- envuelve todo lo demás en un `raise exception`, y esa sí subiría hasta aquí y
  -- abortaría la escritura. Es también el seguro ante un cambio de versión de
  -- Realtime, que la propia ficha del ticket advierte que ocurre a menudo.
  --
  -- Se degrada con ruido, no en silencio: el WARNING queda en los logs de Postgres.
  begin
    -- Cada cambio sale dos veces: al canal del cliente dueño de la fila y al canal
    -- del staff. Son audiencias distintas con permisos distintos, no una copia.
    perform realtime.broadcast_changes(
      app.topico_tenant(new.tenant_id, tg_table_name),
      tg_op, tg_op, tg_table_name, tg_table_schema, new, old
    );
    perform realtime.broadcast_changes(
      app.topico_staff(tg_table_name),
      tg_op, tg_op, tg_table_name, tg_table_schema, new, old
    );
  exception
    when others then
      raise warning 'feed en vivo: no se emitió % sobre %.% — %',
        tg_op, tg_table_schema, tg_table_name, sqlerrm;
  end;
  return null;
end;
$$;

comment on function app.difundir_cambio_en_vivo() is
  'Emite el cambio de fila a los canales privados del tenant y del staff. AFTER trigger: no altera la fila, y un fallo al emitir no aborta la escritura de origen.';

-- Postgres concede EXECUTE a PUBLIC al crear una función: sin este revoke, una
-- SECURITY DEFINER queda al alcance de cualquiera. Misma cautela que en
-- `20260715182500_motor_de_alertas.sql`.
revoke execute on function app.difundir_cambio_en_vivo() from public;

-- Solo INSERT y UPDATE. `alerta` y `visita` no se borran en la operación normal
-- (las FK son `on delete restrict`), y un feed en vivo no tiene qué hacer con un
-- borrado: el trigger usa `new`, que en un DELETE sería nulo.
create trigger alerta_difunde_en_vivo
after insert or update on public.alerta
for each row execute function app.difundir_cambio_en_vivo();

create trigger visita_difunde_en_vivo
after insert or update on public.visita
for each row execute function app.difundir_cambio_en_vivo();

-- --- El portero: RLS sobre realtime.messages ---------------------------------
--
-- Realtime calcula los permisos al unirse el cliente al canal: consulta esta
-- tabla y revierte. No se guarda ningún mensaje aquí.
--
-- Solo hay políticas de SELECT (recibir). NO hay política de INSERT a propósito:
-- `authenticated` no puede emitir en estos canales, así que un cliente no puede
-- inyectar una alerta falsa en el tablero del supervisor. El trigger de arriba sí
-- emite porque es SECURITY DEFINER y no pasa por RLS.

create policy feed_staff_recibe on realtime.messages
for select to authenticated
using (
  extension = 'broadcast'
  and (select app.es_staff())
  and (select realtime.topic()) in (
    (select app.topico_staff('alerta')),
    (select app.topico_staff('visita'))
  )
);

create policy feed_cliente_recibe on realtime.messages
for select to authenticated
using (
  extension = 'broadcast'
  and (select app.rol_actual()) = 'cliente'
  and (select realtime.topic()) in (
    (select app.topico_tenant((select app.tenant_actual()), 'alerta')),
    (select app.topico_tenant((select app.tenant_actual()), 'visita'))
  )
);
