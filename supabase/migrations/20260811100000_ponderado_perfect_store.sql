-- El ponderado total de Perfect Store y su desglose por categoría.
--
-- Cierra la métrica: junta las variables en un número único aplicando los pesos
-- de la configuración resuelta, y lo deja consultable por categoría, tipo de
-- tienda y periodo — "si yo quiero ver cuál es mi puntaje Perfect Store en la
-- categoría tal, en este tipo de tienda, también lo puedas ver".
--
-- El piloto evalúa TRES de las cinco variables (las otras dos son 🟡). No hace
-- falta esperarlas: la renormalización reparte sus pesos entre las evaluadas, y
-- el día que existan empiezan a contar sin tocar el ponderador. La política de
-- POP (tope o bonus sobre 100) se queda en su ticket, que es el único que puede
-- probarla con datos de POP reales.

alter table public.puntaje_perfect_store
  add column total_pct numeric(5, 2) check (total_pct between 0 and 100);

comment on column public.puntaje_perfect_store.total_pct is
  'El ponderado de las variables EVALUADAS, renormalizado. NULL si no se evaluó ninguna.';

-- ---------------------------------------------------------------------------
-- La ponderación, con un solo dueño.
--
-- Renormaliza sobre lo evaluado: una variable NULL no puntúa cero, su peso se
-- reparte entre las demás. Un cero silencioso convertiría una visita incompleta
-- en una tienda mal ejecutada — y de estos números salen bonos.
--
-- `immutable`: solo depende de sus argumentos. Así el planificador puede
-- evaluarla una vez por fila sin releer nada.
-- ---------------------------------------------------------------------------
create function app.ponderar_perfect_store(
  p_config       public.config_perfect_store,
  p_distribucion numeric,
  p_visibilidad  numeric,
  p_precio       numeric,
  -- Las dos variables que el piloto todavía no evalúa. Se declaran para que el
  -- día que existan no haya que tocar esta función ni a quien la llama.
  p_pop          numeric default null,
  p_orden        numeric default null
)
returns numeric
language sql
immutable
as $$
  select case
    -- Sin peso evaluado no hay ponderado. Pasa si no se evaluó ninguna variable,
    -- y también si las evaluadas pesan cero — dividir ahí daría un error, no un
    -- puntaje.
    when coalesce(peso_evaluado, 0) = 0 then null
    else round(suma / peso_evaluado, 2)
  end
  from (
    select
      sum(peso) filter (where valor is not null) as peso_evaluado,
      sum(peso * valor) filter (where valor is not null) as suma
    from (values
      (p_config.peso_distribucion, p_distribucion),
      (p_config.peso_visibilidad,  p_visibilidad),
      (p_config.peso_precio,       p_precio),
      (p_config.peso_pop,          p_pop),
      (p_config.peso_orden,        p_orden)
    ) as v(peso, valor)
  ) t;
$$;

comment on function app.ponderar_perfect_store(public.config_perfect_store, numeric, numeric, numeric, numeric, numeric) is
  'El ponderado de Perfect Store sobre las variables EVALUADAS. Una variable NULL renormaliza su peso entre las demás, nunca puntúa cero.';

revoke execute on function app.ponderar_perfect_store(
  public.config_perfect_store, numeric, numeric, numeric, numeric, numeric) from public;
grant execute on function app.ponderar_perfect_store(
  public.config_perfect_store, numeric, numeric, numeric, numeric, numeric)
  to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- El desglose por categoría.
--
-- No es una agregación del puntaje por levantamiento: ese abarca varias
-- categorías a la vez. Distribución y precio SÍ se pueden partir —son por SKU, y
-- el SKU tiene categoría— pero la visibilidad NO: hay una sola medición de share
-- of shelf por marca y visita, y no se puede repartir entre categorías sin
-- inventarla. Así que en cada fila de aquí la visibilidad va nula y su peso se
-- renormaliza, que es exactamente el mecanismo que ya existe.
--
-- Consecuencia que conviene tener presente: el puntaje de una categoría y el
-- total NO son la misma cuenta con distinto filtro. Son dos números con distinto
-- conjunto de variables evaluadas.
-- ---------------------------------------------------------------------------
create table public.puntaje_perfect_store_categoria (
  levantamiento_id uuid not null
    references public.levantamiento (id) on delete cascade,
  categoria_id uuid not null references public.categoria (id) on delete restrict,
  tenant_id uuid not null references public.tenant (id) on delete restrict,
  config_id uuid not null
    references public.config_perfect_store (id) on delete restrict,

  distribucion_pct numeric(5, 2) check (distribucion_pct between 0 and 100),
  precio_pct       numeric(5, 2) check (precio_pct between 0 and 100),
  total_pct        numeric(5, 2) check (total_pct between 0 and 100),

  skus_codificados      integer not null default 0,
  skus_evaluados        integer not null default 0,
  skus_presentes        integer not null default 0,
  skus_precio_evaluados integer not null default 0,
  skus_precio_correctos integer not null default 0,

  calculado_at timestamptz not null default now(),
  primary key (levantamiento_id, categoria_id)
);

create index puntaje_ps_cat_tenant_idx
  on public.puntaje_perfect_store_categoria (tenant_id);
create index puntaje_ps_cat_categoria_idx
  on public.puntaje_perfect_store_categoria (categoria_id);

comment on table public.puntaje_perfect_store_categoria is
  'El puntaje de Perfect Store por categoría dentro de un levantamiento. La visibilidad no se puede partir por categoría (una sola medición por visita), así que va nula y su peso se renormaliza.';

-- ---------------------------------------------------------------------------
-- El calculador, ampliado: el total y las filas por categoría.
--
-- Se recrea entero porque una función es su cuerpo. Lo anterior no cambia: se
-- añade la llamada al ponderador y el bloque por categoría.
-- ---------------------------------------------------------------------------
create or replace function app.calcular_puntaje_perfect_store(p_levantamiento_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  ctx        record;
  cfg        public.config_perfect_store;
  dist       record;
  sos        record;
  pre        record;
  v_dist_pct numeric(5, 2);
  v_vis_pct  numeric(5, 2);
  v_sos_real numeric(5, 2);
  v_pre_pct  numeric(5, 2);
begin
  select l.tenant_id, l.marca_id, l.estado, l.sos_frentes_propios,
         l.sos_frentes_competencia, v.tienda_id, t.cadena_id, c.tipo_tienda,
         (v.check_in_recibido_at at time zone 'America/Lima')::date as fecha
    into ctx
  from public.levantamiento l
  join public.visita v on v.id = l.visita_id
  join public.tienda t on t.id = v.tienda_id
  join public.cadena c on c.id = t.cadena_id
  where l.id = p_levantamiento_id;

  if not found then return; end if;

  if ctx.estado <> 'completado' then
    delete from public.puntaje_perfect_store where levantamiento_id = p_levantamiento_id;
    return;
  end if;

  cfg := app.config_perfect_store_aplicable(
    ctx.tenant_id, ctx.marca_id, null, ctx.tipo_tienda, ctx.fecha);
  if cfg.id is null then
    delete from public.puntaje_perfect_store where levantamiento_id = p_levantamiento_id;
    return;
  end if;

  select count(*)                                              as codificados,
         count(ls.id)                                          as evaluados,
         count(ls.id) filter (where coalesce(ls.quiebre, false) = false) as presentes
    into dist
  from public.tienda_sku ts
  join public.sku s
    on s.id = ts.sku_id and s.tenant_id = ts.tenant_id
  left join public.levantamiento_sku ls
    on ls.levantamiento_id = p_levantamiento_id and ls.sku_id = ts.sku_id
  where ts.tenant_id = ctx.tenant_id
    and ts.tienda_id = ctx.tienda_id
    and ts.activo
    and s.marca_id = ctx.marca_id
    and s.activo;

  v_dist_pct := round(100.0 * dist.presentes / nullif(dist.evaluados, 0), 2);

  select ctx.sos_frentes_propios as propios,
         coalesce(comp.total, 0) as competencia
    into sos
  from (select sum((e->>'frentes')::numeric) as total
        from jsonb_array_elements(ctx.sos_frentes_competencia) e) comp;

  if sos.propios is not null and (sos.propios + sos.competencia) > 0 then
    v_sos_real := round(100.0 * sos.propios / (sos.propios + sos.competencia), 2);
    v_vis_pct := least(100, round(100.0 * v_sos_real / cfg.sos_objetivo_pct, 2));
  end if;

  select count(*) filter (
           where v.veredicto <> 'sin_precio_vigente') as evaluados,
         count(*) filter (where v.veredicto = 'correcto') as correctos
    into pre
  from public.levantamiento_sku ls
  cross join lateral app.evaluar_precio_sku(
    ls.tenant_id, ls.sku_id, ctx.marca_id, ctx.cadena_id, ls.precio_registrado,
    ls.hay_promo, ls.promo_comunicada, ctx.fecha) v
  where ls.levantamiento_id = p_levantamiento_id
    and ls.precio_registrado is not null;

  v_pre_pct := round(100.0 * pre.correctos / nullif(pre.evaluados, 0), 2);

  insert into public.puntaje_perfect_store (
    levantamiento_id, tenant_id, config_id,
    distribucion_pct, visibilidad_pct, precio_pct, total_pct,
    skus_codificados, skus_evaluados, skus_presentes,
    skus_precio_evaluados, skus_precio_correctos, sos_real_pct, calculado_at)
  values (
    p_levantamiento_id, ctx.tenant_id, cfg.id,
    v_dist_pct, v_vis_pct, v_pre_pct,
    app.ponderar_perfect_store(cfg, v_dist_pct, v_vis_pct, v_pre_pct),
    dist.codificados, dist.evaluados, dist.presentes,
    pre.evaluados, pre.correctos, v_sos_real, now())
  on conflict (levantamiento_id) do update set
    config_id = excluded.config_id,
    distribucion_pct = excluded.distribucion_pct,
    visibilidad_pct = excluded.visibilidad_pct,
    precio_pct = excluded.precio_pct,
    total_pct = excluded.total_pct,
    skus_codificados = excluded.skus_codificados,
    skus_evaluados = excluded.skus_evaluados,
    skus_presentes = excluded.skus_presentes,
    skus_precio_evaluados = excluded.skus_precio_evaluados,
    skus_precio_correctos = excluded.skus_precio_correctos,
    sos_real_pct = excluded.sos_real_pct,
    calculado_at = excluded.calculado_at;

  -- --- El desglose por categoría -------------------------------------------
  --
  -- Se recalcula entero: borrar y reinsertar es lo único que retira una fila de
  -- una categoría que dejó de tener SKUs codificados. Un upsert la dejaría ahí
  -- para siempre con datos viejos.
  --
  -- Un SKU SIN categoría cuenta en el total pero no aparece en ningún corte:
  -- no se le puede atribuir uno. Es visible en la diferencia entre los
  -- codificados del total y la suma de los codificados por categoría.
  delete from public.puntaje_perfect_store_categoria
  where levantamiento_id = p_levantamiento_id;

  insert into public.puntaje_perfect_store_categoria (
    levantamiento_id, categoria_id, tenant_id, config_id,
    distribucion_pct, precio_pct, total_pct,
    skus_codificados, skus_evaluados, skus_presentes,
    skus_precio_evaluados, skus_precio_correctos)
  select
    p_levantamiento_id, x.categoria_id, ctx.tenant_id, cfg.id,
    x.dist_pct, x.pre_pct,
    -- La visibilidad va NULA a propósito: su peso se renormaliza.
    app.ponderar_perfect_store(cfg, x.dist_pct, null, x.pre_pct),
    x.codificados, x.evaluados, x.presentes,
    x.precio_evaluados, x.precio_correctos
  from (
    select
      s.categoria_id,
      count(*) as codificados,
      count(ls.id) as evaluados,
      count(ls.id) filter (where coalesce(ls.quiebre, false) = false) as presentes,
      round(100.0 * count(ls.id) filter (where coalesce(ls.quiebre, false) = false)
            / nullif(count(ls.id), 0), 2) as dist_pct,
      count(v.veredicto) filter (
        where v.veredicto <> 'sin_precio_vigente') as precio_evaluados,
      count(v.veredicto) filter (where v.veredicto = 'correcto') as precio_correctos,
      round(100.0 * count(v.veredicto) filter (where v.veredicto = 'correcto')
            / nullif(count(v.veredicto) filter (
                where v.veredicto <> 'sin_precio_vigente'), 0), 2) as pre_pct
    from public.tienda_sku ts
    join public.sku s
      on s.id = ts.sku_id and s.tenant_id = ts.tenant_id
    left join public.levantamiento_sku ls
      on ls.levantamiento_id = p_levantamiento_id and ls.sku_id = ts.sku_id
    left join lateral app.evaluar_precio_sku(
      ctx.tenant_id, ts.sku_id, ctx.marca_id, ctx.cadena_id, ls.precio_registrado,
      ls.hay_promo, ls.promo_comunicada, ctx.fecha) v
      on ls.precio_registrado is not null
    where ts.tenant_id = ctx.tenant_id
      and ts.tienda_id = ctx.tienda_id
      and ts.activo
      and s.marca_id = ctx.marca_id
      and s.activo
      and s.categoria_id is not null
    group by s.categoria_id
  ) x;
end;
$$;

-- ---------------------------------------------------------------------------
-- Los agregados para los tableros.
--
-- `security invoker` y `stable`, como `dashboard_kpis`: la RLS acota qué
-- levantamientos entran, así que no hace falta filtrar por tenant a mano.
--
-- La ventana va MEDIO ABIERTA sobre la columna cruda (`>= desde` y `< hasta+1`).
-- Un `check_in_recibido_at::date between …` haría un cast por fila que anula el
-- índice y fuerza un rescan — en `visita` eso es la diferencia entre un tablero
-- y un timeout.
--
-- Las fechas entran como días de LIMA y se convierten a instantes aquí: el día
-- del negocio es el de Lima, y un rango calculado en UTC se come las últimas
-- cinco horas de la jornada, que es justo el turno de cierre de tienda.
-- ---------------------------------------------------------------------------
create function public.perfect_store_agregado(
  p_desde        date,
  p_hasta        date,
  p_marca        uuid default null,
  p_categoria    uuid default null,
  p_tipo_tienda  public.tipo_tienda default null,
  p_tienda       uuid default null,
  p_mercaderista uuid default null
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
    -- Con categoría se lee el desglose; sin ella, el puntaje del levantamiento.
    -- No son la misma cuenta con distinto filtro: el corte por categoría no
    -- evalúa visibilidad, y eso es deliberado.
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
      and (p_tienda is null or v.tienda_id = p_tienda)
      and (p_mercaderista is null or v.mercaderista_id = p_mercaderista)
  )
  select count(*),
         -- El promedio IGNORA los nulos por definición: un levantamiento sin
         -- puntaje no hunde la media, igual que una variable no evaluada no
         -- puntúa cero.
         round(avg(total_pct), 2),
         round(avg(distribucion_pct), 2),
         round(avg(visibilidad_pct), 2),
         round(avg(precio_pct), 2)
  from filas;
$$;

comment on function public.perfect_store_agregado(date, date, uuid, uuid, public.tipo_tienda, uuid, uuid) is
  'Perfect Store agregado en una ventana de días de Lima, filtrable por marca, categoría, tipo de tienda, tienda y mercaderista. Con categoría devuelve el desglose (sin visibilidad); sin ella, el puntaje del levantamiento.';

grant execute on function public.perfect_store_agregado(
  date, date, uuid, uuid, public.tipo_tienda, uuid, uuid)
  to authenticated, service_role;

-- --- GRANTs y RLS del desglose ---------------------------------------------
grant select on public.puntaje_perfect_store_categoria to authenticated;
grant all on public.puntaje_perfect_store_categoria to service_role;

alter table public.puntaje_perfect_store_categoria enable row level security;

create policy puntaje_ps_cat_staff_lee on public.puntaje_perfect_store_categoria
  for select to authenticated using ((select app.es_staff()));
create policy puntaje_ps_cat_usuario_lee_su_tenant on public.puntaje_perfect_store_categoria
  for select to authenticated using (tenant_id = (select app.tenant_actual()));
