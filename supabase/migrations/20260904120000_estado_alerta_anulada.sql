-- El estado que le faltaba a la alerta: el hallazgo dejó de existir.
--
-- Cuando el mercaderista corrige el stock que originó un quiebre, la alerta que
-- ya salió no se puede quedar como está —el supervisor tendría una bandeja llena
-- de hallazgos que ya no existen— pero tampoco puede marcarse `resuelta`:
-- "resuelta" significa que alguien la atendió, y el portal ofrecería "Reabrir"
-- sobre algo que ningún humano cerró. Se perdería además la señal de cuántas se
-- corrigen solas.
--
-- Es el mismo estado que `incidencia` estrenó para su caso gemelo, y por la
-- misma razón: distinguir "esto se arregló en el punto de venta" de "esto lo
-- gestionó una persona".
--
-- Va en su propia migración porque Postgres prohíbe USAR un valor de enum en la
-- misma transacción que lo añade, y la migración siguiente lo usa.

alter type public.estado_alerta add value 'anulada';
