-- Las ventanas de fecha del dashboard del portal se anclan en LIMA, no en UTC.
--
-- Las tres funciones comparaban una columna `timestamptz` contra un `date`
-- (`v.check_in_at >= p_desde`): Postgres resuelve ese cast con el TimeZone de la
-- sesión, que en Supabase es UTC. Entre las 19:00 y medianoche de Lima el día UTC
-- ya rodó al siguiente, así que una visita cerrada a las 20:00 contaba en el día
-- equivocado — y el mismo rango de fechas daba cifras distintas en el dashboard y
-- en la galería (`galeria_evidencia` ya anclaba en Lima).
--
-- El arreglo mantiene la ventana SARGABLE: rango medio-abierto sobre la columna
-- cruda contra bordes `timestamptz` calculados una vez por consulta, nunca
-- `col::date between`. Las columnas que ya son `date` (`rutero.fecha`,
-- `exhibicion_negociada.fecha_*`) representan el día de negocio y no cambian.
--
-- OJO: `create or replace` borra la configuración puesta con `alter function`,
-- así que cada función re-declara su `set search_path = ''`.

create or replace function public.dashboard_kpis(
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
set search_path = ''
as $$
  -- `d1/d2` y `p1/p2` son los días (inclusive) del período filtrado y del
  -- anterior; los consumen las columnas `date`. Los `*t` son los mismos bordes
  -- como instantes de Lima, medio-abiertos: actual = [d1t, d2t), anterior =
  -- [p1t, p2t). `p2t` coincide con `d1t` porque el período anterior termina
  -- justo donde empieza el actual.
  with rango as (
    select
      p_desde as d1,
      p_hasta as d2,
      (p_desde - 1 - (p_hasta - p_desde)) as p1,
      (p_desde - 1) as p2,
      (p_desde::timestamp at time zone 'America/Lima') as d1t,
      ((p_hasta + 1)::timestamp at time zone 'America/Lima') as d2t,
      ((p_desde - 1 - (p_hasta - p_desde))::timestamp at time zone 'America/Lima') as p1t,
      (p_desde::timestamp at time zone 'America/Lima') as p2t
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
      count(*) filter (where ls.quiebre and v.check_in_at >= rg.d1t and v.check_in_at < rg.d2t) as quiebres,
      count(*) filter (where ls.quiebre and v.check_in_at >= rg.p1t and v.check_in_at < rg.p2t) as quiebres_prev,
      count(*) filter (where ls.diferencia and v.check_in_at >= rg.d1t and v.check_in_at < rg.d2t) as diferencias,
      count(*) filter (where ls.diferencia and v.check_in_at >= rg.p1t and v.check_in_at < rg.p2t) as diferencias_prev
    from public.levantamiento_sku ls
    join public.levantamiento l on l.id = ls.levantamiento_id
    join public.visita v on v.id = l.visita_id
    join public.tienda t on t.id = v.tienda_id
    cross join rango rg
    where v.check_in_at >= rg.p1t and v.check_in_at < rg.d2t
      and (p_cadena is null or t.cadena_id = p_cadena)
      and (p_tienda is null or t.id = p_tienda)
  ),
  -- Share of Shelf = frentes propios / totales (propios + competencia). La
  -- competencia es un jsonb array [{competidor, frentes}]; se suma su `frentes`.
  sos as (
    select
      round(100.0 * sum(l.sos_frentes_propios) filter (where v.check_in_at >= rg.d1t and v.check_in_at < rg.d2t)
            / nullif(sum(l.sos_frentes_propios + coalesce(comp.total, 0)) filter (where v.check_in_at >= rg.d1t and v.check_in_at < rg.d2t), 0), 1) as actual,
      round(100.0 * sum(l.sos_frentes_propios) filter (where v.check_in_at >= rg.p1t and v.check_in_at < rg.p2t)
            / nullif(sum(l.sos_frentes_propios + coalesce(comp.total, 0)) filter (where v.check_in_at >= rg.p1t and v.check_in_at < rg.p2t), 0), 1) as prev
    from public.levantamiento l
    join public.visita v on v.id = l.visita_id
    join public.tienda t on t.id = v.tienda_id
    cross join rango rg
    cross join lateral (
      select sum((e->>'frentes')::numeric) as total
      from jsonb_array_elements(l.sos_frentes_competencia) e
    ) comp
    where v.check_in_at >= rg.p1t and v.check_in_at < rg.d2t
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
      count(distinct e.exhibicion_negociada_id) filter (where e.instalada and e.completa and e.exhibicion_negociada_id is not null and v.check_in_at >= rg.d1t and v.check_in_at < rg.d2t) as actual,
      count(distinct e.exhibicion_negociada_id) filter (where e.instalada and e.completa and e.exhibicion_negociada_id is not null and v.check_in_at >= rg.p1t and v.check_in_at < rg.p2t) as prev
    from public.exhibicion e
    join public.levantamiento l on l.id = e.levantamiento_id
    join public.visita v on v.id = l.visita_id
    join public.tienda t on t.id = v.tienda_id
    cross join rango rg
    where v.check_in_at >= rg.p1t and v.check_in_at < rg.d2t
      and (p_cadena is null or t.cadena_id = p_cadena)
      and (p_tienda is null or t.id = p_tienda)
  ),
  -- Desviaciones de precio detectadas: alertas de precio en el período. La alerta
  -- llega a la tienda por su visita; se acota por cadena/tienda igual.
  precio as (
    select
      count(*) filter (where a.creado_at >= rg.d1t and a.creado_at < rg.d2t) as actual,
      count(*) filter (where a.creado_at >= rg.p1t and a.creado_at < rg.p2t) as prev
    from public.alerta a
    join public.visita v on v.id = a.visita_id
    join public.tienda t on t.id = v.tienda_id
    cross join rango rg
    where a.tipo in ('desviacion_precio', 'promo_no_activa')
      and a.creado_at >= rg.p1t and a.creado_at < rg.d2t
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

create or replace function public.dashboard_pines(
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
set search_path = ''
as $$
  select
    t.id,
    t.nombre,
    t.lat,
    t.lon,
    (
      select v.estado::text
      from public.visita v
      where v.tienda_id = t.id
        and v.check_in_at >= (p_desde::timestamp at time zone 'America/Lima')
        and v.check_in_at < ((p_hasta + 1)::timestamp at time zone 'America/Lima')
      order by v.check_in_at desc
      limit 1
    ) as ultima_visita_estado,
    exists (
      select 1 from public.alerta a
      join public.visita v on v.id = a.visita_id
      where v.tienda_id = t.id
        and a.creado_at >= (p_desde::timestamp at time zone 'America/Lima')
        and a.creado_at < ((p_hasta + 1)::timestamp at time zone 'America/Lima')
    ) as tiene_alerta,
    exists (
      select 1 from public.visita v
      where v.tienda_id = t.id
        and v.check_in_at >= (p_desde::timestamp at time zone 'America/Lima')
        and v.check_in_at < ((p_hasta + 1)::timestamp at time zone 'America/Lima')
    ) as visitada
  from public.tienda t
  where t.activo = true
    and t.lat is not null and t.lon is not null
    and (p_cadena is null or t.cadena_id = p_cadena)
    and (p_tienda is null or t.id = p_tienda)
  order by t.nombre;
$$;

create or replace function public.dashboard_alertas(
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
set search_path = ''
as $$
  select a.id, a.tipo, a.severidad, t.nombre, a.creado_at
  from public.alerta a
  join public.visita v on v.id = a.visita_id
  join public.tienda t on t.id = v.tienda_id
  where a.creado_at >= (p_desde::timestamp at time zone 'America/Lima')
    and a.creado_at < ((p_hasta + 1)::timestamp at time zone 'America/Lima')
    and (p_cadena is null or t.cadena_id = p_cadena)
    and (p_tienda is null or t.id = p_tienda)
  order by a.creado_at desc
  limit 20;
$$;
