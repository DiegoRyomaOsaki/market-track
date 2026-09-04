-- La categoría de producto: el eje por el que se pondera Perfect Store.
--
-- El puntaje no se pondera por SKU sino por CATEGORÍA y por tipo de tienda
-- (3ª revisión con el cliente, ago 2026). Hoy `sku` cuelga solo de `marca` y no
-- existe ningún eje por el que agrupar, así que no hay nada que ponderar.
--
-- La categoría es del CLIENTE, no de la marca: "Bebidas" agrupa SKUs de varias
-- marcas del mismo cliente, y es así como el cliente mira su negocio.
--
-- Despliegue ADITIVO: primero la columna (nullable), luego la carga del maestro,
-- y solo después el consumo. Un SKU sin categoría tiene que seguir funcionando
-- mientras el maestro se llena — si no, esta migración rompe el piloto el día que
-- entra y obliga a cargar todas las categorías antes de poder trabajar.

create table public.categoria (
  id             uuid primary key default gen_random_uuid(),
  tenant_id      uuid not null references public.tenant (id) on delete restrict,
  nombre         text not null,
  -- El código que usa el CLIENTE en su Excel: la clave natural del upsert del
  -- importador. Sin ella, la segunda importación duplicaría las categorías.
  codigo_externo text,
  activo         boolean not null default true,
  creado_at      timestamptz not null default now(),
  unique (tenant_id, codigo_externo),
  -- Lo que hace posible la FK compuesta de `sku`: sin este unique, Postgres no
  -- deja referenciar el par (id, tenant_id).
  constraint categoria_id_tenant_uq unique (id, tenant_id)
);

create index categoria_tenant_id_idx on public.categoria (tenant_id);

-- Nullable a propósito (ver arriba). La FK es COMPUESTA con `tenant_id`, igual
-- que `sku_marca_fk`: es lo único que impide que un SKU apunte a la categoría de
-- otro cliente. Una FK sobre `categoria_id` a secas lo permitiría, y la RLS no
-- ayudaría — el admin ve todos los clientes.
alter table public.sku add column categoria_id uuid;

alter table public.sku add constraint sku_categoria_fk
  foreign key (categoria_id, tenant_id)
  references public.categoria (id, tenant_id) on delete restrict;

create index sku_categoria_id_idx on public.sku (categoria_id);

comment on column public.sku.categoria_id is
  'Eje de ponderación de Perfect Store. Nullable: un SKU sin categoría es válido mientras se carga el maestro.';

-- --- GRANTs -----------------------------------------------------------------
--
-- El GRANT es la puerta y la RLS el portero: sin esto las políticas de abajo no
-- se evalúan nunca y la consulta muere con 42501 antes de llegar a ellas.
--
-- Sin `delete`, como el resto del catálogo: las bajas son lógicas (`activo`).
-- Borrar una categoría en duro se llevaría por delante la referencia de los SKUs
-- que la usan — de ahí también el `on delete restrict`.
grant select, insert, update on public.categoria to authenticated;
grant all on public.categoria to service_role;

-- --- RLS --------------------------------------------------------------------
alter table public.categoria enable row level security;

create policy categoria_staff_lee on public.categoria for select to authenticated
  using ((select app.es_staff()));
create policy categoria_usuario_lee_su_tenant on public.categoria for select to authenticated
  using (tenant_id = (select app.tenant_actual()));
create policy categoria_admin_escribe on public.categoria for all to authenticated
  using ((select app.rol_actual()) = 'admin')
  with check ((select app.rol_actual()) = 'admin');
