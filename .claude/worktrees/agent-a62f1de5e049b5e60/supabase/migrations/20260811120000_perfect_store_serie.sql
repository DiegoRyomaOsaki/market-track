-- La evolución de Perfect Store en el tiempo, y la cadena como nivel del
-- drill-down.
--
-- El agregado de MAR-99 devuelve UNA fila. El portal necesita además la serie
-- —"la evolución del periodo"— y hacerlo con una llamada por punto serían doce
-- consultas por carga de página. Una sola consulta devuelve todos los buckets.
--
-- Y le faltaba `cadena`: el drill-down que pidió el cliente es categoría → tipo
-- de tienda → cadena → tienda, y los filtros globales del portal ya la tienen.

create type public.granularidad_serie as enum ('dia', 'semana', 'mes');

-- ---------------------------------------------------------------------------
-- El agregado gana `p_cadena`.
--
-- Se recrea entero porque una función es su cuerpo. El parámetro va AL FINAL:
-- insertarlo en medio cambiaría el significado de las llamadas posicionales que
-- ya existen.
--
-- Y se SUELTA la firma anterior antes de crearla. `create or replace` solo
-- reemplaza cuando los tipos de los argumentos coinciden exactamente: con un
-- parámetro más deja las dos versiones vivas como sobrecargas, y entonces
-- cualquier llamada que se apoye en los defaults muere con "function ... is not
-- unique". Medido: rompió cinco pruebas del agregado.
-- ---------------------------------------------------------------------------
drop function if exists public.perfect_store_agregado(
  date, date, uuid, uuid, public.tipo_tienda, uuid, uuid);

create function public.perfect_store_agregado(
  p_desde        date,
  p_hasta        date,
  p_marca        uuid default null,
  p_categoria    uuid default null,
  p_tipo_tienda  public.tipo_tienda default null,
  p_tienda       uuid default null,
  p_mercaderista uuid default null,
  p_cadena       uuid default null
)
returns table (
  levantamientos   bigint,
  total_pct        numeric,
  distribucion_pct numeric,
  visibilidad_pct  numeric,
  precio_pct       numeric
)
language sql
stable
set search_path = ''
as $$
  with ventana as (
    select (p_desde::timestamp at time zone 'America/Lima') as inicio,
           ((p_hasta + 1)::timestamp at time zone 'America/Lima') as fin
  ),
  filas as (
    select p.total_pct, p.distribucion_pct,
           null::numeric as visibilidad_pct, p.precio_pct
    from public.puntaje_perfect_store_categoria p
    join public.levantamiento l on l.id = p.levantamiento_id
    join public.visita v on v.id = l.visita_id
    join public.tienda t on t.id = v.tienda_id
    join public.cadena c on c.id = t.cadena_id
    cross join ventana w
    where p_categoria is not null
      and p.categoria_id = p_categoria
      and v.check_in_recibido_at >= w.inicio
      and v.check_in_recibido_at < w.fin
      and (p_marca is null or l.marca_id = p_marca)
      and (p_tipo_tienda is null or c.tipo_tienda = p_tipo_tienda)
      and (p_cadena is null or t.cadena_id = p_cadena)
      and (p_tienda is null or v.tienda_id = p_tienda)
      and (p_mercaderista is null or v.mercaderista_id = p_mercaderista)

    union all

    select p.total_pct, p.distribucion_pct, p.visibilidad_pct, p.precio_pct
    from public.puntaje_perfect_store p
    join public.levantamiento l on l.id = p.levantamiento_id
    join public.visita v on v.id = l.visita_id
    join public.tienda t on t.id = v.tienda_id
    join public.cadena c on c.id = t.cadena_id
    cross join ventana w
    where p_categoria is null
      and v.check_in_recibido_at >= w.inicio
      and v.check_in_recibido_at < w.fin
      and (p_marca is null or l.marca_id = p_marca)
      and (p_tipo_tienda is null or c.tipo_tienda = p_tipo_tienda)
      and (p_cadena is null or t.cadena_id = p_cadena)
      and (p_tienda is null or v.tienda_id = p_tienda)
      and (p_mercaderista is null or v.mercaderista_id = p_mercaderista)
  )
  select count(*),
         round(avg(total_pct), 2),
         round(avg(distribucion_pct), 2),
         round(avg(visibilidad_pct), 2),
         round(avg(precio_pct), 2)
  from filas;
$$;

-- El comentario y el permiso NO sobreviven al drop: son de la función que se
-- soltó. Una función nueva nace con `execute` para PUBLIC, así que el grant
-- explícito no es una formalidad — es lo que deja el permiso donde se quería.
comment on function public.perfect_store_agregado(
  date, date, uuid, uuid, public.tipo_tienda, uuid, uuid, uuid) is
  'Perfect Store agregado en una ventana de días de Lima, filtrable por marca, categoría, tipo de tienda, tienda, mercaderista y cadena. Con categoría devuelve el desglose (sin visibilidad); sin ella, el puntaje del levantamiento.';

revoke execute on function public.perfect_store_agregado(
  date, date, uuid, uuid, public.tipo_tienda, uuid, uuid, uuid) from public;
grant execute on function public.perfect_store_agregado(
  date, date, uuid, uuid, public.tipo_tienda, uuid, uuid, uuid)
  to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- La serie.
--
-- Devuelve TODOS los buckets del rango, incluidos los que no tuvieron visitas —
-- con `levantamientos = 0` y el puntaje NULO. Un hueco tiene que verse como un
-- hueco: si los buckets vacíos se omitieran, la gráfica uniría dos puntos
-- separados por tres semanas como si fueran consecutivos, y una caída de
-- actividad parecería una línea estable.
--
-- El bucket se calcula sobre la fecha de LIMA. Truncar en UTC partiría las
-- semanas cinco horas antes y movería las visitas de la tarde al periodo
-- anterior.
-- ---------------------------------------------------------------------------
create function public.perfect_store_serie(
  p_desde        date,
  p_hasta        date,
  p_granularidad public.granularidad_serie default 'semana',
  p_marca        uuid default null,
  p_categoria    uuid default null,
  p_tipo_tienda  public.tipo_tienda default null,
  p_tienda       uuid default null,
  p_cadena       uuid default null
)
returns table (
  periodo        date,
  levantamientos bigint,
  total_pct      numeric
)
language sql
stable
set search_path = ''
as $$
  with unidad as (
    select case p_granularidad
             when 'dia' then 'day'
             when 'semana' then 'week'
             else 'month'
           end as u
  ),
  ventana as (
    select (p_desde::timestamp at time zone 'America/Lima') as inicio,
           ((p_hasta + 1)::timestamp at time zone 'America/Lima') as fin
  ),
  -- Todos los buckets del rango, haya o no visitas.
  buckets as (
    select generate_series(
             date_trunc(u.u, p_desde::timestamp),
             date_trunc(u.u, p_hasta::timestamp),
             ('1 ' || u.u)::interval
           )::date as periodo
    from unidad u
  ),
  puntajes as (
    select date_trunc(
             u.u,
             (v.check_in_recibido_at at time zone 'America/Lima')
           )::date as periodo,
           p.total_pct
    from public.puntaje_perfect_store_categoria p
    join public.levantamiento l on l.id = p.levantamiento_id
    join public.visita v on v.id = l.visita_id
    join public.tienda t on t.id = v.tienda_id
    join public.cadena c on c.id = t.cadena_id
    cross join ventana w
    cross join unidad u
    where p_categoria is not null
      and p.categoria_id = p_categoria
      and v.check_in_recibido_at >= w.inicio
      and v.check_in_recibido_at < w.fin
      and (p_marca is null or l.marca_id = p_marca)
      and (p_tipo_tienda is null or c.tipo_tienda = p_tipo_tienda)
      and (p_cadena is null or t.cadena_id = p_cadena)
      and (p_tienda is null or v.tienda_id = p_tienda)

    union all

    select date_trunc(
             u.u,
             (v.check_in_recibido_at at time zone 'America/Lima')
           )::date as periodo,
           p.total_pct
    from public.puntaje_perfect_store p
    join public.levantamiento l on l.id = p.levantamiento_id
    join public.visita v on v.id = l.visita_id
    join public.tienda t on t.id = v.tienda_id
    join public.cadena c on c.id = t.cadena_id
    cross join ventana w
    cross join unidad u
    where p_categoria is null
      and v.check_in_recibido_at >= w.inicio
      and v.check_in_recibido_at < w.fin
      and (p_marca is null or l.marca_id = p_marca)
      and (p_tipo_tienda is null or c.tipo_tienda = p_tipo_tienda)
      and (p_cadena is null or t.cadena_id = p_cadena)
      and (p_tienda is null or v.tienda_id = p_tienda)
  )
  select b.periodo,
         count(pz.periodo),
         round(avg(pz.total_pct), 2)
  from buckets b
  left join puntajes pz on pz.periodo = b.periodo
  group by b.periodo
  order by b.periodo;
$$;

comment on function public.perfect_store_serie(date, date, public.granularidad_serie, uuid, uuid, public.tipo_tienda, uuid, uuid) is
  'La evolución de Perfect Store por bucket. Devuelve TODOS los buckets del rango: uno sin visitas sale con 0 levantamientos y puntaje nulo, no se omite — un hueco tiene que verse como un hueco.';

-- El revoke va PRIMERO: una función nueva nace con `execute` para PUBLIC, así que
-- sin él `anon` la alcanza. Hoy falla cerrado porque ninguna tabla del join le da
-- SELECT a `anon`, pero eso es un candado prestado: la primera migración que
-- publique un catálogo (`categoria`, `cadena`) convertiría esto en una fuga entre
-- clientes sin volver a tocar esta función.
revoke execute on function public.perfect_store_serie(
  date, date, public.granularidad_serie, uuid, uuid, public.tipo_tienda, uuid, uuid) from public;
grant execute on function public.perfect_store_serie(
  date, date, public.granularidad_serie, uuid, uuid, public.tipo_tienda, uuid, uuid)
  to authenticated, service_role;
