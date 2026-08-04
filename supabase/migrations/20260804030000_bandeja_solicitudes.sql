-- Bandeja de solicitudes de cambio de ruta del supervisor.
--
-- El modelo lo dejó la migración de `solicitud_cambio_ruta`; aquí van la lectura
-- que necesita el panel y el feed en vivo.

-- --- La lista ----------------------------------------------------------------
--
-- `security invoker`: la RLS decide. `sol_staff_lee` deja al staff verlas todas,
-- así que el filtro por equipo de abajo es COMODIDAD, no una frontera de
-- seguridad — un supervisor puede pedir la lista completa y la base se la da.
-- Si algún día "solo mi equipo" tiene que ser una garantía, el sitio donde
-- imponerla es la política, no esta función.
--
-- `p_solo_mi_equipo` filtra por `profile.supervisor_id`: quién reporta a quién.
-- El admin no tiene reportes directos, así que para él el filtro devolvería vacío
-- — por eso solo se aplica cuando el que llama es supervisor.
--
-- Y RESOLVER TAMPOCO ESTÁ ACOTADO AL PROPIO EQUIPO, a propósito. `sol_staff_resuelve`
-- deja a cualquier admin o supervisor decidir sobre cualquier solicitud. No es un
-- cruce entre clientes —el staff de la outsourcing no pertenece a ninguno, lo
-- impone `profile_tenant_segun_rol`— sino cobertura entre pares: un supervisor de
-- vacaciones no puede dejar a su equipo esperando en la calle. La trazabilidad la
-- da `resuelta_por`, que graba quién decidió.

create function public.bandeja_solicitudes(p_solo_mi_equipo boolean default true)
returns table (
  id uuid,
  mercaderista_id uuid,
  mercaderista_nombre text,
  tipo public.tipo_solicitud_ruta,
  motivo text,
  estado public.estado_solicitud_ruta,
  fecha date,
  rutero_fecha date,
  comentario_resolucion text,
  resuelta_por_nombre text,
  resuelta_at timestamptz,
  creada_at timestamptz
)
language sql
stable
as $$
  select
    s.id,
    s.mercaderista_id,
    m.nombre,
    s.tipo,
    s.motivo,
    s.estado,
    s.fecha,
    r.fecha,
    s.comentario_resolucion,
    q.nombre,
    s.resuelta_at,
    s.creada_at
  from public.solicitud_cambio_ruta s
  join public.profile m on m.id = s.mercaderista_id
  left join public.rutero r on r.id = s.rutero_id
  left join public.profile q on q.id = s.resuelta_por
  where (
    not p_solo_mi_equipo
    or (select app.rol_actual()) <> 'supervisor'
    or m.supervisor_id = (select auth.uid())
  )
  -- Las que esperan respuesta primero: es una bandeja de trabajo, no un archivo.
  order by (s.estado in ('nueva', 'vista')) desc, s.creada_at desc;
$$;

comment on function public.bandeja_solicitudes(boolean) is
  'Solicitudes de cambio de ruta para el panel. El filtro por equipo es comodidad de UI: la RLS ya deja al staff verlas todas.';

grant execute on function public.bandeja_solicitudes(boolean) to authenticated, service_role;

-- --- El feed en vivo ---------------------------------------------------------
--
-- Reusa tal cual el emisor de los feeds en vivo: el nombre del feed sale de
-- `tg_table_name`, así que el topic es `staff:solicitud_cambio_ruta`.
--
-- El trigger emite también al canal del tenant, que aquí se queda SIN OYENTES a
-- propósito: una solicitud de cambio de ruta es un asunto interno entre el
-- mercaderista y su supervisor, y el cliente-marca no pinta nada. Por eso abajo
-- solo se amplía la política del staff.
create trigger solicitud_cambio_ruta_difunde_en_vivo
after insert or update on public.solicitud_cambio_ruta
for each row execute function app.difundir_cambio_en_vivo();

-- La política enumera los topics permitidos, así que hay que rehacerla para
-- añadir el nuevo. La del cliente se queda como está.
drop policy feed_staff_recibe on realtime.messages;

create policy feed_staff_recibe on realtime.messages
for select to authenticated
using (
  extension = 'broadcast'
  and (select app.es_staff())
  and (select realtime.topic()) in (
    (select app.topico_staff('alerta')),
    (select app.topico_staff('visita')),
    (select app.topico_staff('solicitud_cambio_ruta'))
  )
);
