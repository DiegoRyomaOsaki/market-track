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
-- 16 KB deja holgura sobre los 12 KB a los que recorta la app
-- (`TOPES_RESPUESTA.bytes`), contando el envoltorio de jsonb. La app recorta en
-- BYTES justamente para que esto se cumpla siempre: si midiera caracteres, un
-- párrafo de 10.000 acentos serían 20.012 bytes —medido— y la app dejaría
-- guardar algo que esta tabla rechaza. Como el móvil es offline-first, el
-- mercaderista se enteraría al sincronizar, horas después y fuera de la tienda.
--
-- Este `check` es la ÚNICA verja del lado del servidor. El límite por tipo de
-- campo (`texto` 2.000 caracteres, `parrafo` 10.000) vive en la app, y por tanto
-- solo protege al que usa la app: aquí no se puede distinguir el tipo del campo,
-- porque eso vive en la definición jsonb del formulario, no en esta fila.

alter table public.levantamiento_respuesta
  add constraint levantamiento_respuesta_valor_tamano
  check (pg_column_size(valor) <= 16384);

comment on constraint levantamiento_respuesta_valor_tamano
  on public.levantamiento_respuesta is
  'Techo de 16 KB por respuesta. La app ya trunca por tipo de campo; esto para a una sesión comprometida que escriba por PostgREST saltándose la app.';
