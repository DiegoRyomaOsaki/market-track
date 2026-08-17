-- El mercaderista lee SOLO el trabajo de campo de SUS visitas: el
-- levantamiento, sus skus, las respuestas del formulario, las exhibiciones
-- auditadas y las contingencias (bypass).
--
-- Cierra el hueco que la migración de la lectura acotada (20260816120000) dejó
-- fuera a propósito: las políticas `*_usuario_lee_su_tenant` de estas cinco
-- tablas daban SELECT sobre TODO el cliente a cualquier usuario del cliente, y
-- por PostgREST (`levantamiento_respuesta?tenant_id=eq…`) el mercaderista se
-- llevaba lo que cada compañero contesta en el formulario configurable, sus
-- precios registrados y —lo más sensible— el motivo de cada bypass.
--
-- Se acota AHORA porque los streams de sync de estas cinco tablas se acotan en
-- el mismo cambio: la bajada al teléfono ya no replica el tenant entero, así
-- que acotar la RLS es un cierre real y no cosmético.
--
-- Mismo patrón CASE por rol que `visita_respuesta`. El cliente-marca conserva
-- su lectura (el levantamiento es evidencia de tienda, no un dato laboral como
-- el checklist de check-in) y el staff, todo. Sin rama ELSE a propósito: un rol
-- nuevo cae en NULL, y NULL en una política es denegar.
--
-- Las políticas de escritura no cambian: ya exigían la visita propia. Y la fila
-- propia sigue siendo legible, que es lo que un upsert (`on conflict`) del
-- conector de PowerSync necesita para resolver el conflicto contra lo existente.

-- ---------------------------------------------------------------------------
-- Las tablas que cuelgan de la visita: levantamiento y contingencia
-- ---------------------------------------------------------------------------
drop policy lev_usuario_lee_su_tenant on public.levantamiento;
create policy lev_usuario_lee_su_tenant on public.levantamiento for select to authenticated
  using (
    tenant_id = (select app.tenant_actual())
    and case (select app.rol_actual())
      when 'mercaderista' then visita_id in (
        select v.id from public.visita v
        where v.mercaderista_id = (select auth.uid())
      )
      when 'cliente' then true
      when 'supervisor' then true
      when 'admin' then true
    end
  );

comment on policy lev_usuario_lee_su_tenant on public.levantamiento is
  'El mercaderista lee SOLO los levantamientos de sus propias visitas; el cliente-marca y el staff, todos los de su alcance. Un rol nuevo no lee nada hasta que se le añada su rama.';

drop policy cont_usuario_lee_su_tenant on public.contingencia;
create policy cont_usuario_lee_su_tenant on public.contingencia for select to authenticated
  using (
    tenant_id = (select app.tenant_actual())
    and case (select app.rol_actual())
      when 'mercaderista' then visita_id in (
        select v.id from public.visita v
        where v.mercaderista_id = (select auth.uid())
      )
      when 'cliente' then true
      when 'supervisor' then true
      when 'admin' then true
    end
  );

comment on policy cont_usuario_lee_su_tenant on public.contingencia is
  'El mercaderista lee SOLO las contingencias (bypass) de sus propias visitas; el cliente-marca y el staff, todas las de su alcance. Un rol nuevo no lee nada hasta que se le añada su rama.';

-- ---------------------------------------------------------------------------
-- Las tablas que cuelgan del levantamiento: skus, respuestas y exhibiciones
-- ---------------------------------------------------------------------------
drop policy levsku_usuario_lee_su_tenant on public.levantamiento_sku;
create policy levsku_usuario_lee_su_tenant on public.levantamiento_sku for select to authenticated
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

comment on policy levsku_usuario_lee_su_tenant on public.levantamiento_sku is
  'El mercaderista lee SOLO los skus de sus propios levantamientos; el cliente-marca y el staff, todos los de su alcance. Un rol nuevo no lee nada hasta que se le añada su rama.';

drop policy levresp_usuario_lee_su_tenant on public.levantamiento_respuesta;
create policy levresp_usuario_lee_su_tenant on public.levantamiento_respuesta for select to authenticated
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

comment on policy levresp_usuario_lee_su_tenant on public.levantamiento_respuesta is
  'El mercaderista lee SOLO las respuestas de sus propios levantamientos; el cliente-marca y el staff, todas las de su alcance. Un rol nuevo no lee nada hasta que se le añada su rama.';

drop policy exh_usuario_lee_su_tenant on public.exhibicion;
create policy exh_usuario_lee_su_tenant on public.exhibicion for select to authenticated
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

comment on policy exh_usuario_lee_su_tenant on public.exhibicion is
  'El mercaderista lee SOLO las exhibiciones auditadas en sus propios levantamientos; el cliente-marca y el staff, todas las de su alcance. Un rol nuevo no lee nada hasta que se le añada su rama.';
