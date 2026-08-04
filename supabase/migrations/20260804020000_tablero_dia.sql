-- Tablero del día del supervisor: las visitas de una fecha con todo lo que la
-- tabla en vivo necesita, DERIVADO EN LA BASE (una sola llamada por request).
--
-- `security invoker` (el default de una función SQL): la RLS de cada tabla decide
-- qué ve quien llama. Nada de escoger tenant por parámetro.
--
-- ESTO ES UNA PANTALLA DE STAFF, y la base lo impone sola. El `join` a `profile`
-- solo devuelve filas para admin y supervisor: no existe una política de "leer los
-- perfiles de mi tenant" y su ausencia es deliberada (la RLS filtra filas, no
-- columnas, y el `dni`/`telefono` del mercaderista no puede acabar en manos del
-- brand manager, que es una parte externa — Ley 29733). Un cliente que llame a
-- esta función recibe cero filas, no una versión recortada. Si algún día el portal
-- necesita el nombre del mercaderista, será por una vista que exponga solo
-- `id` y `nombre`.
--
-- La fecha entra ya resuelta desde el server, que la calcula en `America/Lima`:
-- el "hoy" del negocio es el día de calendario en Lima, no en UTC.
--
-- Y la ventana TAMBIÉN se ancla en Lima. No basta con recibir la fecha correcta:
-- `check_in_at >= p_fecha` compara un `timestamptz` contra una `date`, que
-- Postgres resuelve a medianoche en la zona del servidor (UTC). Con la fecha de
-- Lima y la ventana en UTC hay 5 horas de desfase, y toda visita entre las 19:00
-- y medianoche de Lima se caería del tablero — justo el turno de cierre de
-- tienda. `p_fecha::timestamp at time zone 'America/Lima'` da el instante real en
-- que empieza el día en Lima.
--
-- Ventana SARGABLE: los dos extremos son constantes por consulta y se comparan
-- contra la columna CRUDA, nunca `check_in_at::date = f`. El cast por fila
-- anularía el índice `visita_tenant_fecha_idx (tenant_id, check_in_at desc)` y
-- forzaría un rescan.

create function public.tablero_dia(p_fecha date)
returns table (
  visita_id uuid,
  mercaderista_nombre text,
  mercaderista_dni text,
  tienda_id uuid,
  tienda_nombre text,
  tienda_lat double precision,
  tienda_lon double precision,
  check_in_at timestamptz,
  check_out_at timestamptz,
  duracion_min integer,
  tiempo_traslado_min integer,
  bateria_inicio_pct integer,
  fotos bigint,
  estado public.estado_visita,
  motivo text
)
language sql
stable
as $$
  select
    v.id,
    p.nombre,
    p.dni,
    t.id,
    t.nombre,
    t.lat,
    t.lon,
    v.check_in_at,
    v.check_out_at,
    -- Duración de la visita. Una visita en curso todavía no tiene cierre: se mide
    -- contra `now()` para que el tablero muestre cuánto lleva dentro, que es
    -- justo lo que el supervisor mira en vivo.
    (extract(epoch from (coalesce(v.check_out_at, now()) - v.check_in_at)) / 60)::integer,
    v.tiempo_traslado_min,
    v.bateria_inicio_pct,
    coalesce(f.n, 0),
    v.estado,
    -- El motivo de la contingencia más reciente de la visita: es lo que explica
    -- por qué una visita quedó bloqueada o incompleta. Null si no hubo ninguna.
    c.motivo
  from public.visita v
  join public.profile p on p.id = v.mercaderista_id
  join public.tienda t on t.id = v.tienda_id
  left join lateral (
    select count(*) as n from public.foto fo where fo.visita_id = v.id
  ) f on true
  left join lateral (
    select co.motivo
    from public.contingencia co
    where co.visita_id = v.id
    order by co.registrada_at desc
    limit 1
  ) c on true
  where v.check_in_at >= (p_fecha::timestamp at time zone 'America/Lima')
    and v.check_in_at < ((p_fecha + 1)::timestamp at time zone 'America/Lima')
  order by v.check_in_at desc;
$$;

comment on function public.tablero_dia(date) is
  'Visitas de una fecha para el tablero del supervisor, con duración, fotos y motivo de contingencia derivados. RLS acota lo que ve quien llama.';

grant execute on function public.tablero_dia(date) to authenticated, service_role;

-- Las contingencias del día sin atender: alimentan el feed en vivo y el badge.
-- Solo `nueva` cuenta como pendiente — "Marcar atendida" escribe `resuelta`.
create function public.tablero_contingencias(p_fecha date)
returns table (
  id uuid,
  visita_id uuid,
  tienda_nombre text,
  mercaderista_nombre text,
  paso text,
  motivo text,
  estado public.estado_alerta,
  creado_at timestamptz
)
language sql
stable
as $$
  select
    a.id,
    a.visita_id,
    t.nombre,
    p.nombre,
    a.payload ->> 'paso',
    a.payload ->> 'motivo',
    a.estado,
    a.creado_at
  from public.alerta a
  join public.visita v on v.id = a.visita_id
  join public.tienda t on t.id = v.tienda_id
  join public.profile p on p.id = v.mercaderista_id
  where a.tipo = 'contingencia'
    -- El día de Lima, igual que en `tablero_dia`. Ver allí el porqué.
    and a.creado_at >= (p_fecha::timestamp at time zone 'America/Lima')
    and a.creado_at < ((p_fecha + 1)::timestamp at time zone 'America/Lima')
  order by a.creado_at desc;
$$;

comment on function public.tablero_contingencias(date) is
  'Alertas de contingencia de una fecha para el tablero del supervisor. El paso y el motivo salen del payload que graba el motor de alertas.';

grant execute on function public.tablero_contingencias(date) to authenticated, service_role;
