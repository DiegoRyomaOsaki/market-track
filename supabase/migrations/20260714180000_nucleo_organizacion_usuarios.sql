-- Núcleo de organización y usuarios: tenant (el CLIENTE), marca y profile.
--
-- Dos cosas que hay que entender antes de tocar este archivo:
--
--   GRANT = la puerta.  RLS = el portero.
--   Una tabla nueva NO le da ni SELECT a `authenticated`. Sin el GRANT, la
--   consulta muere con 42501 "permission denied" ANTES de que ninguna política
--   se evalúe — y el error parece de RLS sin serlo. Toda tabla nueva necesita
--   las dos cosas.
--
--   Las funciones en una política SIEMPRE van envueltas en (select ...).
--   Sin el select, Postgres las evalúa UNA VEZ POR FILA; con él, una vez por
--   consulta (InitPlan). Medido sobre 200.000 filas: 42.480 ms contra 12,9 ms.
--   En `marca` (3 filas) da igual. En `visita` es un dashboard o un timeout.

-- PostGIS va en el schema `extensions`, que es la convención de Supabase: su
-- search_path ya lo incluye, así que `geography` y `ST_Distance` resuelven sin
-- calificar. OJO: dentro de una función con `SET search_path = ''` hay que
-- escribir `extensions.ST_DWithin(...)` — la validación de geocerca se lo comerá.
create extension if not exists postgis with schema extensions;

create type public.rol_usuario as enum ('admin', 'supervisor', 'mercaderista', 'cliente');

-- ---------------------------------------------------------------------------
-- tenant — el CLIENTE que contrata a la outsourcing (no la marca).
-- Es la frontera de aislamiento: todo dato de negocio lleva su tenant_id.
-- ---------------------------------------------------------------------------
create table public.tenant (
  id          uuid primary key default gen_random_uuid(),
  nombre      text not null,
  activo      boolean not null default true,
  creado_at   timestamptz not null default now()
);

comment on table public.tenant is
  'El CLIENTE que contrata a la outsourcing. Puede comercializar varias marcas.';
comment on column public.tenant.activo is
  'Al ponerse en false (el cliente cancela), TODOS sus mercaderistas pierden el acceso. Ver app.perfil_efectivo().';

-- ---------------------------------------------------------------------------
-- marca — marca comercial de un cliente (Oster, Sharpie…). El SKU cuelga de aquí.
-- ---------------------------------------------------------------------------
create table public.marca (
  id                    uuid primary key default gen_random_uuid(),
  tenant_id             uuid not null references public.tenant (id) on delete restrict,
  nombre                text not null,
  logo_url              text,
  -- La tolerancia vive en la MARCA, no en el cliente: cada marca tolera una
  -- desviación de precio distinta.
  tolerancia_precio_pct numeric(5, 2) not null default 0
    check (tolerancia_precio_pct >= 0 and tolerancia_precio_pct <= 100),
  -- El código que usa el CLIENTE en su Excel. Es la clave natural del upsert al
  -- importar: sin ella, la segunda importación duplicaría el catálogo entero.
  codigo_externo        text,
  activo                boolean not null default true,
  creado_at             timestamptz not null default now(),
  unique (tenant_id, codigo_externo)
);

create index marca_tenant_id_idx on public.marca (tenant_id);

-- ---------------------------------------------------------------------------
-- profile — usuario. Extiende auth.users.
-- ---------------------------------------------------------------------------
create table public.profile (
  id                     uuid primary key references auth.users (id) on delete cascade,
  rol                    public.rol_usuario not null,
  -- El mercaderista es EXCLUSIVO de un cliente: un solo tenant_id, nunca varios.
  -- El staff de la outsourcing (admin/supervisor) no pertenece a ningún cliente.
  tenant_id              uuid references public.tenant (id) on delete restrict,
  nombre                 text not null,
  dni                    text,
  telefono               text,
  telefono_verificado_at timestamptz,
  sctr_vigente_hasta     date,
  -- Borrar a un supervisor no puede borrar a su equipo.
  supervisor_id          uuid references public.profile (id) on delete set null,
  activo                 boolean not null default true,
  desactivado_at         timestamptz,
  creado_at              timestamptz not null default now(),

  -- La invariante de la que cuelgan TODAS las políticas. Si vive solo en la app,
  -- se rompe: aquí es imposible un admin con tenant o un mercaderista sin él.
  constraint profile_tenant_segun_rol check (
    (rol in ('admin', 'supervisor') and tenant_id is null)
    or (rol in ('mercaderista', 'cliente') and tenant_id is not null)
  )
);

create index profile_tenant_id_idx on public.profile (tenant_id);
create index profile_supervisor_id_idx on public.profile (supervisor_id);

-- `desactivado_at` es derivado de `activo`: un solo calculador, en la base.
create function public.marcar_desactivacion()
returns trigger
language plpgsql
as $$
begin
  if new.activo is distinct from old.activo then
    new.desactivado_at := case when new.activo then null else now() end;
  end if;
  return new;
end;
$$;

create trigger profile_marcar_desactivacion
  before update on public.profile
  for each row execute function public.marcar_desactivacion();

-- ---------------------------------------------------------------------------
-- La regla de acceso, con UN SOLO DUEÑO.
--
-- El schema `app` no está en `api.schemas` del config.toml, así que PostgREST no
-- lo expone: nadie puede llamar a estas funciones por HTTP.
--
-- SECURITY DEFINER es obligatorio, y no es un atajo: una política SOBRE profile
-- que hace SELECT sobre profile se auto-recursiona (42P17 "infinite recursion
-- detected in policy"). La función corre como `postgres`, que tiene BYPASSRLS, y
-- por eso lee profile sin volver a disparar la política.
--
-- ¿Por qué no meter rol y tenant_id como claims en el JWT (que sería más rápido)?
-- Porque un claim es una COPIA RANCIA. Cuando un cliente cancela el servicio,
-- sus mercaderistas seguirían dentro hasta que el token expire — hasta una hora.
-- Aquí el acceso se recalcula en cada consulta: la revocación es inmediata.
-- ---------------------------------------------------------------------------
create schema if not exists app;

create function app.perfil_efectivo()
returns table (id uuid, rol public.rol_usuario, tenant_id uuid)
language sql
stable
security definer
set search_path = ''
as $$
  select p.id, p.rol, p.tenant_id
  from public.profile p
  left join public.tenant t on t.id = p.tenant_id
  where p.id = (select auth.uid())
    and p.activo                                    -- la persona sigue trabajando aquí
    and (p.tenant_id is null or t.activo);          -- y su cliente sigue siendo cliente
$$;

comment on function app.perfil_efectivo() is
  'ÚNICO dueño de la regla de acceso derivada. Devuelve 0 filas si el usuario está desactivado o su cliente canceló: todo lo demás falla cerrado a partir de ahí.';

-- Accesores. SECURITY INVOKER a propósito: solo llaman a la definer, así que no
-- hace falta más superficie privilegiada.
create function app.rol_actual()
returns public.rol_usuario
language sql stable
as $$ select rol from app.perfil_efectivo() $$;

create function app.tenant_actual()
returns uuid
language sql stable
as $$ select tenant_id from app.perfil_efectivo() $$;

create function app.es_staff()
returns boolean
language sql stable
as $$ select coalesce((select rol from app.perfil_efectivo()) in ('admin', 'supervisor'), false) $$;

comment on function app.es_staff() is
  'Personal de la outsourcing (admin/supervisor): no pertenece a ningún cliente y ve toda la operación.';

-- ---------------------------------------------------------------------------
-- GRANTs. Sin esto, las políticas de abajo NUNCA llegan a evaluarse.
-- A `anon` no se le da nada: falla cerrado con 42501, que es justo lo que queremos.
-- ---------------------------------------------------------------------------
grant usage on schema app to authenticated, service_role;
grant execute on all functions in schema app to authenticated, service_role;

grant select on public.tenant to authenticated;
grant select, insert, update on public.marca to authenticated;
grant select, insert, update on public.profile to authenticated;

-- service_role tiene BYPASSRLS (las políticas no le aplican), pero SÍ necesita el
-- GRANT: sin él, las Edge Functions mueren con "permission denied".
grant all on public.tenant, public.marca, public.profile to service_role;

-- ---------------------------------------------------------------------------
-- RLS — en la MISMA migración que crea las tablas.
-- Una tabla con RLS y sin políticas falla cerrada (molesto pero seguro). Una
-- tabla SIN RLS es legible por el mundo a través de PostgREST. La ventana entre
-- "creé la tabla" y "le puse RLS después" es exactamente por donde se filtran
-- los datos.
-- ---------------------------------------------------------------------------
alter table public.tenant enable row level security;
alter table public.marca enable row level security;
alter table public.profile enable row level security;

-- --- tenant
create policy tenant_staff_lee_todo on public.tenant
  for select to authenticated
  using ((select app.es_staff()));

create policy tenant_usuario_lee_el_suyo on public.tenant
  for select to authenticated
  using (id = (select app.tenant_actual()));

create policy tenant_admin_escribe on public.tenant
  for all to authenticated
  using ((select app.rol_actual()) = 'admin')
  with check ((select app.rol_actual()) = 'admin');

-- --- marca
create policy marca_staff_lee_todo on public.marca
  for select to authenticated
  using ((select app.es_staff()));

-- El cliente y su mercaderista ven las marcas de su propio cliente. Si el cliente
-- canceló, tenant_actual() devuelve NULL, la comparación da NULL (no true), y no
-- ven nada. Falla cerrado por construcción.
create policy marca_usuario_lee_su_tenant on public.marca
  for select to authenticated
  using (tenant_id = (select app.tenant_actual()));

create policy marca_admin_escribe on public.marca
  for all to authenticated
  using ((select app.rol_actual()) = 'admin')
  with check ((select app.rol_actual()) = 'admin');

-- --- profile
-- EXCEPCIÓN DELIBERADA a la regla derivada: el usuario ve SIEMPRE su propia fila,
-- incluso desactivado o con su cliente cancelado. No ve ni un dato de negocio,
-- pero sí su `activo = false`, y así la app puede decirle "tu cuenta está
-- desactivada, habla con tu supervisor" en vez de dejarlo mirando una pantalla
-- vacía que acaba en una llamada a soporte.
create policy profile_lee_el_suyo on public.profile
  for select to authenticated
  using (id = (select auth.uid()));

create policy profile_staff_lee_todo on public.profile
  for select to authenticated
  using ((select app.es_staff()));

-- El cliente ve a la gente asignada a su cuenta, pero NO a los desvinculados:
-- quién dejó de trabajar en la outsourcing es información laboral de la
-- outsourcing, no del cliente.
create policy profile_cliente_lee_los_activos_de_su_tenant on public.profile
  for select to authenticated
  using (
    tenant_id = (select app.tenant_actual())
    and activo
  );

create policy profile_admin_escribe on public.profile
  for all to authenticated
  using ((select app.rol_actual()) = 'admin')
  with check ((select app.rol_actual()) = 'admin');
