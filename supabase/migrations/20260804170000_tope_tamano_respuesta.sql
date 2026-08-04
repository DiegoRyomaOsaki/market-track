-- Techo de tamaño para la respuesta de un campo libre.
--
-- Quien escribe aquí es el MERCADERISTA: el actor de menor confianza del
-- sistema, y el único que sube datos desde un dispositivo que no controlamos.
-- La app trunca el texto al coercionar (`coercionValorRespuesta`) y el campo de
-- la pantalla ya limita lo tecleable, pero ninguna de esas dos verjas existe
-- para una sesión comprometida que hable directamente con PostgREST.
--
-- Y una respuesta no se guarda una vez: es una fila por campo, por levantamiento,
-- por visita. Lo que se cuele aquí se multiplica por toda la operación —en
-- Postgres, en la réplica que descarga el resto del tenant y en el SQLite de un
-- Android de gama media.
--
-- 16 KB deja holgura sobre el tope de la app (10.000 caracteres para un párrafo,
-- que en UTF-8 con acentos no llega a 16 KB) sin dejar sitio a un abuso. El
-- límite fino por tipo de campo lo pone Zod, que sí sabe si el campo era `texto`
-- o `parrafo`; aquí solo está el techo que no depende de la definición.

alter table public.levantamiento_respuesta
  add constraint levantamiento_respuesta_valor_tamano
  check (pg_column_size(valor) <= 16384);

comment on constraint levantamiento_respuesta_valor_tamano
  on public.levantamiento_respuesta is
  'Techo de 16 KB por respuesta. La app ya trunca por tipo de campo; esto para a una sesión comprometida que escriba por PostgREST saltándose la app.';
