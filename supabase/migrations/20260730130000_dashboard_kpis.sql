-- MAR-55: KPIs y pines del dashboard del portal, DERIVADOS EN LA BASE (una sola
-- llamada por request). `security invoker` (el default de una función SQL): las
-- consultas corren con los privilegios del que llama, así que la RLS de cada tabla
-- (`*_usuario_lee_su_tenant`) acota todo al tenant del cliente. Nada de escoger
-- tenant por parámetro.
--
-- Los filtros globales del portal (rango de fechas · cadena · tienda) entran como
-- parámetros; el rango de fechas ya viene resuelto desde el server (con su default).
--
-- Ventanas de fecha SARGABLES: se compara la columna cruda (`check_in_at`,
-- `creado_at` son `timestamptz`) contra un rango medio-abierto `>= desde and <
-- (hasta + 1)`, nunca `col::date between ...`. El cast por fila anula los índices
-- `(tenant_id, check_in_at)` / `(tenant_id, creado_at)` y fuerza un rescan; el
-- rango medio-abierto los usa. `rutero.fecha` y `exhibicion_negociada.fecha_*` ya
-- son `date`, así que su `between` se deja tal cual.
--
-- Semántica de "hallazgos": los quiebres, diferencias, SOS, exhibiciones cumplidas
-- y desviaciones de precio se cuentan en cuanto se detectan en una visita del
-- período, SIN exigir que la visita esté cerrada (check-out). Solo el CUMPLIMIENTO
-- de rutero mira el estado de la parada, porque esa es su definición (paradas
-- completadas / planificadas). La asimetría es intencional; si el cliente quiere
-- que los hallazgos cuenten solo con la visita cerrada, se añade el filtro de
-- estado a estas CTE.

-- Los 6 KPIs del período FILTRADO y del período ANTERIOR (misma duración justo
-- antes de `desde`), para la tendencia. El shaping a tarjetas lo hace el server.
-- Cada CTE agrega sobre la ventana combinada [p1, d2] y separa actual/anterior con
-- `filter`, para escanear una sola vez. `cross join rango` lleva las fechas a cada
-- fila; una CTE agregada siempre devuelve una fila (0 filas → contadores en 0).
create function public.dashboard_kpis(
  p_desde date,
  p_hasta date,
  p_cadena uuid default null,
  p_tienda uuid default null
)
returns table (
  cumplimiento_pct numeric,
  cumplimiento_pct_prev numeric,
  quiebres bigint,
  quiebres_prev bigint,
  diferencias bigint,
  diferencias_prev bigint,
  sos_pct numeric,
  sos_pct_prev numeric,
  exhib_cumplidas bigint,
  exhib_negociadas bigint,
  exhib_cumplidas_prev bigint,
  exhib_negociadas_prev bigint,
  desviaciones_precio bigint,
  desviaciones_precio_prev bigint
)
language sql
stable
as $$
  with rango as (
    select
      p_desde as d1,
      p_hasta as d2,
      (p_desde - 1 - (p_hasta - p_desde)) as p1,
      (p_desde - 1) as p2
  ),
  cumplimiento as (
    select
      round(100.0 * count(*) filter (where rp.estado = 'completada' and r.fecha between rg.d1 and rg.d2)
            / nullif(count(*) filter (where r.fecha between rg.d1 and rg.d2), 0), 1) as actual,
      round(100.0 * count(*) filter (where rp.estado = 'completada' and r.fecha between rg.p1 and rg.p2)
            / nullif(count(*) filter (where r.fecha between rg.p1 and rg.p2), 0), 1) as prev
    from public.rutero_parada rp
    join public.rutero r on r.id = rp.rutero_id
    join public.tienda t on t.id = rp.tienda_id
    cross join rango rg
    where r.fecha between rg.p1 and rg.d2
      and (p_cadena is null or t.cadena_id = p_cadena)
      and (p_tienda is null or t.id = p_tienda)
  ),
  sku as (
    select
      count(*) filter (where ls.quiebre and v.check_in_at >= rg.d1 and v.check_in_at < rg.d2 + 1) as quiebres,
      count(*) filter (where ls.quiebre and v.check_in_at >= rg.p1 and v.check_in_at < rg.p2 + 1) as quiebres_prev,
      count(*) filter (where ls.diferencia and v.check_in_at >= rg.d1 and v.check_in_at < rg.d2 + 1) as diferencias,
      count(*) filter (where ls.diferencia and v.check_in_at >= rg.p1 and v.check_in_at < rg.p2 + 1) as diferencias_prev
    from public.levantamiento_sku ls
    join public.levantamiento l on l.id = ls.levantamiento_id
    join public.visita v on v.id = l.visita_id
    join public.tienda t on t.id = v.tienda_id
    cross join rango rg
    where v.check_in_at >= rg.p1 and v.check_in_at < rg.d2 + 1
      and (p_cadena is null or t.cadena_id = p_cadena)
      and (p_tienda is null or t.id = p_tienda)
  ),
  -- Share of Shelf = frentes propios / totales (propios + competencia). La
  -- competencia es un jsonb array [{competidor, frentes}]; se suma su `frentes`.
  sos as (
    select
      round(100.0 * sum(l.sos_frentes_propios) filter (where v.check_in_at >= rg.d1 and v.check_in_at < rg.d2 + 1)
            / nullif(sum(l.sos_frentes_propios + coalesce(comp.total, 0)) filter (where v.check_in_at >= rg.d1 and v.check_in_at < rg.d2 + 1), 0), 1) as actual,
      round(100.0 * sum(l.sos_frentes_propios) filter (where v.check_in_at >= rg.p1 and v.check_in_at < rg.p2 + 1)
            / nullif(sum(l.sos_frentes_propios + coalesce(comp.total, 0)) filter (where v.check_in_at >= rg.p1 and v.check_in_at < rg.p2 + 1), 0), 1) as prev
    from public.levantamiento l
    join public.visita v on v.id = l.visita_id
    join public.tienda t on t.id = v.tienda_id
    cross join rango rg
    cross join lateral (
      select sum((e->>'frentes')::numeric) as total
      from jsonb_array_elements(l.sos_frentes_competencia) e
    ) comp
    where v.check_in_at >= rg.p1 and v.check_in_at < rg.d2 + 1
      and l.sos_frentes_propios is not null
      and (p_cadena is null or t.cadena_id = p_cadena)
      and (p_tienda is null or t.id = p_tienda)
  ),
  -- Exhibiciones negociadas VIGENTES en el período (solapan) vs las CUMPLIDAS. Las
  -- cumplidas cuentan DEALS DISTINTOS hallados instalados y completos en una visita
  -- del período: `count(distinct exhibicion_negociada_id)`, no eventos de visita —
  -- así una misma exhibición hallada en varias visitas no infla la cuenta por
  -- encima de las negociadas (evita "4 / 1").
  exhib_neg as (
    select
      count(*) filter (where en.fecha_inicio <= rg.d2 and (en.fecha_fin is null or en.fecha_fin >= rg.d1)) as actual,
      count(*) filter (where en.fecha_inicio <= rg.p2 and (en.fecha_fin is null or en.fecha_fin >= rg.p1)) as prev
    from public.exhibicion_negociada en
    join public.tienda t on t.id = en.tienda_id
    cross join rango rg
    where (p_cadena is null or t.cadena_id = p_cadena)
      and (p_tienda is null or t.id = p_tienda)
  ),
  exhib_cum as (
    select
      count(distinct e.exhibicion_negociada_id) filter (where e.instalada and e.completa and e.exhibicion_negociada_id is not null and v.check_in_at >= rg.d1 and v.check_in_at < rg.d2 + 1) as actual,
      count(distinct e.exhibicion_negociada_id) filter (where e.instalada and e.completa and e.exhibicion_negociada_id is not null and v.check_in_at >= rg.p1 and v.check_in_at < rg.p2 + 1) as prev
    from public.exhibicion e
    join public.levantamiento l on l.id = e.levantamiento_id
    join public.visita v on v.id = l.visita_id
    join public.tienda t on t.id = v.tienda_id
    cross join rango rg
    where v.check_in_at >= rg.p1 and v.check_in_at < rg.d2 + 1
      and (p_cadena is null or t.cadena_id = p_cadena)
      and (p_tienda is null or t.id = p_tienda)
  ),
  -- Desviaciones de precio detectadas: alertas de precio en el período. La alerta
  -- llega a la tienda por su visita; se acota por cadena/tienda igual.
  precio as (
    select
      count(*) filter (where a.creado_at >= rg.d1 and a.creado_at < rg.d2 + 1) as actual,
      count(*) filter (where a.creado_at >= rg.p1 and a.creado_at < rg.p2 + 1) as prev
    from public.alerta a
    join public.visita v on v.id = a.visita_id
    join public.tienda t on t.id = v.tienda_id
    cross join rango rg
    where a.tipo in ('desviacion_precio', 'promo_no_activa')
      and a.creado_at >= rg.p1 and a.creado_at < rg.d2 + 1
      and (p_cadena is null or t.cadena_id = p_cadena)
      and (p_tienda is null or t.id = p_tienda)
  )
  select
    cumplimiento.actual, cumplimiento.prev,
    coalesce(sku.quiebres, 0), coalesce(sku.quiebres_prev, 0),
    coalesce(sku.diferencias, 0), coalesce(sku.diferencias_prev, 0),
    sos.actual, sos.prev,
    coalesce(exhib_cum.actual, 0), coalesce(exhib_neg.actual, 0),
    coalesce(exhib_cum.prev, 0), coalesce(exhib_neg.prev, 0),
    coalesce(precio.actual, 0), coalesce(precio.prev, 0)
  from cumplimiento, sku, sos, exhib_neg, exhib_cum, precio;
$$;

comment on function public.dashboard_kpis(date, date, uuid, uuid) is
  'KPIs del dashboard del portal (período filtrado + período anterior), derivados en la base y acotados por RLS al tenant del cliente. Los consume MAR-55.';

grant execute on function public.dashboard_kpis(date, date, uuid, uuid) to authenticated, service_role;

-- Los pines del mapa: por tienda con coordenadas, las SEÑALES para el color (el
-- color lo deriva un helper puro en el server). RLS acota al tenant.
create function public.dashboard_pines(
  p_desde date,
  p_hasta date,
  p_cadena uuid default null,
  p_tienda uuid default null
)
returns table (
  id uuid,
  nombre text,
  lat double precision,
  lon double precision,
  ultima_visita_estado text,
  tiene_alerta boolean,
  visitada boolean
)
language sql
stable
as $$
  select
    t.id,
    t.nombre,
    t.lat,
    t.lon,
    (
      select v.estado::text
      from public.visita v
      where v.tienda_id = t.id and v.check_in_at >= p_desde and v.check_in_at < p_hasta + 1
      order by v.check_in_at desc
      limit 1
    ) as ultima_visita_estado,
    exists (
      select 1 from public.alerta a
      join public.visita v on v.id = a.visita_id
      where v.tienda_id = t.id and a.creado_at >= p_desde and a.creado_at < p_hasta + 1
    ) as tiene_alerta,
    exists (
      select 1 from public.visita v
      where v.tienda_id = t.id and v.check_in_at >= p_desde and v.check_in_at < p_hasta + 1
    ) as visitada
  from public.tienda t
  where t.activo = true
    and t.lat is not null and t.lon is not null
    and (p_cadena is null or t.cadena_id = p_cadena)
    and (p_tienda is null or t.id = p_tienda)
  order by t.nombre;
$$;

comment on function public.dashboard_pines(date, date, uuid, uuid) is
  'Tiendas con coordenadas y las señales para el color del pin del mapa del dashboard (MAR-55). RLS acota al tenant.';

grant execute on function public.dashboard_pines(date, date, uuid, uuid) to authenticated, service_role;

-- El feed de alertas recientes del dashboard, acotado por los mismos filtros. La
-- alerta llega a la tienda por su visita. RLS acota al tenant.
create function public.dashboard_alertas(
  p_desde date,
  p_hasta date,
  p_cadena uuid default null,
  p_tienda uuid default null
)
returns table (
  id uuid,
  tipo public.tipo_alerta,
  severidad public.severidad_alerta,
  tienda_nombre text,
  creado_at timestamptz
)
language sql
stable
as $$
  select a.id, a.tipo, a.severidad, t.nombre, a.creado_at
  from public.alerta a
  join public.visita v on v.id = a.visita_id
  join public.tienda t on t.id = v.tienda_id
  where a.creado_at >= p_desde and a.creado_at < p_hasta + 1
    and (p_cadena is null or t.cadena_id = p_cadena)
    and (p_tienda is null or t.id = p_tienda)
  order by a.creado_at desc
  limit 20;
$$;

comment on function public.dashboard_alertas(date, date, uuid, uuid) is
  'Feed de alertas recientes del dashboard del portal (MAR-55), acotado por los filtros globales. RLS acota al tenant.';

grant execute on function public.dashboard_alertas(date, date, uuid, uuid) to authenticated, service_role;
