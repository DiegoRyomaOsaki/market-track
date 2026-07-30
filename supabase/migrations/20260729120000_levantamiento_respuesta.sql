-- MAR-80: render dinámico del wizard desde la definición (ADR-0010).
--
-- Tres piezas para que el wizard renderice los pasos configurables (campos
-- libres) conservando las invariantes del núcleo:
--
--   1. `levantamiento.formulario_version_id`: ANCLA cada levantamiento a la
--      versión que usó. Como una versión publicada es inmutable (trigger de
--      MAR-73), publicar un formulario nuevo NO cambia una visita en curso.
--   2. `levantamiento_respuesta`: las respuestas de los campos libres (una por
--      campo). Los campos con lógica de negocio (quiebre/diferencia, SOS,
--      precios) siguen en levantamiento/levantamiento_sku, DERIVADOS por la base.
--   3. `paso_levantamiento.campos_extra` + `contingencia.paso_config_id`: el
--      bypass de un paso configurable. Todos los pasos configurables comparten
--      el enum `campos_extra`; `paso_config_id` dice CUÁL de ellos se omitió.

-- El nuevo valor de enum va primero y no se USA en esta misma migración (ni la
-- tabla ni las columnas de abajo lo referencian): así no choca con la regla de
-- "no usar un valor de enum recién creado en la misma transacción".
alter type public.paso_levantamiento add value 'campos_extra';

alter table public.levantamiento
  add column formulario_version_id uuid
    references public.formulario_version (id) on delete restrict;

-- El bypass de un paso configurable: el enum no basta (todos son 'campos_extra'),
-- `paso_config_id` lleva el id estable del paso dentro de la definición. Null en
-- los pasos fijos (su enum ya es único).
alter table public.contingencia add column paso_config_id text;

-- Las respuestas de los campos libres del formulario configurable. `campo_id` es
-- el id estable del campo dentro de la definición jsonb (no hay tabla `campo` que
-- referenciar); se interpreta con `levantamiento.formulario_version_id`. `valor`
-- es jsonb: una respuesta puede ser texto, número, booleano o lista (selección
-- múltiple). Su forma la sostiene Zod en la frontera, no el tipo de la columna.
create table public.levantamiento_respuesta (
  id               uuid primary key default gen_random_uuid(),
  tenant_id        uuid not null references public.tenant (id) on delete restrict,
  levantamiento_id uuid not null,
  campo_id         text not null,
  valor            jsonb not null,
  creado_at        timestamptz not null default now(),
  unique (levantamiento_id, campo_id),
  constraint lev_resp_lev_fk foreign key (levantamiento_id, tenant_id)
    references public.levantamiento (id, tenant_id) on delete cascade
);

create index lev_resp_tenant_id_idx on public.levantamiento_respuesta (tenant_id);
create index lev_resp_lev_id_idx on public.levantamiento_respuesta (levantamiento_id);

alter table public.levantamiento_respuesta enable row level security;

-- El GRANT es la puerta; la RLS es el portero. El mercaderista ESCRIBE lo que
-- levanta (sube por PostgREST y pasa por RLS); sin `delete`: una respuesta no se
-- borra desde el cliente (el cascade la limpia si cae el levantamiento).
grant select, insert, update on public.levantamiento_respuesta to authenticated;
grant all on public.levantamiento_respuesta to service_role;

-- Mismo patrón que levantamiento_sku: el staff lee todo, el usuario lo de su
-- tenant, y el mercaderista escribe solo lo que cuelga de una visita suya.
create policy levresp_staff_lee on public.levantamiento_respuesta for select to authenticated
  using ((select app.es_staff()));
create policy levresp_usuario_lee_su_tenant on public.levantamiento_respuesta for select to authenticated
  using (tenant_id = (select app.tenant_actual()));
create policy levresp_mercaderista_inserta on public.levantamiento_respuesta for insert to authenticated
  with check (exists (
    select 1 from public.levantamiento l join public.visita v on v.id = l.visita_id
    where l.id = levantamiento_id and v.mercaderista_id = (select auth.uid())
  ));
create policy levresp_mercaderista_actualiza on public.levantamiento_respuesta for update to authenticated
  using (exists (
    select 1 from public.levantamiento l join public.visita v on v.id = l.visita_id
    where l.id = levantamiento_id and v.mercaderista_id = (select auth.uid())
  ))
  with check (exists (
    select 1 from public.levantamiento l join public.visita v on v.id = l.visita_id
    where l.id = levantamiento_id and v.mercaderista_id = (select auth.uid())
  ));
