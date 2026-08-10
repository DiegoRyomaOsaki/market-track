-- La configuración de Perfect Store: qué pesa cada variable y contra qué objetivo.
--
-- El peso y el objetivo los fija LA MARCA, no nosotros (3ª revisión con el
-- cliente, ago 2026). Aquí vive esa configuración; el cálculo es otro ticket.
--
-- FILAS INMUTABLES. Cambiar la configuración es insertar otra con una
-- `vigente_desde` nueva, nunca editar la que hay. Lo exige ADR-0011: cada puntaje
-- se persiste junto a la configuración con la que se calculó, y un puntaje de
-- marzo no puede moverse porque en agosto alguien reajustó una ponderación. Es el
-- mismo patrón que `precio_regular`, que ya lleva la fecha en su clave natural.
--
-- La tolerancia de precio NO se replica aquí: vive en `marca.tolerancia_precio_pct`
-- y la usa el motor de alertas. Un segundo dueño divergiría, y el cliente vería
-- dos verdades sobre el mismo SKU.

-- Cómo se mide el share of shelf. El cliente lo dijo en la reunión: "ahí se mide
-- por frentes o se mide por distancia real". `frentes`, nunca "caras" ni
-- "facings" — el término lo fijó el cliente.
create type public.unidad_sos as enum ('frentes', 'centimetros');

-- Qué hace el material POP cuando se supera lo comprometido: o queda acotado al
-- tope de 100, o suma por encima. Es decisión POR MARCA, no una constante.
create type public.politica_pop as enum ('dentro_del_tope', 'bonus_sobre_100');

create table public.config_perfect_store (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references public.tenant (id) on delete restrict,
  -- La marca es el PISO: siempre hay una fila a este nivel. Categoría y tipo de
  -- tienda solo la afinan.
  marca_id      uuid not null,
  -- Null = aplica a todas. La fila más específica gana al resolver.
  categoria_id  uuid,
  tipo_tienda   public.tipo_tienda,

  -- Los cinco pesos. Suman 100 SIEMPRE, aunque en el piloto solo se evalúen tres
  -- variables: una que no se evalúa renormaliza su peso entre las demás, no
  -- puntúa cero. Declararlas todas desde ya es lo que hace posible esa
  -- renormalización sin adivinar.
  peso_distribucion numeric(5, 2) not null check (peso_distribucion >= 0 and peso_distribucion <= 100),
  peso_visibilidad  numeric(5, 2) not null check (peso_visibilidad  >= 0 and peso_visibilidad  <= 100),
  peso_precio       numeric(5, 2) not null check (peso_precio       >= 0 and peso_precio       <= 100),
  peso_pop          numeric(5, 2) not null check (peso_pop          >= 0 and peso_pop          <= 100),
  peso_orden        numeric(5, 2) not null check (peso_orden        >= 0 and peso_orden        <= 100),

  sos_objetivo_pct  numeric(5, 2) not null
    check (sos_objetivo_pct > 0 and sos_objetivo_pct <= 100),
  sos_unidad        public.unidad_sos not null default 'frentes',
  politica_pop      public.politica_pop not null default 'dentro_del_tope',

  -- Cuánto vale cada nivel de la escala cualitativa de orden y limpieza. No la
  -- puntúa el mercaderista —"es juez y parte"—; lo que vale cada nivel es
  -- configuración de la marca.
  orden_bien_pts    numeric(5, 2) not null default 100 check (orden_bien_pts    between 0 and 100),
  orden_regular_pts numeric(5, 2) not null default 50  check (orden_regular_pts between 0 and 100),
  orden_mal_pts     numeric(5, 2) not null default 0   check (orden_mal_pts     between 0 and 100),

  vigente_desde date not null default current_date,
  creado_at     timestamptz not null default now(),
  creado_por    uuid references public.profile (id) on delete set null,

  -- El contrato del que depende toda la ponderación. Sin esto, un puntaje sobre
  -- 100 dejaría de significar lo mismo entre dos marcas.
  constraint config_ps_pesos_suman_100 check (
    peso_distribucion + peso_visibilidad + peso_precio + peso_pop + peso_orden = 100
  ),
  -- Un nivel "regular" que valiera más que "bien" invertiría la escala en
  -- silencio: el puntaje saldría, pero premiando lo contrario.
  constraint config_ps_escala_ordenada check (
    orden_bien_pts >= orden_regular_pts and orden_regular_pts >= orden_mal_pts
  ),

  -- `nulls not distinct` porque categoría y tipo de tienda son nullables: sin
  -- ello, dos configuraciones "para todas las categorías" no colisionarían —en
  -- SQL dos nulos son distintos— y habría dos filas compitiendo por el mismo
  -- nivel de especificidad.
  constraint config_ps_natural_uq unique nulls not distinct
    (tenant_id, marca_id, categoria_id, tipo_tienda, vigente_desde),

  -- FK compuestas con `tenant_id`, como el resto del catálogo: es lo que impide
  -- ponderar la marca de un cliente con la categoría de otro.
  constraint config_ps_marca_fk foreign key (marca_id, tenant_id)
    references public.marca (id, tenant_id) on delete restrict,
  constraint config_ps_categoria_fk foreign key (categoria_id, tenant_id)
    references public.categoria (id, tenant_id) on delete restrict
);

create index config_ps_tenant_idx on public.config_perfect_store (tenant_id);
-- El índice de la resolución: se busca siempre por marca y se ordena por fecha.
create index config_ps_resolucion_idx
  on public.config_perfect_store (tenant_id, marca_id, vigente_desde desc);

comment on table public.config_perfect_store is
  'Pesos y objetivos de Perfect Store por marca, afinables por categoría y tipo de tienda. Las filas son INMUTABLES: cambiar la configuración es insertar otra con una `vigente_desde` nueva (ADR-0011).';

-- ---------------------------------------------------------------------------
-- Inmutabilidad
--
-- Sin esto, editar una fila le cambiaría los pesos bajo los pies a todos los
-- puntajes ya calculados con ella — el invariante que ADR-0011 existe para
-- proteger. Mismo mecanismo que usa `formulario_version` con lo publicado.
-- ---------------------------------------------------------------------------
create function app.config_perfect_store_inmutable()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  raise exception 'una configuración de Perfect Store no se edita: inserta otra con una `vigente_desde` nueva'
    using errcode = 'check_violation';
end;
$$;

-- Una `security definer` nace ejecutable por PUBLIC. Un disparador no la invoca
-- por privilegio de quien escribe, así que nadie la pierde al revocarla — y
-- `app` no está expuesto por PostgREST, pero la higiene no debe depender de que
-- eso siga siendo cierto. Hay un test del harness que lo comprueba para todas.
revoke execute on function app.config_perfect_store_inmutable() from public;

create trigger config_ps_inmutable
  before update on public.config_perfect_store
  for each row execute function app.config_perfect_store_inmutable();

-- ---------------------------------------------------------------------------
-- La resolución: qué configuración aplica a una marca en una tienda, y cuándo.
--
-- Gana la fila MÁS ESPECÍFICA que aplique, y a igual especificidad la más
-- reciente que ya estuviera vigente en la fecha pedida. Esa fecha es lo que hace
-- que recalcular un puntaje viejo use la configuración de entonces y no la de
-- hoy: sin ella, el histórico se movería con cada reajuste.
--
-- `stable` y no `volatile`: no escribe nada y no cambia dentro de una misma
-- sentencia, así que el planificador puede sacarla de un bucle por fila. (No
-- promete nada a lo largo de toda la transacción — eso sería el nivel de
-- aislamiento, no la volatilidad.)
-- ---------------------------------------------------------------------------
create function app.config_perfect_store_aplicable(
  p_tenant_id    uuid,
  p_marca_id     uuid,
  p_categoria_id uuid,
  p_tipo_tienda  public.tipo_tienda,
  p_fecha        date default current_date
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
    -- Una fila acotada a una categoría o a un tipo solo aplica si coincide; una
    -- con null aplica a todas.
    and (c.categoria_id is null or c.categoria_id = p_categoria_id)
    and (c.tipo_tienda  is null or c.tipo_tienda  = p_tipo_tienda)
  order by
    -- Especificidad, y la CATEGORÍA pesa más que el tipo de tienda.
    --
    -- Sumar los dos ejes por igual los empataría: una fila acotada solo por
    -- categoría y otra solo por tipo de tienda valdrían 1 las dos, y ganaría la
    -- que el desempate escogiera — un resultado correcto pero inexplicable ante
    -- el cliente. La categoría manda porque es del producto, y así lo dijo él:
    -- "no es por SKU, es por categoría, por tipo tienda", en ese orden.
    --
    --   categoría + tipo = 3   categoría = 2   tipo = 1   ninguno = 0
    (c.categoria_id is not null)::int * 2 + (c.tipo_tienda is not null)::int desc,
    -- A igual especificidad, la vigente más reciente.
    c.vigente_desde desc,
    -- Desempate estable: con la clave natural no puede haber dos filas iguales
    -- hasta aquí, pero sin un orden total el resultado dependería del plan.
    c.id
  limit 1;
$$;

comment on function app.config_perfect_store_aplicable(uuid, uuid, uuid, public.tipo_tienda, date) is
  'La configuración de Perfect Store que aplica a una marca en una tienda en una fecha. Gana la fila más específica; a igual especificidad, la más recientemente vigente.';

-- ---------------------------------------------------------------------------
-- GRANTs y RLS
--
-- El GRANT es la puerta y la RLS el portero. Sin `delete`: una configuración
-- borrada dejaría huérfanos los puntajes que la referencian, y el histórico es
-- justamente lo que esta tabla protege.
-- ---------------------------------------------------------------------------
grant select, insert on public.config_perfect_store to authenticated;
grant all on public.config_perfect_store to service_role;
grant execute on function app.config_perfect_store_aplicable(uuid, uuid, uuid, public.tipo_tienda, date)
  to authenticated, service_role;

alter table public.config_perfect_store enable row level security;

create policy config_ps_staff_lee on public.config_perfect_store for select to authenticated
  using ((select app.es_staff()));
-- El cliente-marca ve su propia configuración: es la regla con la que se le mide.
create policy config_ps_usuario_lee_su_tenant on public.config_perfect_store for select to authenticated
  using (tenant_id = (select app.tenant_actual()));
create policy config_ps_admin_escribe on public.config_perfect_store for all to authenticated
  using ((select app.rol_actual()) = 'admin')
  with check ((select app.rol_actual()) = 'admin');
