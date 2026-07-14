# ADR-0001 — Offline-first con un motor de sincronización dedicado

- **Estado:** **propuesto** — pendiente del spike del motor offline
- **Fecha:** 2026-06-18 (portado al registro el 2026-07-13)

## Contexto

Gran parte del trabajo del mercaderista ocurre **sin señal**: los sótanos y las
trastiendas de los supermercados de Lima no tienen cobertura. La app debe
permitir check-in, levantamiento completo y check-out en ese estado, y
sincronizar al recuperar red. El offline real es el **diferenciador #1** del
producto frente a la competencia y un argumento explícito de licitación.

El proyecto lo desarrolla **un solo desarrollador** con presupuesto ajustado y
un piloto comprometido para septiembre de 2026.

## Opciones consideradas

| Opción | A favor | En contra |
|---|---|---|
| **Motor dedicado (PowerSync)** | Réplica Postgres ⇄ SQLite gestionada, resolución de conflictos y reintentos resueltos; el equipo escribe features, no fontanería de sync | Coste mensual; **no ejecuta las políticas RLS** — el aislamiento multi-tenant en el móvil pasa a depender de sus *sync rules*, una segunda superficie de seguridad |
| WatermelonDB | Gratis, control total, muy usado en RN | La lógica de sincronización con el backend hay que **escribirla y mantenerla a mano**, incluida la resolución de conflictos |
| Sync a mano (cola + SQLite) | Cero dependencias | El mayor riesgo de cronograma y de bugs del proyecto. Un solo dev pierde semanas aquí, y los bugs de sync son de los más difíciles de reproducir |

## Decisión

Usar un **motor de sincronización dedicado** en lugar de construir el sync a
mano. La dirección elegida es **PowerSync**.

## Consecuencias

**Lo que ganamos.** El riesgo técnico más grande del proyecto deja de estar en
nuestro código. El tiempo del único desarrollador se va en funcionalidad de
negocio, no en reconciliación de estados.

**Lo que aceptamos a cambio.** Una dependencia de proveedor con coste mensual, y
—lo importante— **una segunda superficie de aislamiento multi-tenant**: PowerSync
se conecta a Postgres con sus propias credenciales y no pasa por RLS. Las
políticas de Postgres protegen a PostgREST (web), pero **no al móvil**. El
aislamiento en el móvil vive en las *sync rules*, y un error ahí filtra datos
entre marcas sin que ninguna política RLS lo impida.

**Por qué sigue en `propuesto`.** Esa asimetría es exactamente lo que el spike
del motor offline debe cerrar antes de que se escriba código encima. El spike
confirma esta decisión (y la pasa a `aceptado`) o la reemplaza con otro ADR.

**Cómo lo sabríamos si nos equivocamos.** Si el spike demuestra que las sync
rules no pueden garantizar el aislamiento por `tenant_id`, o si el coste del
proveedor escala mal con 50 mercaderistas sincronizando fotos y visitas a
diario, esta decisión cae.
