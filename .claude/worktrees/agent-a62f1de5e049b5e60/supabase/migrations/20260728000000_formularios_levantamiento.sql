-- MAR-73: formularios de levantamiento configurables (schema-driven). Ver ADR-0010.
--
-- La definición (`jsonb`) configura PRESENTACIÓN y campos LIBRES por paso; la
-- lógica de negocio (SOS, quiebres, precios) y los campos derivados siguen en la
-- base. Publicar una versión la vuelve INMUTABLE; editar crea una versión nueva.
-- El móvil replica solo la versión publicada de su cliente (ver packages/sync).

create table public.formulario_levantamiento (
  id         uuid primary key default gen_random_uuid(),
  tenant_id  uuid not null references public.tenant (id) on delete restrict,
  -- null = aplica a todas las marcas del cliente; poblado = una marca concreta.
  marca_id   uuid references public.marca (id) on delete restrict,
  nombre     text not null,
  activo     boolean not null default true,
  creado_at  timestamptz not null default now()
);

create index formulario_levantamiento_tenant_idx
  on public.formulario_levantamiento (tenant_id);

create table public.formulario_version (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references public.tenant (id) on delete restrict,
  formulario_id uuid not null
                references public.formulario_levantamiento (id) on delete cascade,
  version       integer not null,
  definicion    jsonb not null,
  publicada     boolean not null default false,
  publicada_at  timestamptz,
  publicada_por uuid references public.profile (id) on delete set null,
  creada_at     timestamptz not null default now(),
  unique (formulario_id, version)
);

create index formulario_version_tenant_idx
  on public.formulario_version (tenant_id);
create index formulario_version_publicada_idx
  on public.formulario_version (tenant_id, publicada);

-- Una versión PUBLICADA es inmutable: publicar congela. Editar es crear una
-- versión nueva. Sin esto, tocar una versión ya publicada le cambiaría el
-- formulario bajo los pies a las visitas que la usaron.
create function app.formulario_version_inmutable()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.publicada then
    raise exception
      'Una versión de formulario publicada es inmutable (formulario_version %)',
      old.id;
  end if;
  return new;
end;
$$;

create trigger formulario_version_no_editar_publicada
  before update on public.formulario_version
  for each row execute function app.formulario_version_inmutable();

alter table public.formulario_levantamiento enable row level security;
alter table public.formulario_version enable row level security;

-- El staff ve todo; el usuario (mercaderista/cliente), lo de su cliente. Solo el
-- admin escribe: es configuración, como el maestro comercial.
create policy formdef_staff_lee on public.formulario_levantamiento for select to authenticated
  using ((select app.es_staff()));
create policy formdef_usuario_lee_su_tenant on public.formulario_levantamiento for select to authenticated
  using (tenant_id = (select app.tenant_actual()));
create policy formdef_admin_escribe on public.formulario_levantamiento for all to authenticated
  using ((select app.rol_actual()) = 'admin')
  with check ((select app.rol_actual()) = 'admin');

create policy formver_staff_lee on public.formulario_version for select to authenticated
  using ((select app.es_staff()));
create policy formver_usuario_lee_su_tenant on public.formulario_version for select to authenticated
  using (tenant_id = (select app.tenant_actual()));
create policy formver_admin_escribe on public.formulario_version for all to authenticated
  using ((select app.rol_actual()) = 'admin')
  with check ((select app.rol_actual()) = 'admin');

-- El GRANT es la puerta; la RLS es el portero. Sin delete: una versión no se
-- borra (se despublica el formulario con `activo`).
grant select, insert, update on public.formulario_levantamiento to authenticated;
grant select, insert, update on public.formulario_version to authenticated;
