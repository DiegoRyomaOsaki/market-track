-- Endurecimiento salido del PRIMER despliegue a la nube.
--
-- Los advisors de Supabase solo corren contra un proyecto desplegado, y hasta
-- hoy no había ninguno: 21 migraciones escritas sin que nadie pudiera pasarles
-- este linter. Al sembrar staging (MAR-63) aparecieron siete avisos, todos de
-- funciones creadas después de `20260714190000_fija_search_path_en_funciones`,
-- que es la migración que estableció esta misma convención por el mismo motivo.
--
-- Igual que aquella: no se editan las migraciones anteriores. Ya están aplicadas
-- y son un registro append-only.

-- --- `function_search_path_mutable` (6 avisos) --------------------------------
--
-- Las seis son SECURITY INVOKER, así que corren con los privilegios de quien
-- llama: manipular el `search_path` solo afectaría a la sesión del propio
-- atacante, y la RLS de cada tabla sigue en pie. No es una vulnerabilidad
-- explotable — se endurecen porque cuesta una línea, silencia el aviso y le
-- ahorra la duda al siguiente que lea el esquema.
--
-- Con `search_path = ''` los nombres sin calificar solo resuelven en pg_catalog.
-- Las seis ya referencian todo como `public.…` / `app.…`, así que nada cambia.

alter function public.dashboard_kpis(date, date, uuid, uuid) set search_path = '';
alter function public.dashboard_pines(date, date, uuid, uuid) set search_path = '';
alter function public.dashboard_alertas(date, date, uuid, uuid) set search_path = '';
alter function public.tablero_dia(date) set search_path = '';
alter function public.tablero_contingencias(date) set search_path = '';
alter function public.bandeja_solicitudes(boolean) set search_path = '';

-- --- `anon` podía invocar una SECURITY DEFINER (1 aviso) ----------------------
--
-- `public.portal_modulos()` se creó con `grant execute … to authenticated,
-- service_role`, y aun así `anon` podía llamarla por
-- `/rest/v1/rpc/portal_modulos` sin sesión.
--
-- Hacen falta LOS DOS revokes, porque local y la nube conceden distinto — algo
-- que solo se ve teniendo ambos delante, y hasta hoy no los había:
--
--   * En la NUBE el ACL dice `anon=X/postgres`: un grant EXPLÍCITO, que viene del
--     *default privilege* que Supabase deja en el esquema `public` para `anon`,
--     `authenticated` y `service_role`. Un `revoke … from public` no lo toca.
--   * En LOCAL el ACL dice `=X/postgres`, que es PUBLIC. `anon` lo hereda, y
--     revocar de `anon` no le quita nada.
--
-- Revocar de uno solo deja el agujero abierto en el otro entorno.
--
-- Lo que devolvía a un anónimo era inofensivo (flags de UI, y sin tenant efectivo
-- salen todos en `true`, el default documentado), pero es una SECURITY DEFINER
-- expuesta sin necesidad.
--
-- `authenticated` se queda: es quien la consume desde el portal. El advisor
-- también lo señala, y ahí el aviso es informativo, no un defecto.
revoke execute on function public.portal_modulos() from public;
revoke execute on function public.portal_modulos() from anon;

-- --- Las mismas migas en el esquema `app` ------------------------------------
--
-- El advisor no las señala porque `app` no está expuesto por PostgREST, así que
-- no hay ruta desde fuera. Pero tres SECURITY DEFINER se saltaron el `revoke`
-- que el resto del repo sí lleva, y una de ellas es `app.perfil_efectivo()` —
-- que el propio esquema describe como "el ÚNICO dueño de la regla de acceso
-- derivada". La higiene de una función así no debería depender de que su esquema
-- siga sin exponerse.
--
-- Aquí basta con `from public`: `app` no tiene los default privileges que
-- Supabase pone en `public`, así que el EXECUTE llega por PUBLIC en los dos
-- entornos (comprobado en ambos).
revoke execute on function app.perfil_efectivo() from public;
revoke execute on function app.formulario_version_inmutable() from public;
revoke execute on function app.revalidar_geocerca_visita() from public;

-- Queda un aviso sin atender a propósito: `extension_in_public` por `pg_net`.
-- La instala Supabase en `public` y la usa el webhook de alertas por email
-- (`20260715183000_webhook_alerta_email.sql`). Moverla de esquema rompería ese
-- webhook a cambio de silenciar un aviso informativo sobre una extensión que no
-- expone datos. Si algún día se toca, es su propio cambio con su propia prueba.
