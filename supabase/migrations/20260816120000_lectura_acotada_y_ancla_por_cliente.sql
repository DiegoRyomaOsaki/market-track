-- Dos cierres de la misma familia: referencias y lecturas que respetaban el
-- tenant pero no al DUEÑO de la visita.
--
--   1. El mercaderista deja de leer la evidencia y el trabajo de sus compañeros
--      por PostgREST (`foto`, `visita`, `visita_respuesta`): lee SOLO lo de sus
--      propias visitas. La bajada al teléfono ya estaba acotada por la sync
--      (esas tres tablas filtran por las visitas propias); esto cierra la otra
--      superficie. El staff y el cliente-marca no cambian.
--   2. `formulario_version_id` gana su FK compuesta por tenant en `visita` y
--      `levantamiento`: el ancla de formulario no puede cruzar clientes.
--
-- `levantamiento_respuesta` queda FUERA a propósito: su stream de sync baja el
-- tenant entero, así que acotar solo su RLS parecería un cierre sin serlo. Se
-- acota junto con su stream (y los de levantamiento/exhibicion/contingencia),
-- re-probando la hidratación offline.

-- ---------------------------------------------------------------------------
-- 1a. La evidencia del mercaderista se acota a SUS visitas
--
-- `foto_usuario_lee_su_tenant` daba SELECT sobre TODAS las fotos del cliente a
-- CUALQUIER usuario del cliente. El resto del modelo acota al mercaderista a su
-- propio rutero; `foto` era la excepción, y por PostgREST (`foto?tenant_id=eq…`)
-- se llevaba la evidencia de sus compañeros: la selfie de cada uno y su foto de
-- herramientas — los dos datos personales que esta misma política ya le esconde
-- al cliente-marca. Y con el id en la mano, `fotos-url-firmada` devuelve la
-- imagen: esa función firma lo que la RLS deje leer, no lo que la pantalla
-- enseñaba.
--
-- Sin rama ELSE a propósito: un rol nuevo en el enum cae en NULL, y NULL en una
-- política es denegar. Falla cerrado hasta que alguien decida qué ve.
-- ---------------------------------------------------------------------------
drop policy foto_usuario_lee_su_tenant on public.foto;
create policy foto_usuario_lee_su_tenant on public.foto for select to authenticated
  using (
    tenant_id = (select app.tenant_actual())
    and case (select app.rol_actual())
      when 'mercaderista' then visita_id in (
        select v.id from public.visita v
        where v.mercaderista_id = (select auth.uid())
      )
      -- El cliente-marca es una parte externa: no lee la selfie de check-in ni
      -- la foto de herramientas del checklist (campo_extra sin levantamiento).
      when 'cliente' then
        tipo <> 'selfie'
        and not (tipo = 'campo_extra' and levantamiento_id is null)
      when 'supervisor' then true
      when 'admin' then true
    end
  );

comment on policy foto_usuario_lee_su_tenant on public.foto is
  'Qué evidencia lee cada rol dentro de su cliente: el mercaderista SOLO la de sus propias visitas; el cliente-marca todo menos la selfie y la foto de herramientas (datos del personal de la outsourcing); el staff, todo. Un rol nuevo no lee nada hasta que se le añada su rama.';

-- ---------------------------------------------------------------------------
-- 1b. La visita: el mercaderista lee las suyas; el cliente-marca, todas
--
-- Su rama es una comparación de columna, sin subconsulta: el portal del cliente
-- y el panel del staff no pagan nada por este cambio (el CASE corta antes).
-- ---------------------------------------------------------------------------
drop policy visita_usuario_lee_su_tenant on public.visita;
create policy visita_usuario_lee_su_tenant on public.visita for select to authenticated
  using (
    tenant_id = (select app.tenant_actual())
    and case (select app.rol_actual())
      when 'mercaderista' then mercaderista_id = (select auth.uid())
      -- El dashboard y el mapa del cliente agregan su operación COMPLETA.
      when 'cliente' then true
      when 'supervisor' then true
      when 'admin' then true
    end
  );

comment on policy visita_usuario_lee_su_tenant on public.visita is
  'El mercaderista lee SOLO sus propias visitas; el cliente-marca y el staff, todas las de su alcance. Un rol nuevo no lee nada hasta que se le añada su rama.';

-- ---------------------------------------------------------------------------
-- 1c. El checklist de check-in: cada mercaderista, el de sus visitas
--
-- El cliente-marca ya estaba excluido (dato laboral, misma regla que la foto de
-- herramientas); su rama conserva ese cierre en la forma nueva.
-- ---------------------------------------------------------------------------
drop policy visresp_usuario_lee_su_tenant on public.visita_respuesta;
create policy visresp_usuario_lee_su_tenant on public.visita_respuesta for select to authenticated
  using (
    tenant_id = (select app.tenant_actual())
    and case (select app.rol_actual())
      when 'mercaderista' then visita_id in (
        select v.id from public.visita v
        where v.mercaderista_id = (select auth.uid())
      )
      when 'cliente' then false
      when 'supervisor' then true
      when 'admin' then true
    end
  );

comment on policy visresp_usuario_lee_su_tenant on public.visita_respuesta is
  'El mercaderista lee SOLO las respuestas de sus propias visitas; el staff, todas; el cliente-marca, ninguna ("llevas botas" es el mismo dato laboral que su foto). Un rol nuevo no lee nada hasta que se le añada su rama.';

-- ---------------------------------------------------------------------------
-- 2. La versión de formulario anclada tiene que ser del MISMO cliente
--
-- Las FK simples solo miran el id. Un cliente hostil podía apuntar su visita o
-- su levantamiento a la versión de OTRO cliente por PostgREST: el motor de
-- puntaje expande esa definición dentro de un SECURITY DEFINER (que salta RLS),
-- así que el denominador de "calidad de registro" y "herramientas" saldría de
-- un formulario ajeno — y de esas variables sale un bono en efectivo.
--
-- MATCH SIMPLE (el defecto) es OBLIGATORIO aquí: `formulario_version_id` es
-- nullable y `tenant_id` no. Con MATCH FULL, toda visita sin checklist —el caso
-- normal— sería rechazada y el check-in dejaría de sincronizar.
-- ---------------------------------------------------------------------------
alter table public.formulario_version
  add constraint formulario_version_id_tenant_uq unique (id, tenant_id);

alter table public.visita
  drop constraint visita_formulario_version_id_fkey,
  add constraint visita_formver_fk
    foreign key (formulario_version_id, tenant_id)
    references public.formulario_version (id, tenant_id) on delete restrict;

alter table public.levantamiento
  drop constraint levantamiento_formulario_version_id_fkey,
  add constraint lev_formver_fk
    foreign key (formulario_version_id, tenant_id)
    references public.formulario_version (id, tenant_id) on delete restrict;

-- ---------------------------------------------------------------------------
-- 3. La referencia a una foto dentro de `valor` no tiene verja de autenticidad
--
-- Deliberadamente NO se valida con un trigger: un rechazo del servidor hace que
-- el conector de PowerSync descarte la operación y se pierdan las respuestas
-- del paso entero. La regla vive donde se CONSUME, y se deja escrita en la
-- columna porque es ahí donde la leerá quien escriba el próximo consumidor.
-- ---------------------------------------------------------------------------
comment on column public.levantamiento_respuesta.valor is
  'La respuesta del campo, jsonb; su forma la sostiene Zod en la frontera. En un campo de tipo foto guarda el uuid de una fila `foto`, SIN clave foránea ni trigger: un cliente hostil puede apuntarlo a cualquier foto que pueda leer. Quien lo consuma resuelve el uuid con un join que exija `foto.levantamiento_id = levantamiento_respuesta.levantamiento_id` y el mismo tenant, y trata el desajuste como "sin foto". El motor de puntaje no lo lee: cuenta filas `foto`.';

comment on column public.visita_respuesta.valor is
  'La respuesta del campo del checklist de check-in, jsonb. En un campo de tipo foto guarda el uuid de una fila `foto`, SIN clave foránea ni trigger — mismo criterio y misma cautela que `levantamiento_respuesta.valor`: el consumidor resuelve el uuid exigiendo `foto.visita_id = visita_respuesta.visita_id` y el mismo tenant, y trata el desajuste como "sin foto".';
