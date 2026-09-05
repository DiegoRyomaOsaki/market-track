# ADR-0012 — El hallazgo lo deriva el servidor; la atención la declara el mercaderista, y por eso sí viaja desde el teléfono

- **Estado:** aceptado
- **Fecha:** 2026-09-05
- **Reemplaza a:** — *(complementa a [ADR-0011](0011-puntajes-derivados-en-la-base.md))*

## Contexto

La `incidencia` la crea un trigger de Postgres sobre `levantamiento_sku` y
`exhibicion`. El trigger corre **cuando la fila llega al servidor**, no cuando el
mercaderista la escribe en su réplica local. En una visita completa sin señal
—que es el caso normal y no el excepcional: el offline es el diferenciador #1 del
producto— el teléfono no tiene ninguna incidencia que mostrar, y **no da error**:
se ve exactamente igual que una visita sin hallazgos.

Eso bloquea la verja de check-out por incidencias no atendidas, que el cliente
pidió con estas palabras: *"el sistema no me va a permitir hacer checkout si yo no
levanté toditas las incidencias"* (4ª revisión, ~00:14:59). Una verja construida
sobre una lista que nunca llegó no bloquea nada — y **aparenta funcionar**, que es
peor que no tenerla.

Cuatro hechos condicionan la decisión:

1. **El proyecto ya decidió una vez cuál es la forma admisible de duplicar una
   regla derivada.** [ADR-0011](0011-puntajes-derivados-en-la-base.md): *"El
   quiebre es columna generada en `levantamiento_sku`; el móvil tiene un espejo en
   `apps/mobile/src/lib/quiebres.ts`, pero solo para pintar un badge mientras el
   mercaderista teclea sin señal… Esa es la forma admisible de duplicar: un eco
   efímero para la UI, nunca el valor que se persiste."*

2. **La migración que creó `incidencia` negó por escrito que la app la escriba.**
   No es una omisión que se pueda revisar a la ligera: *"`authenticated` NO tiene
   INSERT sobre esta tabla: que las apps no la creen no lo impone un
   procedimiento, lo impone la ausencia del grant… un segundo calculador en
   TypeScript divergiría del que ve el cliente."* Hay un test que lo fija.

3. **Servidor y teléfono no fechan el mundo igual.** El árbol de precio se evalúa
   con `(check_in_recibido_at at time zone 'America/Lima')::date` — el sello que
   pone el **servidor** cuando la visita llega por primera vez. El teléfono solo
   tiene `check_in_at`, la hora declarada de captura. En una visita hecha el lunes
   sin señal y sincronizada el miércoles son **días distintos**, y si el martes
   arrancó un periodo de precio nuevo o venció una promoción, los veredictos
   difieren. Esto es un defecto preexistente del servidor, no de este cambio, y
   tiene ticket propio.

4. **Hay un hallazgo que no se puede corregir desde la tienda.**
   `promo_no_comunicada` no depende de nada que el mercaderista pueda cambiar:
   solo se puede **atender**. Y atender hoy es un `UPDATE` sobre `incidencia`, una
   fila que sin señal no está en la réplica. El `UPDATE` afecta a cero filas,
   PowerSync no encola nada, y la acción del mercaderista —con su foto y su
   motivo— se pierde **sin un solo mensaje**.

El punto 4 es el que reencuadra el problema: **una verja que no se puede despejar
sin señal no es una verja, es una trampa.**

## Opciones consideradas

| Opción | A favor | En contra |
|---|---|---|
| **C** (la elegida) — el hallazgo se deriva efímero en el móvil y nace autoritativo en el servidor; la **atención** se persiste en su propia fila | Separa dos hechos que hoy comparten tabla: el hallazgo (derivado, dueño único el servidor) y la atención (**declarada**, y el mercaderista es su único dueño posible). El cliente nunca escribe un derivado, así que la objeción del hecho 2 no aplica. Una atención sin incidencia que la case deja de ser silencio y pasa a ser una fila consultable | Una tabla nueva con su RLS y sus enganches. Un estado intermedio —"atendida, aún sin confirmar"— que la UI tiene que pintar con honestidad |
| A — el móvil deriva y **persiste** `incidencia` | Es lo que los criterios de aceptación del ticket describen literalmente. Una sola tabla, sin piezas nuevas | Revierte el hecho 2: haría falta abrir el `grant insert` y borrar el test que lo fija. Abre superficie de falsificación sobre `origen` y `detalle`, que es justo sobre lo que puntúa el motor de puntaje — el mismo agujero que obligó a acreditar por `verificada_at` y no por `hash`. Y **no puede converger de verdad** por el hecho 3: reconciliaría dos veredictos fechados en días distintos, dejando en la base números que ningún motor produjo |
| B — el móvil deriva **solo la lista**, sin persistir nada | Encaja bit a bit con ADR-0011. Cero superficie de escritura nueva. La divergencia se autocorrige al sincronizar | Deja la verja sin forma de despejarse sin señal (hecho 4): o atrapa al mercaderista en la tienda, o es un aviso que no bloquea. Ninguna de las dos cosas es lo que pidió el cliente, y la siguiente iteración volvería a pedir A |
| C′ — el móvil inserta una `incidencia` *cáscara* con id determinista (uuid v5) y el servidor la confirma o la anula | Sin tabla nueva. La clave natural ancla de verdad | El móvil sigue escribiendo `origen` y **la existencia** de la fila: fabricar un `quiebre` y resolverlo con foto sigue siendo posible, y el guardia `where estado = 'pendiente'` impide al motor corregirlo después. Y exige calcular uuid v5 en React Native, asíncrono y a mano |
| D — la verja exige haber sincronizado | Cero duplicación, cero deriva posible | Rompe el diferenciador #1 del producto, y justo en la visita para la que existe el ticket: la que se hizo sin señal |

## Decisión

**El hallazgo lo deriva el servidor y solo el servidor. El móvil lo espeja de
forma efímera —nunca lo persiste— para pintar la lista y sostener la verja. Lo
que sí se persiste desde el teléfono es la ATENCIÓN, en su propia tabla, porque
no es un valor derivado sino una declaración del mercaderista sobre lo que hizo.**

Tres reglas que se derivan de esa frase y que el código tiene que cumplir:

1. **El espejo vive en `apps/mobile/src/lib/hallazgos.ts`, jamás en
   `packages/shared`.** ADR-0011 dice que la señal de haberse equivocado sería
   "que aparezca una función de puntaje en `packages/shared` o en el código de una
   app". Aquí el mismo razonamiento va al revés: el espejo tiene que quedar
   **inalcanzable para el panel y el portal**, o volvería la discusión de qué
   pantalla tiene razón. En `packages/db` solo entra el **corpus de casos**, que
   son datos, y lo consumen los dos ejecutores.

2. **Cuando la fila del servidor existe, manda ella.** El derivado solo rellena el
   hueco temporal. Si el motor dice `anulada` y el espejo dice que hay hallazgo,
   gana el servidor. Sin esta regla escrita, cada pantalla desempata a su manera.

3. **La atención no es poder nuevo.** El mercaderista ya podía escribir
   `estado`, `accion_tomada`, `motivo` y `foto_resolucion_id` sobre `incidencia`
   por grant de columnas. `atencion_hallazgo` no le da nada que no tuviera: le da
   una **puerta que funciona antes de que la incidencia exista**. Por eso el móvil
   pasa a escribir siempre por ahí, y deja de tocar `incidencia` directamente:
   una puerta, un dueño.

## Consecuencias

**Lo que ganamos.** Una visita hecha entera sin señal enseña sus hallazgos y
permite atenderlos, así que la verja de check-out se puede construir encima y
bloquea de verdad. La atención del mercaderista deja de poder perderse en
silencio. Y una atención que el motor nunca confirma queda **visible y sin
aplicar** en vez de desaparecer: es la alarma de que el espejo y el motor
discrepan, que hasta ahora no existía.

**Lo que aceptamos a cambio.**

- **Dos implementaciones del árbol de precio conviviendo**: la autoritativa en
  SQL y el espejo en TypeScript. No hay forma de evitarlo sin romper el offline.
  Lo que sí se hace es que **CI se ponga rojo cuando divergen**: un corpus de
  casos único que se ejecuta contra las dos, y un mapa exhaustivo por origen que
  no compila si el enum crece.
- **Un estado intermedio visible.** Entre atender y sincronizar, la lista dice
  "atendida — pendiente de sincronizar" en vez de fingir que ya está cerrada.
- **Una atención puede quedar huérfana** si el motor no confirma el hallazgo.
  Se acepta que quede visible y sin aplicar, en vez de descartarla en silencio.
- **El desfase de fecha del hecho 3 sigue ahí.** Bajo esta decisión se
  autocorrige —el único dato persistido lo escribió el motor— pero la lista puede
  cambiar al sincronizar, y eso hay que poder explicárselo a un supervisor.

**Cómo lo sabríamos si nos equivocamos.**

- Si aparece un `grant insert` sobre `incidencia` para `authenticated`, o
  desaparece el test que lo prohíbe: la decisión se revirtió sin ADR que lo diga.
- Si el espejo se muda a `packages/shared`, o el panel o el portal empiezan a
  importarlo: volvió el segundo calculador que ADR-0011 evita.
- Si el corpus deja de ejecutarse contra los dos lados —o se copia en dos
  ficheros— la única verja contra la divergencia deja de existir, y la deriva
  volverá a ser silenciosa.
- Si las atenciones huérfanas se acumulan en producción, el espejo está viendo
  hallazgos que el motor no produce: la regla duplicada ya divergió y hay que
  mirar cuál de las dos está mal.
