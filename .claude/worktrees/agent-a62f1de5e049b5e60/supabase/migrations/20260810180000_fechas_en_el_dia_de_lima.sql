-- Las fechas de vigencia nacen con el día de LIMA, no con el de UTC.
--
-- `current_date` en el servidor es la fecha UTC. Entre las 19:00 y medianoche de
-- Lima ya rodó al día siguiente, así que un precio que un admin da de alta a las
-- 20:00 nace `vigente_desde` MAÑANA — y no está vigente durante el resto de la
-- jornada en la que se creó. Nadie lo nota: la fila existe, el listado la muestra,
-- y simplemente no se aplica.
--
-- Se vio al comparar `vigente_desde <= <fecha de la visita en Lima>` en la regla
-- de precio: con la base sembrada a las 19:18 de Lima, el precio del seed tenía
-- fecha de mañana y ningún SKU tenía precio vigente.
--
-- CLAUDE.md ya lo dice para las ventanas de los dashboards; esto es la misma
-- regla en el otro extremo, el de la escritura.

create function app.hoy_lima()
returns date
language sql
stable
security invoker
set search_path = ''
as $$
  select (now() at time zone 'America/Lima')::date;
$$;

comment on function app.hoy_lima() is
  'El día de calendario en Lima (UTC-5). El "hoy" del negocio: `current_date` da el de UTC y entre las 19:00 y medianoche ya rodó al día siguiente.';

revoke execute on function app.hoy_lima() from public;
grant execute on function app.hoy_lima() to authenticated, service_role;

alter table public.precio_regular
  alter column vigente_desde set default app.hoy_lima();
alter table public.config_perfect_store
  alter column vigente_desde set default app.hoy_lima();

-- El parámetro por defecto de la resolución, por el mismo motivo: quien no pasa
-- fecha quiere decir "ahora", y ahora es en Lima.
create or replace function app.config_perfect_store_aplicable(
  p_tenant_id    uuid,
  p_marca_id     uuid,
  p_categoria_id uuid,
  p_tipo_tienda  public.tipo_tienda,
  p_fecha        date default app.hoy_lima()
)
returns public.config_perfect_store
language sql
stable
security invoker
set search_path = ''
as $$
  select c.*
  from public.config_perfect_store c
  where c.tenant_id = p_tenant_id
    and c.marca_id = p_marca_id
    and c.vigente_desde <= p_fecha
    and (c.categoria_id is null or c.categoria_id = p_categoria_id)
    and (c.tipo_tienda  is null or c.tipo_tienda  = p_tipo_tienda)
  order by
    (c.categoria_id is not null)::int * 2 + (c.tipo_tienda is not null)::int desc,
    c.vigente_desde desc,
    c.id
  limit 1;
$$;
