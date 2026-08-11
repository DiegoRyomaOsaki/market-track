-- El motor de puntaje de Perfect Store: las tres variables objetivas.
--
-- Se calcula EN LA BASE y se persiste junto a la configuración que lo produjo
-- (ADR-0011). Un puntaje duplicado en TypeScript divergiría del que ve el cliente
-- en el portal, y un puntaje recalculado al vuelo se movería al reajustar los
-- pesos — justo lo que no se puede aceptar cuando esos números pagan bonos.
--
-- Este ticket calcula LAS TRES VARIABLES. El ponderado total y los agregados son
-- otro (MAR-99). Aquí cada variable sale 0–100 o NULL si no se pudo evaluar; que
-- un null renormalice en vez de contar como cero es mecánica del total.
--
-- La configuración se resuelve al nivel de MARCA (categoría nula). El puntaje es
-- por levantamiento —una marca en una visita— y abarca SKUs de varias categorías
-- a la vez, así que no hay una sola categoría que resolver. Además, el único
-- dato que depende de la configuración aquí es el objetivo de share of shelf, y
-- el SOS se mide por levantamiento, no por categoría. La ponderación por
-- categoría entra al agregar (MAR-99).

create table public.puntaje_perfect_store (
  levantamiento_id uuid primary key
    references public.levantamiento (id) on delete cascade,
  tenant_id uuid not null references public.tenant (id) on delete restrict,
  -- Con QUÉ configuración se calculó. Es el invariante de ADR-0011: sin esta
  -- referencia, reajustar los pesos reescribiría la historia.
  config_id uuid not null
    references public.config_perfect_store (id) on delete restrict,

  -- Las tres variables. NULL = no se pudo evaluar, que NO es lo mismo que cero:
  -- un cero silencioso convierte una visita incompleta en una tienda mal
  -- ejecutada.
  distribucion_pct numeric(5, 2) check (distribucion_pct between 0 and 100),
  visibilidad_pct  numeric(5, 2) check (visibilidad_pct  between 0 and 100),
  precio_pct       numeric(5, 2) check (precio_pct       between 0 and 100),

  -- La cobertura: sin ella, un 100 sobre un solo SKU evaluado se lee igual que
  -- un 100 sobre cuarenta, y no valen lo mismo.
  skus_codificados      integer not null default 0,
  skus_evaluados        integer not null default 0,
  skus_presentes        integer not null default 0,
  skus_precio_evaluados integer not null default 0,
  skus_precio_correctos integer not null default 0,
  -- El share of shelf real que se midió, antes de compararlo con el objetivo.
  -- Se guarda porque explica el puntaje: un 50 sobre un objetivo de 40 y un 50
  -- sobre uno de 80 son la misma medición y puntajes muy distintos.
  sos_real_pct numeric(5, 2) check (sos_real_pct between 0 and 100),

  calculado_at timestamptz not null default now()
);

create index puntaje_ps_tenant_idx on public.puntaje_perfect_store (tenant_id);
create index puntaje_ps_config_idx on public.puntaje_perfect_store (config_id);

comment on table public.puntaje_perfect_store is
  'Las tres variables objetivas de Perfect Store por levantamiento, con la configuración que las produjo. NULL en una variable significa "no evaluada", nunca cero.';

-- ---------------------------------------------------------------------------
-- El calculador.
--
-- `security definer` porque escribe una tabla que `authenticated` no puede
-- escribir: el puntaje lo produce el servidor, igual que las alertas. Si la app
-- pudiera escribirlo, el número dejaría de ser el mismo para todos.
-- ---------------------------------------------------------------------------
create function app.calcular_puntaje_perfect_store(p_levantamiento_id uuid)
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
         -- El día del negocio es el de Lima. Y se toma de la hora que SELLA EL
         -- SERVIDOR, no de la que declara el teléfono: `check_in_at` se puede
         -- cambiar a mano, y de esta fecha depende qué precio y qué promo
         -- estaban vigentes.
         (v.check_in_recibido_at at time zone 'America/Lima')::date as fecha
    into ctx
  from public.levantamiento l
  join public.visita v on v.id = l.visita_id
  join public.tienda t on t.id = v.tienda_id
  join public.cadena c on c.id = t.cadena_id
  where l.id = p_levantamiento_id;

  if not found then return; end if;

  -- Un levantamiento omitido por contingencia NO puntúa cero: no se evaluó, y no
  -- se le crea fila. Si quedara una en cero, la tienda aparecería mal ejecutada
  -- por algo que el mercaderista no pudo hacer.
  if ctx.estado <> 'completado' then
    delete from public.puntaje_perfect_store where levantamiento_id = p_levantamiento_id;
    return;
  end if;

  -- Sin configuración no hay Perfect Store: no se inventa un default, porque un
  -- puntaje sin pesos acordados no es comparable con ninguno.
  cfg := app.config_perfect_store_aplicable(
    ctx.tenant_id, ctx.marca_id, null, ctx.tipo_tienda, ctx.fecha);
  if cfg.id is null then
    delete from public.puntaje_perfect_store where levantamiento_id = p_levantamiento_id;
    return;
  end if;

  -- --- 1. Distribución / disponibilidad ------------------------------------
  --
  -- Contra el surtido ideal de ESA tienda (la matriz de codificados). Un SKU en
  -- quiebre no cuenta como presente. Un SKU codificado que no se levantó no
  -- entra en el denominador: "sin dato" no es "ausente", y meterlo hundiría el
  -- puntaje por una visita incompleta.
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

  -- --- 2. Visibilidad (share of shelf) -------------------------------------
  --
  -- El real contra el objetivo, con TOPE EN 100: superar el objetivo no compensa
  -- otra variable. La unidad (frentes o centímetros) la declara la
  -- configuración, pero no cambia la cuenta: es una proporción, y ambos lados se
  -- miden igual.
  select ctx.sos_frentes_propios as propios,
         coalesce(comp.total, 0) as competencia
    into sos
  from (select sum((e->>'frentes')::numeric) as total
        from jsonb_array_elements(ctx.sos_frentes_competencia) e) comp;

  if sos.propios is not null and (sos.propios + sos.competencia) > 0 then
    v_sos_real := round(100.0 * sos.propios / (sos.propios + sos.competencia), 2);
    v_vis_pct := least(100, round(100.0 * v_sos_real / cfg.sos_objetivo_pct, 2));
  end if;

  -- --- 3. Precio y promoción -----------------------------------------------
  --
  -- Correctos sobre evaluados. Un SKU sin precio vigente contra el que comparar
  -- no entra en el denominador: falta el maestro, no falla la tienda. La regla
  -- es la MISMA que usa el motor de alertas — un solo dueño.
  select count(*) filter (
           where v.veredicto <> 'sin_precio_vigente') as evaluados,
         count(*) filter (where v.veredicto = 'correcto') as correctos
    into pre
  from public.levantamiento_sku ls
  cross join lateral (
    select app.evaluar_precio_sku(
      ls.tenant_id, ls.sku_id, ctx.marca_id, ctx.cadena_id, ls.precio_registrado,
      ls.hay_promo, ls.promo_comunicada, ctx.fecha) as veredicto
  ) v
  where ls.levantamiento_id = p_levantamiento_id
    and ls.precio_registrado is not null;

  v_pre_pct := round(100.0 * pre.correctos / nullif(pre.evaluados, 0), 2);

  insert into public.puntaje_perfect_store (
    levantamiento_id, tenant_id, config_id,
    distribucion_pct, visibilidad_pct, precio_pct,
    skus_codificados, skus_evaluados, skus_presentes,
    skus_precio_evaluados, skus_precio_correctos, sos_real_pct, calculado_at)
  values (
    p_levantamiento_id, ctx.tenant_id, cfg.id,
    v_dist_pct, v_vis_pct, v_pre_pct,
    dist.codificados, dist.evaluados, dist.presentes,
    pre.evaluados, pre.correctos, v_sos_real, now())
  -- Recalcular sustituye: el puntaje de un levantamiento es uno, no un historial.
  -- El histórico estable lo da `config_id`, no acumular filas.
  on conflict (levantamiento_id) do update set
    config_id = excluded.config_id,
    distribucion_pct = excluded.distribucion_pct,
    visibilidad_pct = excluded.visibilidad_pct,
    precio_pct = excluded.precio_pct,
    skus_codificados = excluded.skus_codificados,
    skus_evaluados = excluded.skus_evaluados,
    skus_presentes = excluded.skus_presentes,
    skus_precio_evaluados = excluded.skus_precio_evaluados,
    skus_precio_correctos = excluded.skus_precio_correctos,
    sos_real_pct = excluded.sos_real_pct,
    calculado_at = excluded.calculado_at;
end;
$$;

revoke execute on function app.calcular_puntaje_perfect_store(uuid) from public;
grant execute on function app.calcular_puntaje_perfect_store(uuid)
  to authenticated, service_role;

comment on function app.calcular_puntaje_perfect_store(uuid) is
  'Calcula y persiste las tres variables objetivas de Perfect Store de un levantamiento, con la configuración vigente en la fecha de la visita. Un levantamiento no completado o sin configuración no deja fila.';

-- ---------------------------------------------------------------------------
-- Cuándo se calcula: al completar el levantamiento.
--
-- En `after update` y no en `before`: los `levantamiento_sku` ya están escritos
-- cuando el wizard cierra el levantamiento, y calcular antes leería una foto a
-- medias. Se dispara solo en la TRANSICIÓN a completado — sin el `distinct from`,
-- cualquier update posterior recalcularía y movería `calculado_at` sin motivo.
-- ---------------------------------------------------------------------------
create function app.puntuar_al_completar()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform app.calcular_puntaje_perfect_store(new.id);
  return null;
end;
$$;

revoke execute on function app.puntuar_al_completar() from public;

create trigger levantamiento_puntua_al_completar
  after update of estado on public.levantamiento
  for each row
  when (new.estado is distinct from old.estado)
  execute function app.puntuar_al_completar();

-- ---------------------------------------------------------------------------
-- GRANTs y RLS
--
-- El puntaje lo escribe el SERVIDOR, igual que las alertas: `authenticated` solo
-- lee. Sin `insert` ni `update`, una app no puede maquillar su propio número.
-- ---------------------------------------------------------------------------
grant select on public.puntaje_perfect_store to authenticated;
grant all on public.puntaje_perfect_store to service_role;

alter table public.puntaje_perfect_store enable row level security;

create policy puntaje_ps_staff_lee on public.puntaje_perfect_store for select to authenticated
  using ((select app.es_staff()));
-- El cliente-marca ve su puntaje: es lo que compra.
create policy puntaje_ps_usuario_lee_su_tenant on public.puntaje_perfect_store for select to authenticated
  using (tenant_id = (select app.tenant_actual()));
