# ADR-0010 — El formulario de levantamiento es una definición versionada que configura presentación y campos libres, no las reglas de negocio

- **Estado:** aceptado
- **Fecha:** 2026-07-28
- **Reemplaza a:** —

## Contexto

En la 2ª revisión con el cliente (jul 2026) se pidió que el administrador pueda
**editar el formulario** que ven los mercaderistas, y se decidió un **constructor
completo** (formularios *schema-driven*), no solo activar/desactivar pasos (ver
[[04 - Módulos y Funcionalidades]] y MAR-73).

Hoy el wizard de levantamiento es fijo y secuencial (MAR-36/37/38): cinco pasos
codificados, con la **secuencia obligatoria** y la **contingencia (bypass)**
como invariantes del alcance contractual, y con los **campos derivados**
(quiebre, diferencia, Share of Shelf) calculados **por la base** — nunca por el
cliente (regla de oro del proyecto, ver `CLAUDE.md` y ADR-0002). El motor de
alertas (MAR-28) depende de que esos flags los ponga Postgres.

La tensión: un formulario totalmente libre chocaría con esas tres invariantes.
Hay que decidir **hasta dónde configura el formulario** y cómo se guarda,
versiona y sincroniza sin abrir una segunda fuente de verdad de la lógica.

## Opciones consideradas

| Opción | A favor | En contra |
|---|---|---|
| **A** (elegida): definición **jsonb versionada** (`formulario_version`), publicada de forma **inmutable**, que configura **presentación + campos libres**; la lógica de negocio y los derivados siguen en la base | Da el "constructor completo" sin mover reglas al cliente; publicar congela una versión, así una visita en curso no cambia de formulario bajo los pies; la definición se valida con Zod en cada frontera | Dos superficies del wizard que mantener coherentes (núcleo codificado + presentación configurable); el render y el builder no son triviales (MAR-80/79) |
| B: formulario **totalmente dinámico** (define TODOS los campos, incluidos stock/precio/SOS) | Un solo motor de formularios | Mueve quiebre/diferencia/SOS y sus reglas al cliente → rompe "los derivados los pone la base", el motor de alertas y el aislamiento; reescribe el núcleo transaccional |
| C: **sin** formulario configurable, wizard fijo para siempre | Lo más simple; ya funciona | Incumple lo pedido por el cliente en la 2ª revisión |

## Decisión

El formulario de levantamiento se modela como una **definición `jsonb`
versionada** (`formulario_levantamiento` → `formulario_version`). Publicar una
versión la vuelve **inmutable**; editar crea una versión nueva. La definición
describe **pasos, orden, etiquetas, ayuda y campos LIBRES** (texto, número,
selección, foto…) por paso — la **presentación** y los datos extra que cada
cliente quiera capturar. **No** describe los pasos con lógica de negocio ni sus
campos derivados: SOS, quiebres/diferencias y precios siguen codificados y
calculados por la base. La **secuencia obligatoria** y la **contingencia
(bypass)** las sigue garantizando el shell del wizard, independientes de la
definición. El móvil replica solo la **versión publicada** de su cliente.

## Consecuencias

**Lo que ganamos.** El admin configura el formulario por cliente y el móvil lo
renderiza. El versionado inmutable deja que una publicación nueva **no rompa
visitas en curso** (cada levantamiento se ancla a la versión que usó — el enlace
`levantamiento.formulario_version_id` lo añade MAR-80). La definición se valida
con Zod en la frontera (panel que escribe, móvil que lee), como el resto de
payloads del proyecto.

**Lo que aceptamos a cambio.** Hay **dos superficies** para el wizard: el núcleo
codificado (business logic + derivados) y la capa de presentación configurable.
Mantenerlas coherentes es trabajo continuo, y el builder (MAR-79) y el render
(MAR-80) son no triviales. La definición es `jsonb` — su integridad la sostiene
Zod, no el tipo de la columna; un cambio de forma exige tocar el esquema Zod y
migrar definiciones viejas.

**Cómo lo sabríamos si nos equivocamos.** Si los campos "libres" empiezan a
necesitar **lógica** (cálculos, reglas entre campos, alertas), la frontera
"presentación + campos libres" está goteando y estaríamos reimplementando el
motor de derivados en el cliente — justo lo que esta decisión evita. Ahí habría
que replantear (o subir esa lógica a la base como un campo derivado más).

## Addendum (ago 2026) — el mismo formulario llega al check-in

MAR-98 extendió la decisión sin crear una segunda familia de tablas: la
cabecera ganó `ambito` (`'levantamiento' | 'check_in'`), con el mismo
constructor, el mismo versionado inmutable y la misma `definicion` jsonb. Un
formulario de check-in es **de la visita**, nunca de una marca (CHECK en la
base), y sus respuestas viven en `visita_respuesta` — el espejo de
`levantamiento_respuesta` colgando de `visita`. La visita ancla la versión que
se le mostró (`visita.formulario_version_id`), igual que el levantamiento.

Dos reglas propias del check-in: **nada bloquea el flujo** (el gate del
check-in sigue siendo ubicación + selfie; `obligatorio` se ignora y el builder
lo oculta en este ámbito), y **la ausencia es un dato derivable** — un campo
sin contestar no guarda centinela; la definición anclada dice qué se pidió y el
puntaje (MAR-100) cuenta filas, nunca referencias dentro de `valor`.
