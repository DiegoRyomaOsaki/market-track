-- `anon` deja de poder ejecutar la última función de `public` que conservaba el
-- ACL por defecto de Postgres.
--
-- Al crear una función, Postgres concede EXECUTE a PUBLIC salvo que la migración
-- lo revoque — y PUBLIC incluye a `anon`, el rol de una petición sin sesión. Es
-- un privilegio que aparece SOLO, sin que nadie lo escriba, así que no se ve en
-- el diff de la migración que lo introduce: se ve en el catálogo.
--
-- No es un agujero abierto: `marcar_desactivacion` es función de trigger, y
-- llamarla por RPC muere con "trigger functions can only be called as triggers".
-- Un trigger dispara con los privilegios de la tabla, no con EXECUTE sobre la
-- función, así que revocarlo no afecta a nada. Lo que se corrige es que el GRANT
-- sea más ancho que la puerta que hace falta — la regla del repo es que el grant
-- es la puerta y la RLS el portero; una puerta que no cierra nadie sobra.
--
-- Sus hermanas de trigger (`parada_solo_se_planifica_en_borrador`) ya lo
-- revocaban en su propia migración. Esta se quedó atrás por ser la más antigua
-- del esquema.

revoke execute on function public.marcar_desactivacion() from public;
