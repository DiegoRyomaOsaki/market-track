-- Perfect Store es una sección del portal, con su propio interruptor por cliente.
--
-- Es la propuesta de valor con la que se entra al mercado —"te ofrezco medirte
-- Perfect Store en Perú, que hoy nadie te lo hace"—, así que se vende y se
-- habilita por separado: un cliente que no lo contrató no debe verlo, ni en el
-- nav ni por URL.
--
-- Va SOLA en su migración. `alter type ... add value` no se puede usar dentro de
-- la misma transacción que lo añade, y cada archivo de migración es una
-- transacción: mezclarlo con algo que referencie 'perfect_store' fallaría.
--
-- No hace falta sembrar nada: `modulosDelCliente()` parte de "todo habilitado" y
-- solo apaga lo que la tabla diga, así que la sección nace visible para los
-- clientes existentes y el admin la puede apagar desde su pantalla — que itera
-- las opciones del enum y recoge la nueva sola.

alter type public.modulo_portal add value 'perfect_store';
