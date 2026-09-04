-- MAR-98: el formulario configurable llega al paso de CHECK-IN.
--
-- Cuatro piezas:
--   1. `formulario_levantamiento.ambito`: separa el formulario del levantamiento
--      (por marca) del formulario del CHECK-IN (de la visita). Mismo constructor,
--      mismas versiones inmutables, misma definición jsonb.
--   2. `visita.formulario_version_id`: ANCLA la visita a la versión que se le
--      mostró, igual que `levantamiento.formulario_version_id`. Es también lo que
--      dice QUÉ ítems se le pidieron cuando no contestó ninguno: la ausencia de
--      una foto es un dato derivable, no un hueco.
--   3. `visita_respuesta`: una fila por campo contestado en el check-in. Espeja
--      `levantamiento_respuesta` cambiando la clave: aquí cuelga de la VISITA.
--   4. La foto de herramientas del check-in (tipo `campo_extra` con
--      `levantamiento_id` null) deja de ser legible por el cliente-marca: es un
--      dato laboral de la outsourcing (SUNAFIL, herramientas propias), no
--      evidencia de tienda — el mismo criterio que excluyó la selfie.
--
-- ⚠️ ORDEN DE DESPLIEGUE: un build del móvil anterior a este ticket resuelve el
-- formulario del levantamiento solo por `activo`, así que un formulario de
-- check-in (marca_id null) le entraría como candidato "de todas las marcas".
-- Orden: esta migración → build del móvil que filtra por `ambito` → la opción de
-- check-in visible en el panel. El default 'levantamiento' hace que, mientras
-- tanto, nada existente cambie de comportamiento.

create type public.ambito_formulario as enum ('levantamiento', 'check_in');

alter table public.formulario_levantamiento
  add column ambito public.ambito_formulario not null default 'levantamiento';

-- El check-in es de la VISITA, no de una marca: un formulario de check-in no
-- puede colgar de una.
alter table public.formulario_levantamiento
  add constraint formulario_check_in_sin_marca
  check (ambito = 'levantamiento' or marca_id is null);

comment on column public.formulario_levantamiento.ambito is
  'Dónde se usa la definición: el wizard del levantamiento (por marca) o el check-in (de la visita).';

alter table public.visita
  add column formulario_version_id uuid
    references public.formulario_version (id) on delete restrict;

comment on column public.visita.formulario_version_id is
  'La versión del formulario de check-in que se le mostró al mercaderista al fichar. Publicar otra no cambia lo que respondió: una versión publicada es inmutable.';

-- Las respuestas del checklist de check-in. `campo_id` es el id estable del
-- campo dentro de la definición jsonb; se interpreta con
-- `visita.formulario_version_id`. `valor` es jsonb: la forma la sostiene Zod en
-- la frontera, no el tipo de la columna.
create table public.visita_respuesta (
  id         uuid primary key default gen_random_uuid(),
  tenant_id  uuid not null references public.tenant (id) on delete restrict,
  visita_id  uuid not null,
  campo_id   text not null,
  valor      jsonb not null,
  creado_at  timestamptz not null default now(),
  unique (visita_id, campo_id),
  constraint vis_resp_visita_fk foreign key (visita_id, tenant_id)
    references public.visita (id, tenant_id) on delete cascade,
  -- Mismo techo y misma razón que `levantamiento_respuesta_valor_tamano`: el
  -- mercaderista es el actor de menor confianza y la app no es la única puerta
  -- a PostgREST.
  constraint visita_respuesta_valor_tamano check (pg_column_size(valor) <= 16384)
);

-- No hace falta un índice sobre (visita_id) solo: el UNIQUE (visita_id,
-- campo_id) ya lo cubre por su columna líder, que es como consultan la app y la
-- sync. Falta solo el del tenant.
create index vis_resp_tenant_id_idx on public.visita_respuesta (tenant_id);

alter table public.visita_respuesta enable row level security;

-- El GRANT es la puerta; la RLS es el portero. Sin `delete`: una respuesta no se
-- borra desde el cliente (el cascade la limpia si cae la visita).
grant select, insert, update on public.visita_respuesta to authenticated;
grant all on public.visita_respuesta to service_role;

create policy visresp_staff_lee on public.visita_respuesta for select to authenticated
  using ((select app.es_staff()));
-- El cliente-marca queda FUERA: las respuestas del checklist ("llevas botas")
-- son el mismo dato laboral que su foto, y la foto ya se le oculta. Excluir una
-- y dejar la otra sería contarle lo mismo por otro canal.
create policy visresp_usuario_lee_su_tenant on public.visita_respuesta for select to authenticated
  using (
    tenant_id = (select app.tenant_actual())
    and (select app.rol_actual()) <> 'cliente'
  );

-- El `tenant_id = app.tenant_actual()` va además del dueño de la visita: al
-- desvincular a un mercaderista, tenant_actual() es null y la escritura falla
-- cerrada sin tocar el JWT.
create policy visresp_mercaderista_inserta on public.visita_respuesta for insert to authenticated
  with check (
    tenant_id = (select app.tenant_actual())
    and exists (select 1 from public.visita v
                where v.id = visita_id and v.mercaderista_id = (select auth.uid()))
  );
create policy visresp_mercaderista_actualiza on public.visita_respuesta for update to authenticated
  using (
    tenant_id = (select app.tenant_actual())
    and exists (select 1 from public.visita v
                where v.id = visita_id and v.mercaderista_id = (select auth.uid()))
  )
  with check (
    tenant_id = (select app.tenant_actual())
    and exists (select 1 from public.visita v
                where v.id = visita_id and v.mercaderista_id = (select auth.uid()))
  );

-- Misma invariante que `app.respuesta_identidad_inmutable()` y por la misma
-- razón (un grant por columna rompería el upsert de reintento de PowerSync).
-- Función aparte y no reutilizada: aquella lee `new.levantamiento_id`, que en
-- esta tabla no existe — el trigger reventaría en ejecución.
create function app.visita_respuesta_identidad_inmutable()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.id is distinct from old.id then
    raise exception 'id no se puede cambiar: es la identidad de la respuesta';
  end if;
  if new.campo_id is distinct from old.campo_id then
    raise exception 'campo_id no se puede cambiar: una respuesta pertenece al campo que la originó';
  end if;
  if new.visita_id is distinct from old.visita_id then
    raise exception 'visita_id no se puede cambiar: una respuesta no se mueve de visita';
  end if;
  if new.tenant_id is distinct from old.tenant_id then
    raise exception 'tenant_id no se puede cambiar';
  end if;
  if new.creado_at is distinct from old.creado_at then
    raise exception 'creado_at no se puede cambiar: es la hora de captura';
  end if;
  return new;
end;
$$;

revoke execute on function app.visita_respuesta_identidad_inmutable() from public;

comment on function app.visita_respuesta_identidad_inmutable() is
  'El mercaderista corrige el VALOR de una respuesta de check-in; su identidad (qué campo, qué visita, cuándo) no se mueve. Trigger y no grant por columna: el upsert de reintento de PowerSync reescribe la fila entera.';

create trigger visita_respuesta_identidad_inmutable
before update on public.visita_respuesta
for each row execute function app.visita_respuesta_identidad_inmutable();

-- La foto del checklist de herramientas (campo_extra sin levantamiento) es la
-- evidencia de las botas/el casco del mercaderista: un dato laboral de la
-- outsourcing, no evidencia de tienda. El cliente-marca es una parte externa y
-- no tiene por qué verla — el mismo razonamiento que excluyó la selfie, y en el
-- mismo sitio: la POLÍTICA, no la consulta que agrupa (la galería es invoker y
-- hereda este filtro solo).
drop policy foto_usuario_lee_su_tenant on public.foto;
create policy foto_usuario_lee_su_tenant on public.foto for select to authenticated
  using (
    tenant_id = (select app.tenant_actual())
    and (
      (select app.rol_actual()) <> 'cliente'
      or (
        tipo <> 'selfie'
        and not (tipo = 'campo_extra' and levantamiento_id is null)
      )
    )
  );

comment on policy foto_usuario_lee_su_tenant on public.foto is
  'El cliente-marca no lee la selfie de check-in ni la foto de herramientas del checklist (campo_extra sin levantamiento): son datos del personal de la outsourcing y el cliente es una parte externa. El staff y el propio mercaderista sí las ven.';
