-- MAR-72: solicitud de cambio de ruta (mercaderista → supervisor).
--
-- El mercaderista pide un cambio en su rutero con un motivo; el staff lo ve en el
-- panel y lo resuelve. Sigue el patrón de `contingencia`: el mercaderista ESCRIBE
-- lo suyo (sube por PostgREST y pasa por RLS); el staff lee y resuelve. La bajada
-- al móvil la acotan las sync rules (solo las propias) — ver packages/sync.

create type public.tipo_solicitud_ruta as enum
  ('cambio_tienda', 'cambio_dia', 'no_visita', 'otro');
create type public.estado_solicitud_ruta as enum
  ('nueva', 'vista', 'resuelta', 'rechazada');

create table public.solicitud_cambio_ruta (
  id                    uuid primary key default gen_random_uuid(),
  tenant_id             uuid not null references public.tenant (id) on delete restrict,
  mercaderista_id       uuid not null references public.profile (id) on delete restrict,
  -- El rutero/fecha afectados; opcionales (una "no_visita" puede no referir uno).
  rutero_id             uuid references public.rutero (id) on delete set null,
  fecha                 date,
  tipo                  public.tipo_solicitud_ruta not null,
  motivo                text not null,
  estado                public.estado_solicitud_ruta not null default 'nueva',
  comentario_resolucion text,
  resuelta_por          uuid references public.profile (id) on delete set null,
  resuelta_at           timestamptz,
  creada_at             timestamptz not null default now(),
  -- El motivo es obligatorio a nivel de esquema, no solo en la UI.
  constraint solicitud_motivo_no_vacio check (length(btrim(motivo)) > 0)
);

create index solicitud_cambio_ruta_tenant_idx
  on public.solicitud_cambio_ruta (tenant_id);
create index solicitud_cambio_ruta_mercaderista_idx
  on public.solicitud_cambio_ruta (mercaderista_id);
create index solicitud_cambio_ruta_estado_idx
  on public.solicitud_cambio_ruta (tenant_id, estado);

alter table public.solicitud_cambio_ruta enable row level security;

-- El staff (admin/supervisor) las lee todas; el mercaderista, solo las suyas.
create policy sol_staff_lee on public.solicitud_cambio_ruta for select to authenticated
  using ((select app.es_staff()));
create policy sol_mercaderista_lee_las_suyas on public.solicitud_cambio_ruta for select to authenticated
  using (mercaderista_id = (select auth.uid()));

-- El mercaderista crea las suyas, dentro de su propio tenant (no puede escribir a
-- nombre de otro ni cruzar de cliente).
create policy sol_mercaderista_inserta_las_suyas on public.solicitud_cambio_ruta for insert to authenticated
  with check (
    mercaderista_id = (select auth.uid())
    and tenant_id = (select app.tenant_actual())
  );

-- El staff la resuelve (cambia estado, comentario, resuelta_por/at). El
-- mercaderista no toca los campos de resolución: no tiene política de UPDATE.
create policy sol_staff_resuelve on public.solicitud_cambio_ruta for update to authenticated
  using ((select app.es_staff()))
  with check ((select app.es_staff()));

-- El GRANT es la puerta; la RLS es el portero. Sin esto, 42501 antes de la RLS.
grant select, insert, update on public.solicitud_cambio_ruta to authenticated;
