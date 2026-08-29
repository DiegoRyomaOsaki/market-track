-- `anon` deja de poder ejecutar tres funciones de `public`.
--
-- HACEN FALTA LOS DOS REVOKES, y esta es toda la lección de esta migración: la
-- nube y el local conceden el privilegio por caminos DISTINTOS, así que revocar
-- de uno solo deja el agujero abierto en el otro entorno.
--
--   * En la NUBE, Supabase deja un *default privilege* sobre `public` que estampa
--     un grant EXPLÍCITO al crear la función: el ACL dice `anon=X/postgres`. Un
--     `revoke … from public` no lo toca.
--   * En LOCAL no existe ese default: el ACL dice `=X/postgres`, que es PUBLIC, y
--     `anon` lo hereda. Ahí `revoke … from anon` no le quita nada.
--
-- Medido el 27 ago 2026 contra `market-track-staging`, no deducido del local:
-- `has_function_privilege('anon', …)` daba **true** para las dos primeras, y los
-- advisors seguían listándolas en `anon_security_definer_function_executable`.
-- En local daban false — de ahí que mirar solo el local diga que no hay nada que
-- arreglar. Es la misma trampa que documentó
-- `20260804190000_endurecer_funciones_del_primer_despliegue.sql` con
-- `portal_modulos()`, y por eso `recalcular_puntaje_merchandiser` ya está bien:
-- su migración sí hizo los dos.
--
-- Ninguna era explotable —las dos primeras abren con un guardia de staff, y a una
-- función de trigger no se la puede llamar por RPC—, pero la regla del repo es
-- que el GRANT es la puerta y la RLS el portero: una puerta abierta que nadie
-- necesita sobra.

-- La RPC de staff: solo se le quita a `anon`. `authenticated` la consume desde el
-- panel y `service_role` la necesita; el aviso 0029 sobre ellos es informativo.
revoke execute on function public.fijar_hora_parada(uuid, time) from anon;

-- Las dos de TRIGGER: no las necesita NINGÚN rol. Un trigger dispara con los
-- privilegios de la tabla, no con EXECUTE sobre la función — comprobado en vivo
-- quitándole el EXECUTE a `service_role` y viendo que el trigger seguía sellando
-- su columna. Así que se les quita a todos, que además cierra el aviso 0029.
revoke execute on function public.parada_solo_se_planifica_en_borrador()
  from public, anon, authenticated, service_role;

-- `marcar_desactivacion` es la más antigua del esquema y la única que conservaba
-- ADEMÁS el default de Postgres (`=X/postgres`): se le quitan los dos.
revoke execute on function public.marcar_desactivacion()
  from public, anon, authenticated, service_role;
