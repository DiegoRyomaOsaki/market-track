# ADR-0002 — Multi-tenant por RLS, no por base de datos separada

- **Estado:** aceptado
- **Fecha:** 2026-06-18 (portado al registro el 2026-07-13)

## Contexto

La plataforma sirve a varias marcas-cliente a la vez sobre la misma base de
datos. El compromiso con el cliente es explícito: **cada marca ve únicamente su
información**. Una fuga de datos entre marcas no es un bug, es el fin del
contrato.

La operación la sostiene un solo desarrollador.

## Opciones consideradas

| Opción | A favor | En contra |
|---|---|---|
| **RLS con `tenant_id` en un solo esquema** | Una sola base que operar, migrar y respaldar; el aislamiento lo aplica **Postgres**, no el código de la aplicación; escala a N marcas sin trabajo operativo | Una tabla sin RLS queda **legible por el mundo** vía PostgREST: el error es silencioso y catastrófico |
| Una base de datos por marca | Aislamiento físico, imposible cruzar datos por error | Un solo dev no puede operar N bases: N migraciones, N respaldos, N monitorizaciones. El coste operativo crece con cada cliente |
| Un esquema por marca | Aislamiento fuerte dentro de una base | Las migraciones se multiplican por marca; las consultas agregadas entre marcas (que el panel de la outsourcing necesita) se vuelven incómodas |

## Decisión

Un solo esquema, con **`tenant_id` en toda tabla de negocio** y **RLS activado
en la misma migración que crea la tabla**, con políticas por rol.

## Consecuencias

**Lo que ganamos.** El aislamiento deja de depender de que el desarrollador
recuerde filtrar por marca en cada consulta: lo garantiza el motor. Añadir una
marca nueva es insertar una fila, no aprovisionar infraestructura.

**Lo que aceptamos a cambio.** Una disciplina que no admite excepciones: **una
tabla nueva sin RLS es legible por el mundo** a través de PostgREST. La ventana
entre "creé la tabla" y "le puse RLS después" es exactamente por donde se filtran
los datos — por eso RLS va en la misma migración, nunca en una posterior. Además,
la clave `service_role` esquiva RLS por diseño: no puede aparecer jamás en código
que alcance a un cliente.

Esta decisión protege a la web (PostgREST). **No protege al móvil** si se usa un
motor de sincronización que no pase por RLS — ver [ADR-0001](0001-motor-offline-dedicado.md).

**Cómo lo sabríamos si nos equivocamos.** Si el harness de tests de aislamiento
multi-tenant no consigue demostrar que un usuario de la marca A no alcanza ni una
fila de la marca B, con cada rol y cada tabla.
