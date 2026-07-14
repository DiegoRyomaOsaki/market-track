-- Fija `search_path = ''` en las funciones que no lo tenían.
--
-- Lo detectó el advisor de seguridad de Supabase sobre el esquema ya desplegado
-- (`function_search_path_mutable`, 4 avisos). No se edita la migración anterior:
-- ya está aplicada en la nube, y las migraciones son un registro append-only.
--
-- ¿Es una vulnerabilidad real? En estas cuatro, no: son SECURITY INVOKER, así que
-- corren con los privilegios de quien las llama — manipular el search_path solo
-- afectaría a la sesión del propio atacante. La que SÍ importaba,
-- `app.perfil_efectivo()`, es SECURITY DEFINER y ya nació con `search_path = ''`
-- y todo calificado; por eso el advisor no la señala.
--
-- Aun así se endurecen: cuesta una línea, silencia el aviso, y elimina la duda
-- para el próximo que lea el esquema. Defensa en profundidad, no parche.
--
-- Con `search_path = ''`, los nombres sin calificar solo resuelven en pg_catalog
-- (que siempre se busca). Por eso `now()` sigue funcionando, y las referencias a
-- `app.perfil_efectivo()` y `public.rol_usuario` ya venían calificadas.

alter function app.rol_actual() set search_path = '';
alter function app.tenant_actual() set search_path = '';
alter function app.es_staff() set search_path = '';
alter function public.marcar_desactivacion() set search_path = '';
