# ADR-0011 — Los puntajes de Perfect Store y Perfect Merchandiser se derivan en la base, con la configuración congelada en cada resultado

- **Estado:** aceptado
- **Fecha:** 2026-08-04
- **Reemplaza a:** —

## Contexto

La 3ª revisión con el cliente (3 ago 2026) añadió dos métricas: **Perfect Store**
—cómo de bien está ejecutada una marca en una tienda— y **Perfect Merchandiser**
—un plan de lealtad del mercaderista. Ver [[04 - Módulos y Funcionalidades]],
"Tercera revisión con el cliente".

Tres hechos condicionan dónde se calculan:

1. **El mismo número se consume desde tres sitios.** El portal del cliente, el
   panel del supervisor y la app del mercaderista muestran el puntaje. Si cada
   uno lo calcula, cada uno lo calcula distinto — y la discusión con la marca
   pasa a ser sobre cuál pantalla tiene razón.
2. **Los pesos los fija la marca y cambian.** *"Eso es decisión que se toma con
   el cliente… la marca es la que tiene que alinearnos."* Un puntaje de marzo no
   puede moverse porque en agosto alguien reajustó una ponderación.
3. **El proyecto ya tiene la regla y ya la ha roto una vez.** `CLAUDE.md` exige
   que los campos derivados (quiebre, diferencia, semáforo, KPIs) se calculen
   una sola vez en vistas/triggers/Edge Functions. La tentación aquí es mayor
   porque el formulario de levantamiento es configurable (ADR-0010) y parece
   natural dejar que el formulario "traiga" también su fórmula.

Además, el móvil es offline-first: no puede depender de una llamada de red para
mostrar un puntaje, así que sea cual sea el cálculo, el resultado tiene que
viajar por la réplica como un dato más.

## Opciones consideradas

| Opción | A favor | En contra |
|---|---|---|
| **A. Derivar en la base (vista/función SQL) y guardar el resultado con su configuración** (la elegida) | Un solo calculador para las tres pantallas. Verificable con `test:db` sobre datos sembrados. El histórico es estable por construcción. El móvil recibe un número ya calculado y funciona sin señal | SQL más denso que TypeScript. Cambiar una fórmula es una migración, no un deploy |
| B. Calcular en TypeScript compartido (`packages/shared`) y llamarlo desde web y móvil | Más cómodo de escribir y de testear con Vitest. Sin migraciones para ajustar | El portal es server-first y el móvil offline: acabarían siendo dos ejecuciones distintas del mismo código sobre datos distintos. Y el puntaje que ve la marca dependería de qué versión de la app tiene instalada cada quien |
| C. Que la fórmula sea parte de la definición del formulario configurable | El admin ajusta la métrica sin tocar código | Convierte un editor de formularios en un motor de reglas de negocio. Contradice ADR-0010, que acotó el formulario a *presentación y campos libres*. Un error de configuración se volvería un error de cálculo silencioso |
| D. Recalcular siempre al vuelo, sin guardar | Nunca hay datos rancios | El puntaje de un periodo cerrado cambiaría retroactivamente al tocar los pesos. Es justo lo que el cliente no puede aceptar: los bonos ya pagados dependen de esos números |

## Decisión

Los puntajes de Perfect Store y Perfect Merchandiser **se calculan en la base de
datos**, con un único calculador por métrica, y **cada resultado se persiste junto
a la configuración con la que se calculó**.

El formulario configurable (ADR-0010) sigue decidiendo **qué se captura**; nunca
**cómo se puntúa**. Son dos capas: el formulario define los campos, la base define
la métrica.

## Consecuencias

**Lo que ganamos.** Un solo número, el mismo en el portal, el panel y el teléfono.
El histórico es inmutable sin esfuerzo: reajustar pesos afecta a lo que se calcule
a partir de ahí, no a lo ya cerrado. El cálculo es verificable contra una base
sembrada (`test:db`), que es donde este proyecto ya prueba sus derivados. Y el
móvil recibe el puntaje como un dato replicado, así que la pantalla "Mi
desempeño" funciona sin señal.

**Lo que aceptamos a cambio.** Ajustar una fórmula pasa a ser una migración con su
revisión, no un cambio de una tarde — para una métrica que el cliente todavía está
afinando, esa fricción es real. El SQL de la ponderación no es trivial:
renormalizar cuando una variable no se evaluó, aplicar el bonus de POP por encima
de 100 y agregar por categoría y tipo de tienda son reglas que en TypeScript se
leerían más fácil. Y guardar la configuración con cada puntaje ocupa espacio y
obliga a versionar la tabla de configuración en vez de editarla en sitio.

**Cómo lo sabríamos si nos equivocamos.** Si aparece una función de puntaje en
`packages/shared` o en el código de una app, la decisión ya se rompió — ese es el
síntoma temprano. El síntoma tardío y caro: el cliente señala que el número del
portal no coincide con el del panel, o que un puntaje de un mes cerrado cambió sin
que nadie tocara los datos de campo. Si el ritmo de cambio de las fórmulas resulta
ser semanal en vez de ocasional, la fricción de la migración dejaría de estar
justificada y habría que revisar esto — probablemente moviendo los pesos a
configuración pura y dejando en SQL solo la mecánica de ponderar.
