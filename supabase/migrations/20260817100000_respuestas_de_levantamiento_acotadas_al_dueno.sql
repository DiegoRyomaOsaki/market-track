-- El mercaderista lee SOLO las respuestas del formulario de SUS levantamientos.
--
-- Cierra el hueco que la migración de la lectura acotada (20260816120000) dejó
-- fuera a propósito: `levresp_usuario_lee_su_tenant` daba SELECT sobre las
-- respuestas de TODO el cliente a cualquier usuario del cliente, y por
-- PostgREST (`levantamiento_respuesta?tenant_id=eq…`) el mercaderista se
-- llevaba lo que cada compañero contesta en el formulario configurable.
--
-- Se acota AHORA porque su stream de sync se acota en el mismo cambio (junto
-- con los de levantamiento, levantamiento_sku, exhibicion y contingencia): la
-- bajada al teléfono ya no replica el tenant entero, así que acotar la RLS es
-- un cierre real y no cosmético.
--
-- Mismo patrón CASE por rol que `visita_respuesta`. El cliente-marca conserva
-- su lectura (las respuestas del levantamiento son evidencia de tienda, no un
-- dato laboral como el checklist de check-in) y el staff, todo. Sin rama ELSE
-- a propósito: un rol nuevo cae en NULL, y NULL en una política es denegar.
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
