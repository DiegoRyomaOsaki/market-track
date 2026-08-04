-- Techo de tamaño para la definición de un formulario, en la propia tabla.
--
-- La integridad de esta columna `jsonb` la sostiene Zod en cada frontera, y así
-- seguirá: replicar en SQL la validación estructural (tipos de campo, opciones,
-- rangos) crearía un segundo dueño de la regla que se separaría del primero.
--
-- El TAMAÑO es otra cosa. `formulario_version` tiene `grant insert, update` a
-- `authenticated` y su política deja escribir a cualquier admin, así que una
-- escritura por PostgREST que no pase por la server action no encuentra ninguna
-- verja. Para la estructura eso es asumible —quien escribe es admin—, pero para
-- el tamaño no: cada versión publicada se replica a TODOS los teléfonos, y una
-- fila enorme no es un formulario mal hecho, es una sincronización rota en un
-- gama media con datos móviles.
--
-- 256 KB es el mismo techo que aplica `TOPES_FORMULARIO.bytesTotal` en
-- `packages/shared`. Un formulario real ocupa unos pocos KB.

alter table public.formulario_version
  add constraint formulario_version_definicion_tamano
  check (pg_column_size(definicion) <= 262144);

comment on constraint formulario_version_definicion_tamano
  on public.formulario_version is
  'Techo de 256 KB, el mismo que TOPES_FORMULARIO.bytesTotal en packages/shared. Aquí porque la escritura por PostgREST no pasa por Zod y una versión enorme se replica a cada teléfono.';
