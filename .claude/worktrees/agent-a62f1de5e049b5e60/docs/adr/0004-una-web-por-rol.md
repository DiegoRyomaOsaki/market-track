# ADR-0004 — Una sola app web para los tres roles

- **Estado:** aceptado
- **Fecha:** 2026-06-18 (portado al registro el 2026-07-13)

## Contexto

La web sirve a tres audiencias distintas: el **admin** de la outsourcing (pre-carga
de datos maestros), el **supervisor** (operación del día) y el **brand manager**
del cliente-marca (dashboard de solo lectura, y solo de su marca).

Comparten la misma base de datos, el mismo modelo de dominio y el mismo sistema
de autenticación. Lo que cambia es qué ven y qué pueden hacer.

## Opciones consideradas

| Opción | A favor | En contra |
|---|---|---|
| **Una app Next.js con grupos de ruta por rol** (`/admin`, `/supervisor`, `/cliente`) | Un despliegue, un pipeline, un conjunto de componentes; el modelo de dominio no se duplica | El portal del cliente comparte binario con el panel interno: un fallo de autorización expone superficie que no debería ni existir para él |
| Tres aplicaciones separadas | Aislamiento físico entre el portal del cliente y el panel interno | Tres despliegues, tres pipelines y la misma lógica triplicada. Para un MVP con un solo dev es **separación prematura**: multiplica el coste sin reducir el riesgo real |

## Decisión

**Una sola aplicación Next.js** con grupos de ruta por rol. La separación es de
rutas y de permisos, no de despliegue.

## Consecuencias

**Lo que ganamos.** Velocidad de MVP. Un componente, un tipo de dominio y una
consulta se escriben una vez.

**Lo que aceptamos a cambio.** El rol **no puede ser una condición de renderizado**.
Si la única barrera entre el brand manager y los datos del panel interno fuera un
`if` en un componente, el aislamiento sería cosmético. La autorización vive donde
no se puede esquivar: **middleware en el servidor + RLS en Postgres**. El
renderizado condicional es experiencia de usuario, nunca seguridad.

Si algún día el portal del cliente crece hasta justificar su propio ciclo de vida,
esta decisión se reemplaza — pero se paga entonces, con la información de
entonces.

**Cómo lo sabríamos si nos equivocamos.** Si aparece lógica de negocio del panel
interno filtrándose en el bundle del cliente, o si los dos productos empiezan a
necesitar cadencias de despliegue incompatibles.
