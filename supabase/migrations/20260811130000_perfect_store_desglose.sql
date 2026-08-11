-- El desglose de Perfect Store por nivel: el drill-down del portal.
--
-- El agregado devuelve UNA fila —el puntaje de la selección— y la serie, una por
-- bucket. Falta la tercera pregunta, que es la que hace navegable el tablero:
-- "¿y cómo se reparte ese número?". Una llamada al agregado por cada categoría,
-- cadena o tienda sería una consulta por fila de la tabla; esto lo resuelve en
-- una, agrupando en la base.
--
-- Los niveles son los que pidió el cliente, en ese orden: categoría → tipo de
-- tienda → cadena → tienda. Cada uno es un enlace que estrecha los filtros y
-- vuelve a pedir el siguiente.

create type public.nivel_perfect_store as enum (
  'categoria', 'tipo_tienda', 'cadena', 'tienda');

-- `clave` sale como texto y no como uuid porque `tipo_tienda` es un enum, no un
-- id. Un `uuid` obligaría a devolver dos columnas de clave y a que quien llama
-- eligiese cuál mirar según el nivel.
--
-- Y sale NULA cuando el grupo no es navegable: `cadena.tipo_tienda` es opcional,
-- así que las cadenas sin clasificar caen todas en una fila sin clave. Se
-- devuelve igual —esconderla haría que el desglose no sumara el número de
-- arriba— y quien llama sabe por la clave nula que ahí no hay dónde entrar.
create function public.perfect_store_desglose(
  p_desde       date,
  p_hasta       date,
  p_nivel       public.nivel_perfect_store,
  p_marca       uuid default null,
  p_categoria   uuid default null,
  p_tipo_tienda public.tipo_tienda default null,
  p_tienda      uuid default null,
  p_cadena      uuid default null
)
returns table (
  clave            text,
  etiqueta         text,
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
    -- El desglose por categoría, que es también la única fuente cuando hay una
    -- categoría filtrada. Su visibilidad va nula por lo mismo que en el
    -- agregado: hay una sola medición de share of shelf por visita y no se
    -- puede repartir entre categorías sin inventarla.
    select
      case p_nivel
        when 'categoria'   then p.categoria_id::text
        when 'tipo_tienda' then c.tipo_tienda::text
        when 'cadena'      then t.cadena_id::text
        else                    v.tienda_id::text
      end as clave,
      case p_nivel
        when 'categoria'   then cat.nombre
        when 'tipo_tienda' then coalesce(c.tipo_tienda::text, 'Sin clasificar')
        when 'cadena'      then c.nombre
        else                    t.nombre
      end as etiqueta,
      p.total_pct, p.distribucion_pct,
      null::numeric as visibilidad_pct, p.precio_pct
    from public.puntaje_perfect_store_categoria p
    join public.categoria cat on cat.id = p.categoria_id
    join public.levantamiento l on l.id = p.levantamiento_id
    join public.visita v on v.id = l.visita_id
    join public.tienda t on t.id = v.tienda_id
    join public.cadena c on c.id = t.cadena_id
    cross join ventana w
    where (p_nivel = 'categoria' or p_categoria is not null)
      and (p_categoria is null or p.categoria_id = p_categoria)
      and v.check_in_recibido_at >= w.inicio
      and v.check_in_recibido_at < w.fin
      and (p_marca is null or l.marca_id = p_marca)
      and (p_tipo_tienda is null or c.tipo_tienda = p_tipo_tienda)
      and (p_cadena is null or t.cadena_id = p_cadena)
      and (p_tienda is null or v.tienda_id = p_tienda)

    union all

    select
      case p_nivel
        when 'tipo_tienda' then c.tipo_tienda::text
        when 'cadena'      then t.cadena_id::text
        else                    v.tienda_id::text
      end,
      case p_nivel
        when 'tipo_tienda' then coalesce(c.tipo_tienda::text, 'Sin clasificar')
        when 'cadena'      then c.nombre
        else                    t.nombre
      end,
      p.total_pct, p.distribucion_pct, p.visibilidad_pct, p.precio_pct
    from public.puntaje_perfect_store p
    join public.levantamiento l on l.id = p.levantamiento_id
    join public.visita v on v.id = l.visita_id
    join public.tienda t on t.id = v.tienda_id
    join public.cadena c on c.id = t.cadena_id
    cross join ventana w
    where p_nivel <> 'categoria'
      and p_categoria is null
      and v.check_in_recibido_at >= w.inicio
      and v.check_in_recibido_at < w.fin
      and (p_marca is null or l.marca_id = p_marca)
      and (p_tipo_tienda is null or c.tipo_tienda = p_tipo_tienda)
      and (p_cadena is null or t.cadena_id = p_cadena)
      and (p_tienda is null or v.tienda_id = p_tienda)
  )
  select clave, etiqueta, count(*),
         round(avg(total_pct), 2),
         round(avg(distribucion_pct), 2),
         round(avg(visibilidad_pct), 2),
         round(avg(precio_pct), 2)
  from filas
  group by clave, etiqueta
  -- Por puntaje ascendente: lo primero que se busca en un tablero de ejecución
  -- es dónde se está fallando. Los nulos al final — un grupo sin puntaje no es
  -- el peor, es uno del que todavía no se sabe nada.
  order by round(avg(total_pct), 2) asc nulls last, etiqueta;
$$;

comment on function public.perfect_store_desglose(
  date, date, public.nivel_perfect_store, uuid, uuid, public.tipo_tienda, uuid, uuid) is
  'Perfect Store agrupado por un nivel del drill-down (categoría, tipo de tienda, cadena o tienda) dentro de la selección. Ordenado por puntaje ascendente: el tablero se abre por donde se está fallando.';

grant execute on function public.perfect_store_desglose(
  date, date, public.nivel_perfect_store, uuid, uuid, public.tipo_tienda, uuid, uuid)
  to authenticated, service_role;
