-- El módulo que el mercaderista dio por TERMINADO.
--
-- Nace de la navegación libre acordada en la 4ª revisión con el cliente (25 ago
-- 2026): "módulo primero, marca después", para que el mercaderista no se quede
-- trabado. Si no lo dejan entrar a la trastienda, sigue por otro lado y vuelve
-- después.
--
-- Hasta ahora el avance del wizard vivía en un `Set` en memoria de la pantalla,
-- porque la secuencia era fija y no había a dónde saltar: el paso activo era
-- siempre el primero pendiente. En cuanto se puede saltar, ese `Set` muere en
-- cada salto — y también cuando Android mata la app en un sótano sin señal.
--
-- No es un campo derivado, y por eso se persiste. "Terminé este módulo" es una
-- AFIRMACIÓN del mercaderista sobre su trabajo, exactamente igual que
-- `contingencia` es su afirmación de que no pudo. Que el "no pude" fuese una
-- fila y el "ya está" no lo fuese era la asimetría que rompía el avance.
--
-- Derivarlo de los datos capturados no cierra: `guardarExhibiciones` con cero
-- negociadas y cero adicionales no escribe ninguna fila, y un paso configurable
-- con todos sus campos opcionales sin contestar tampoco. En los dos casos
-- "terminado" y "ni lo abrió" son indistinguibles, y elegir mal significa o
-- saltarse trabajo real o no dejar cerrar la visita nunca.

create table public.levantamiento_paso (
  id               uuid primary key default gen_random_uuid(),
  tenant_id        uuid not null references public.tenant (id) on delete restrict,
  levantamiento_id uuid not null,
  -- El mismo par que identifica el bypass en `contingencia`: el enum del paso y,
  -- para los configurables —que comparten todos `campos_extra`—, cuál de ellos.
  paso             public.paso_levantamiento not null,
  paso_config_id   text,
  -- Hora LOCAL de cuando el mercaderista cerró el módulo, como
  -- `contingencia.registrada_at`: se trabaja offline y sincroniza después.
  completado_at    timestamptz not null,
  creado_at        timestamptz not null default now(),

  constraint lev_paso_lev_fk foreign key (levantamiento_id, tenant_id)
    references public.levantamiento (id, tenant_id) on delete cascade,
  constraint lev_paso_config_id_tamano check (
    paso_config_id is null or length(paso_config_id) <= 64)
);

-- DOS índices únicos parciales, no un `unique (levantamiento_id, paso,
-- paso_config_id)`. `paso_config_id` es nullable y en SQL un NULL nunca choca
-- con otro NULL: el unique de tres columnas dejaría entrar dos filas del MISMO
-- paso fijo, que es justo el duplicado que hay que impedir. El de los
-- configurables no necesita `paso` en la clave: su id ya es único dentro de la
-- definición (`construirPasos` descarta la definición entera si se repite).
create unique index lev_paso_fijo_uq
  on public.levantamiento_paso (levantamiento_id, paso)
  where paso_config_id is null;
create unique index lev_paso_config_uq
  on public.levantamiento_paso (levantamiento_id, paso_config_id)
  where paso_config_id is not null;

create index lev_paso_tenant_id_idx on public.levantamiento_paso (tenant_id);

comment on table public.levantamiento_paso is
  'El módulo del levantamiento que el mercaderista dio por terminado. Es su afirmación, no un derivado: simétrica a `contingencia`, que registra los que no pudo terminar.';

alter table public.levantamiento_paso enable row level security;

-- El GRANT es la puerta; la RLS es el portero. El mercaderista lo ESCRIBE desde
-- el teléfono (sube por PostgREST y sí pasa por RLS). Con `update` porque el
-- conector de PowerSync reenvía la operación como upsert cuando la primera no
-- confirmó; sin él, cada reintento moriría con un 42501 que el conector
-- clasifica como permanente y DESCARTA. Sin `delete`: un módulo terminado no se
-- desmarca desde el cliente, y el cascade lo limpia si cae el levantamiento.
grant select, insert, update on public.levantamiento_paso to authenticated;
grant all on public.levantamiento_paso to service_role;

create policy levpaso_staff_lee on public.levantamiento_paso for select to authenticated
  using ((select app.es_staff()));

-- Mismo CASE por rol que el resto del trabajo de campo acotado al dueño: el
-- mercaderista lee SOLO lo de sus propias visitas, no lo del cliente entero. Sin
-- rama ELSE a propósito: un rol nuevo cae en NULL, y NULL en una política es
-- denegar.
create policy levpaso_usuario_lee_su_tenant on public.levantamiento_paso for select to authenticated
  using (
    tenant_id = (select app.tenant_actual())
    and case (select app.rol_actual())
      when 'mercaderista' then levantamiento_id in (
        select l.id from public.levantamiento l
        join public.visita v on v.id = l.visita_id
        where v.mercaderista_id = (select auth.uid())
      )
      when 'cliente' then true
      when 'supervisor' then true
      when 'admin' then true
    end
  );

comment on policy levpaso_usuario_lee_su_tenant on public.levantamiento_paso is
  'El mercaderista lee SOLO los módulos terminados de sus propias visitas; el cliente-marca y el staff, todos los de su alcance. Un rol nuevo no lee nada hasta que se le añada su rama.';

create policy levpaso_mercaderista_inserta on public.levantamiento_paso for insert to authenticated
  with check (exists (
    select 1 from public.levantamiento l join public.visita v on v.id = l.visita_id
    where l.id = levantamiento_id and v.mercaderista_id = (select auth.uid())
  ));

create policy levpaso_mercaderista_actualiza on public.levantamiento_paso for update to authenticated
  using (exists (
    select 1 from public.levantamiento l join public.visita v on v.id = l.visita_id
    where l.id = levantamiento_id and v.mercaderista_id = (select auth.uid())
  ))
  with check (exists (
    select 1 from public.levantamiento l join public.visita v on v.id = l.visita_id
    where l.id = levantamiento_id and v.mercaderista_id = (select auth.uid())
  ));
