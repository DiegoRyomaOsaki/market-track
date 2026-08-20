-- El tipo de alerta que levanta el guardarraíl anti-outage del plan de lealtad.
--
-- SOLA en su migración, y no por estilo: Postgres prohíbe USAR un valor de enum
-- nuevo en la misma transacción que lo añade (`unsafe use of new value of enum
-- type`), y el CLI de Supabase envuelve cada archivo de migración en una. La
-- migración siguiente lo usa en un índice parcial y en un array, así que las dos
-- cosas no caben en el mismo archivo.
--
-- Es un tipo de STAFF: habla del bono de un empleado de la outsourcing, no de la
-- operación de tienda que la marca compró. Quien decide que el cliente-marca no
-- lo ve es la POLÍTICA (y el emisor del feed en vivo) de la migración siguiente,
-- no la consulta que lo agrupe.

alter type public.tipo_alerta add value 'verificacion_fotos';
