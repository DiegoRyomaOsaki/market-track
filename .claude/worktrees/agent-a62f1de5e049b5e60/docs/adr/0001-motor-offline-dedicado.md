# ADR-0001 — Offline-first con un motor de sincronización dedicado

- **Estado:** **aceptado** — el prototipo ejecutable corrió contra un PowerSync
  autohospedado y el Postgres del proyecto; la decisión se sostiene. Ver
  "Lo que el prototipo probó" (2026-07-16).
- **Fecha:** 2026-06-18 · investigación del spike incorporada el 2026-07-13 ·
  prototipo ejecutado el 2026-07-16
- **Alternativas reevaluadas:** 2026-07-13 — nueve candidatos, ninguno desplaza
  la decisión. Antes de reabrir este debate, lee "Opciones consideradas": lo más
  probable es que la opción que tienes en mente ya esté ahí, con su motivo de
  descarte y su fuente.

## Contexto

Gran parte del trabajo del mercaderista ocurre **sin señal**: los sótanos y las
trastiendas de los supermercados de Lima no tienen cobertura. La app debe
permitir check-in, levantamiento completo y check-out en ese estado, y
sincronizar al recuperar red. El offline real es el **diferenciador #1** del
producto frente a la competencia y un argumento explícito de licitación.

El proyecto lo desarrolla **un solo desarrollador** con presupuesto ajustado y
un piloto comprometido para septiembre de 2026.

## Opciones consideradas

Se evaluaron **nueve alternativas** contra cuatro criterios innegociables:
(a) escritura offline real y duradera en React Native, (b) que **Postgres siga
siendo la fuente de verdad**, (c) aislamiento por marca, (d) mantenible por un
solo desarrollador con el piloto en septiembre de 2026.

### Los tres finalistas

| Opción | Coste real | ¿RLS en lectura? | Protocolo de sync | Conflictos | Madurez |
|---|---|---|---|---|---|
| **PowerSync** (elegida) | **~$588/año** (Pro, $49/mes) | ❌ No — *sync rules* | Completo | Del motor (por confirmar en el prototipo) | GA; el caso de uso móvil-offline **es** su producto |
| RxDB | **~$1.188/año** (Pro, $99/mes) | ✅ **Sí** | Completo: checkpoints, tombstones, detección de conflictos | Detecta; **el handler lo escribes tú** | GA, activo |
| Legend-State v3 | **$0** (MIT) | ✅ **Sí** | Débil: diff por timestamp, sin desempate | **Ninguno: lo escribes tú** | **Beta desde hace ~2 años** |

**Por qué no RxDB, pese a eliminar la segunda superficie de seguridad.** Es su
virtud real: como todo viaja por `supabase-js`, **RLS protege lectura y
escritura**. Pero cuesta **el doble**, no la mitad — su almacenamiento SQLite
gratuito es una versión de prueba **limitada a 500 documentos**, y solo el
catálogo de SKUs y precios ya la revienta, así que en producción es de pago.
Además impone el impuesto de esquema (ver abajo) y el handler de conflictos
vuelve a ser código nuestro. **Es una alternativa legítima**, no una descartada
por inferior: si algún día el aislamiento entre marcas pesa más que ~$600/año,
este ADR se reemplaza.

**Por qué no Legend-State.** Es el único gratis de verdad y es RN-first, pero
lleva **dos años en beta**, su *pull* es un diff por timestamp sin clave de
desempate (puede perder o repetir filas justo en el borde) y **no documenta
resolución de conflictos**. Para el motor del que depende el diferenciador #1
del producto, es demasiada superficie sin garantías.

### Las descartadas, y por qué

| Opción | Motivo de descarte |
|---|---|
| **Zero** (Rocicorp) | **No admite escritura offline.** Su documentación: *"Zero does not support offline writes… writes are rejected"* estando desconectado. Fin. |
| **ElectricSQL** | Motor **solo de bajada** — *"Electric does not do write-path sync"*. En 2024 reescribieron el producto y **eliminaron justo la escritura local** que necesitamos. Hoy exigiría ensamblar TanStack DB (beta) + su persistencia (**alpha**) + endpoints de mutación propios. Y su aislamiento es **peor**: un proxy de autorización que escribes y operas tú. |
| **WatermelonDB** | **No trae backend**: *"Watermelon is only a local database — you need to bring your own backend"*. Endpoints `pullChanges`/`pushChanges` y conflictos, a mano. Última versión 0.28.0 (~abril 2025); en Expo no es de primera clase. |
| **Triplit** | Sustituye a Postgres. Y está muerto: **Supabase compró al equipo en octubre de 2025** y declaró que **no** lo integraría; sin commits desde septiembre de 2025. |
| **InstantDB** · **Turso/libSQL** · **Couchbase Lite / PouchDB** | Todas **exigen abandonar Postgres** como fuente de verdad (ver el precio abajo). Turso además tiene la escritura offline en beta, con *last-push-wins* y sin garantías de durabilidad declaradas. |
| **cr-sqlite / vlcn** | **Abandonado** — sin commits desde 2024. |
| **Sync a mano** (cola + SQLite) | El mayor riesgo de cronograma y de bugs del proyecto. Los bugs de sync son de los más difíciles de reproducir, y aparecen en un sótano, no en el escritorio. |

**Lo que costaría abandonar Postgres** (y por qué cuatro de las nueve se caen
solas): perder **RLS**, perder **PostGIS** —y con él la revalidación de geocerca
en servidor, que es la mitad *de seguridad* del check-in—, perder los campos
derivados en vistas y triggers, las Edge Functions, Supabase Auth y los tipos
generados. Entre **2 y 4 meses de rearquitectura sin valor nuevo**, con el
piloto comprometido para septiembre. Es un descarte por calendario antes que
por técnica.

## Decisión

Usar un **motor de sincronización dedicado** en lugar de construir el sync a
mano. La dirección elegida es **PowerSync**.

Dos señales externas la respaldan: **Supabase nombró explícitamente a PowerSync**
(junto a ElectricSQL y Zero) como motor de sincronización con el que quiere
asociarse, al anunciar la compra de Triplit en octubre de 2025. Y de los nueve
candidatos, es el único cuyo caso de uso central —operarios de campo,
offline-first, sobre Postgres— **es exactamente el nuestro**.

## Cómo se aísla el tenant en el móvil (la pregunta del spike)

Verificado contra la documentación vigente de PowerSync (julio 2026). **El
aislamiento del móvil es asimétrico** — y esta asimetría es el hallazgo central
de este ADR:

### La bajada de datos NO pasa por RLS

PowerSync replica desde Postgres leyendo el WAL con un rol dedicado que la
propia guía de integración crea así:

```sql
CREATE ROLE powersync_role WITH REPLICATION BYPASSRLS LOGIN PASSWORD '...';
```

**`BYPASSRLS` es literal**: al replicar, PowerSync ve todas las filas, sin que
ninguna política de Postgres se aplique. Lo que el mercaderista se **descarga**
lo deciden **exclusivamente las *sync rules***. Un error ahí filtra datos entre
marcas y **ninguna política RLS lo impedirá**.

### La subida de datos SÍ pasa por RLS

Las escrituras locales se encolan y se envían **con el cliente de Supabase**, es
decir por **PostgREST** — donde las políticas RLS sí se aplican con normalidad.
Un mercaderista no puede insertar ni modificar filas de otra marca si las
políticas están bien escritas.

> Corolario práctico: **RLS sigue siendo obligatorio** y sigue protegiendo el
> camino de escritura del móvil. Lo que NO protege es la lectura. Decir "RLS no
> cubre al móvil" a secas es falso y peligroso en la otra dirección: invita a
> descuidar las políticas.

### Cómo se expresa el aislamiento

Con una *parameter query* que consulta la tabla `profile` con el `sub` del JWT,
y *data queries* que filtran por el parámetro resultante:

```yaml
bucket_definitions:
  tenant_del_usuario:
    parameters: SELECT tenant_id FROM profile WHERE id = request.user_id()
    data:
      - SELECT * FROM visita WHERE tenant_id = bucket.tenant_id
```

No hacen falta claims personalizados en el JWT: el `tenant_id` sale de la base
de datos, que es la fuente de verdad. PowerSync valida el JWT de Supabase
(configura el endpoint JWKS del proyecto automáticamente).

### ⚠️ La trampa que hay que evitar

PowerSync admite tres orígenes de parámetros: los del **token** (claims del JWT,
firmados), los de **tabla**, y los del **cliente**. Sobre los últimos, la
documentación advierte de forma explícita:

> *"Client Parameters should always be treated with care, and should not be used
> for access control purposes."* — el cliente puede enviar **cualquier valor**.

Una sync rule que filtre por un parámetro de cliente (`request.parameters()`) en
lugar de por el token o una tabla **es la fuga entre marcas**: bastaría con que
un mercaderista alterase el valor que envía su app. El aislamiento solo puede
apoyarse en `request.user_id()` (o en otro claim firmado) y en tablas.

Límite a tener presente: **≤ 1.000 buckets por usuario**, así que las
definiciones no pueden ser demasiado granulares.

## Limitaciones y restricciones de diseño

Más allá del precio y de la superficie de seguridad, PowerSync impone
restricciones que muerden **al implementar**, no al elegir:

- **≤ 1.000 *buckets* por usuario.** Los datos se reparten en cubos que se
  sincronizan por usuario, y no pueden ser demasiado granulares. Hay que
  agrupar con criterio (por mercaderista, por rutero del día, por tienda), no
  crear un bucket por cada cosa.
- **Las *sync rules* usan un subconjunto limitado de SQL.** No hay joins
  complejos ni agregaciones. Esto empuja a **desnormalizar** — por suerte, el
  `tenant_id` en toda tabla de negocio (ver [ADR-0002](0002-multi-tenant-por-rls.md))
  es justo lo que hace falta para filtrar sin joins.
- **Todo lo que el móvil lee, se descarga y vive en el dispositivo.** Hay que
  acotar el alcance con disciplina (el rutero del día, no el histórico), o el
  Android de gama media se llena.
- **Los despliegues no son atómicos.** Un cambio de esquema obliga a cambiar las
  sync rules *y* el esquema del cliente, pero habrá teléfonos con la app vieja
  aún sincronizando. Los cambios deben ser **aditivos primero**.
- **El plan gratuito se desactiva tras una semana de inactividad.** Sirve para
  desarrollar; confundirlo con producción es una bomba de relojería.

**El impuesto de esquema que PowerSync NO cobra.** Las alternativas basadas en
`supabase-js` (RxDB, Legend-State) exigen **claves primarias de texto**,
`updated_at` mantenido por trigger y **borrado lógico en todas las tablas** —
prohibido el `DELETE` real, en el panel, en las Edge Functions y en SQL.
PowerSync no lo exige, porque lee el WAL y los borrados se propagan solos. Si
algún día se reemplaza este ADR por RxDB, **ese impuesto hay que pagarlo en las
migraciones**, así que la decisión no es reversible sin tocar el esquema.

## Consecuencias

**Lo que ganamos.** El riesgo técnico más grande del proyecto deja de estar en
nuestro código. El tiempo del único desarrollador se va en funcionalidad de
negocio, no en reconciliación de estados.

**Riesgo de ciclo de vida del proveedor — real, y con precedente.**
**Atlas Device Sync de MongoDB, la respuesta estándar de la industria para sync
móvil, fue apagada el 30 de septiembre de 2025.** En esta categoría, que el
proveedor cierre la persiana no es hipotético. La mitigación no es cambiar de
motor —los demás tienen el mismo riesgo, o están muertos ya— sino **mantener la
integración detrás de una frontera fina y reemplazable** (`packages/sync`), de
modo que las apps hablen con nuestra abstracción y no con el SDK del proveedor
esparcido por todo el código.

**Lo que aceptamos a cambio — una segunda superficie de seguridad.** El
aislamiento de lectura del móvil vive en las *sync rules*, fuera de Postgres. Es
un lugar nuevo donde equivocarse, y los tests de aislamiento multi-tenant tienen
que cubrirlo: un harness que solo pruebe RLS **da un falso verde** para el móvil.

**Lo que aceptamos a cambio — coste real.** El plan gratuito (2 GB
sincronizados/mes, 500 MB alojados, **50 conexiones concurrentes pico**, y
**desactivación del proyecto tras una semana de inactividad**) **no sirve para el
piloto**: 20–50 mercaderistas más supervisores rozan o superan ese techo de
conexiones, y la desactivación automática es descalificante para producción. El
plan **Pro arranca en USD 49/mes** (30 GB sincronizados, 10 GB alojados, 1.000
conexiones). El ticket del spike y `docs/06` decían "~USD 35/mes": está
desactualizado.

## Lo que el prototipo probó (2026-07-16)

Se levantó el servicio autohospedado (`journeyapps/powersync-service:1.23.3`)
contra el Postgres del proyecto y se conectó un cliente real (`@powersync/node`
0.19.4) autenticado como el mercaderista del seed. **Las cuatro preguntas que
dejaban este ADR en `propuesto` están respondidas, medidas, no supuestas:**

| Pregunta | Resultado |
|---|---|
| ¿Pierde o duplica al reconectar? | **No.** 5 visitas escritas sin conexión → reconectar → 5 de 5 en Postgres, en un solo lote |
| ¿El reintento del mismo payload es idempotente? | **Sí.** Se forzó el peor caso —el servidor aplica la escritura y la red muere **antes del ack**— y el reintento dejó **1 fila, no 2** |
| ¿Qué hace ante un conflicto? | **Convergen, y gana el cliente.** Misma fila y misma columna cambiadas en servidor y en cliente offline: al sincronizar, ambos lados quedan con el valor del cliente (last-write-wins) |
| ¿Volumen por mercaderista/mes? | **785 kB** (110 visitas · 220 levantamientos · 4.400 filas de SKU). El piloto entero (40 mercaderistas): **31 MB/mes** |

**El volumen no es la restricción.** Los 30 GB del plan Pro son ~1.000× lo que
el piloto genera. Lo que descalifica al plan gratuito son las **50 conexiones
concurrentes** y la desactivación por inactividad, no los datos.

**Cuando la subida falla, la cola aguanta.** Se observó el reintento indefinido
del mismo lote (una FK rechazada por Postgres, 5 reintentos, cero filas
perdidas): el batch solo se marca completo tras el éxito. Ese es el motivo de que
**el backend deba ser idempotente** — la propia doc lo exige: *"the backend may
receive the same operation multiple times… and must handle that appropriately"*.
Nuestro camino de subida usa `upsert` por el id que genera el cliente, que lo es.

**Una regla mal escrita no sincroniza de más: revienta el arranque.** Con una
sync rule inválida el servicio sale con exit 1 y no replica nada. Falla cerrado.

## ⚠️ El hallazgo que no estaba en el guion: el 2FA no protege la bajada

El gate `aal2` de [ADR-0008](0008-segundo-factor-multicanal-sobre-mfa-nativo.md)
vive dentro de `app.perfil_efectivo()`, o sea **en la RLS**. Y la RLS no
interviene en la bajada del móvil.

Medido: un mercaderista con sesión **`aal1`** (contraseña sí, segundo factor
**no**) conectó su cliente y **recibió su tienda y sus visitas**. La subida, en
cambio, sí quedó bloqueada por la RLS hasta completar el 2FA — la asimetría de
este ADR, ahora con evidencia en las dos direcciones.

No es un fallo de PowerSync: las *sync rules* filtran por `auth.user_id()`, que
existe en cuanto hay contraseña correcta. **El `aal` es un claim del JWT y hay
que exigirlo explícitamente en la regla** si se quiere que el segundo factor
cubra también los datos que se descargan al teléfono. Queda para MAR-26, que es
quien escribe `packages/sync`.

## Corrección: las *sync rules* de este ADR son el formato legacy

El ejemplo de `bucket_definitions` + `parameters:` + `request.user_id()` que
aparece arriba **es sintaxis legacy**. La documentación vigente (jul 2026) titula
esa página *"Sync Rules (Legacy)"* y recomienda **Sync Streams (edition 3)** para
proyectos nuevos. Verificado a la fuerza: con `edition: 3`, `request.user_id()`
se rechaza con `Invalid schema in function name`.

El equivalente correcto es **`auth.user_id()`**:

```yaml
config:
  edition: 3
streams:
  mi_tenant:
    auto_subscribe: true
    queries:
      - SELECT * FROM visita WHERE tenant_id IN
          (SELECT tenant_id FROM profile WHERE id = auth.user_id())
```

**La trampa se mueve, no desaparece.** El aviso literal *"client parameters…
should not be used for access control purposes"* solo está en la página legacy.
En Streams se reformula como un flag por stream,
`accept_potentially_dangerous_queries: false` (el default), que avisa cuando una
query usa parámetros que el cliente controla. La regla de `CLAUDE.md` sigue
siendo la correcta: filtrar **solo** por `auth.user_id()` o por tabla.

Y ojo con el ejemplo multi-tenant oficial: usa `auth.parameter('org_id')`, o sea
**un claim del JWT**. Ese patrón choca con este proyecto — un claim es una copia
rancia y el mercaderista de un cliente cancelado seguiría dentro hasta que expire
el token. El patrón bueno (también oficial) es la **subconsulta a la tabla de
pertenencia**, que es el de arriba.

## Lo que el prototipo NO probó

- **Nada en un teléfono real.** Corrió con `@powersync/node`, que habla el mismo
  protocolo, pero la integración de React Native (módulo nativo de SQLite, nueva
  arquitectura, ciclo de vida en Android) está sin verificar. Es MAR-26/MAR-33.
- **El bucket storage en Postgres.** La doc lo anuncia desde la 1.3.8; en la
  1.23.3 no consiguió arrancar (muere creando su propio esquema, sin error del
  lado de Postgres). Con MongoDB arrancó a la primera. **Autohospedar exige, en
  la práctica, un MongoDB con replica set.** Si algún día se autohospeda de
  verdad, hay que contarlo en el coste.
- **El límite de buckets por usuario** (≤1.000): con una visita por marca y por
  tienda conviene medirlo antes de modelar los streams.

**Cómo lo sabríamos si nos equivocamos.** Si el prototipo pierde o duplica filas
al reconectar; si el aislamiento por `tenant_id` en las sync rules resulta no ser
expresable para algún caso real (p. ej. un supervisor que ve varias marcas); o si
el coste escala mal con el volumen real del piloto.
