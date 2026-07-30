-- MAR-74: módulos del portal cliente habilitados por cliente (tenant).
--
-- El admin activa/desactiva las secciones del portal (dashboard, mapa, galería,
-- alertas, reportes) por cada cliente. Este es el MODELO + el contrato de
-- enforcement; la UI del toggle es MAR-81 y el shell que lo consume es MAR-54.
--
-- Modelo DISPERSO: solo se guarda una fila cuando el admin DESHABILITA (o cambia)
-- un módulo. Un cliente sin filas tiene todo habilitado (`coalesce(..., true)`).
-- Así el default "todos habilitados al crear un cliente" no necesita un trigger
-- que materialice N filas por tenant (que acoplaría la lista de módulos).

create type public.modulo_portal as enum
  ('dashboard', 'mapa', 'galeria', 'alertas', 'reportes');

create table public.portal_modulo_habilitado (
  id         uuid primary key default gen_random_uuid(),
  tenant_id  uuid not null references public.tenant (id) on delete restrict,
  modulo     public.modulo_portal not null,
  habilitado boolean not null default true,
  creado_at  timestamptz not null default now(),
  -- Una sola fila por (cliente, módulo): la clave del upsert del admin.
  unique (tenant_id, modulo)
);

-- El UNIQUE (tenant_id, modulo) ya indexa por tenant_id (columna líder): cubre
-- tanto el aislamiento como el join del contrato. No hace falta índice extra.

alter table public.portal_modulo_habilitado enable row level security;

-- El GRANT es la puerta; la RLS es el portero. Sin `delete`: un módulo no se
-- borra, se pone `habilitado = false`.
grant select, insert, update on public.portal_modulo_habilitado to authenticated;
grant all on public.portal_modulo_habilitado to service_role;

-- El staff ve todo; el usuario (cliente/mercaderista), lo de su cliente. Solo el
-- admin escribe: es configuración de plataforma, como el maestro comercial.
create policy portmod_staff_lee on public.portal_modulo_habilitado for select to authenticated
  using ((select app.es_staff()));
create policy portmod_usuario_lee_su_tenant on public.portal_modulo_habilitado for select to authenticated
  using (tenant_id = (select app.tenant_actual()));
create policy portmod_admin_escribe on public.portal_modulo_habilitado for all to authenticated
  using ((select app.rol_actual()) = 'admin')
  with check ((select app.rol_actual()) = 'admin');

-- El contrato de enforcement server-side (lo consume el shell del portal, MAR-54):
-- la lista COMPLETA de módulos con su estado para el cliente ACTUAL, resolviendo
-- el default (todo habilitado) con `coalesce`. Vive en `public` para ser
-- llamable por PostgREST (`supabase.rpc('portal_modulos')`) — el esquema `app` no
-- está expuesto. `security definer` + `search_path=''` como `app.perfil_efectivo`:
-- el scope lo pone `app.tenant_actual()` (los claims del que llama), no el owner.
--
-- NO es una verja de auth: es una fuente de config. El acceso al portal lo
-- gobierna el login multi-tenant + aal2 (MAR-54), aparte.
create function public.portal_modulos()
returns table (modulo public.modulo_portal, habilitado boolean)
language sql
stable
security definer
set search_path = ''
as $$
  select m.modulo,
         coalesce(pmh.habilitado, true) as habilitado
  from unnest(enum_range(null::public.modulo_portal)) as m(modulo)
  left join public.portal_modulo_habilitado pmh
    on pmh.tenant_id = (select app.tenant_actual())
   and pmh.modulo = m.modulo;
$$;

comment on function public.portal_modulos() is
  'Fuente de verdad de qué secciones del portal ve el cliente actual: la lista de módulos × coalesce(override, true). Un tenant sin filas => todo habilitado. La consume MAR-54.';

grant execute on function public.portal_modulos() to authenticated, service_role;
