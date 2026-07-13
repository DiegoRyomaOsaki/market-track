# ADR-0001 — Offline-first con un motor de sincronización dedicado

- **Estado:** **propuesto** — la investigación del spike del motor offline está
  hecha y no tumba la decisión; falta el **prototipo ejecutable** que la valide
  (ver "Lo que el prototipo todavía debe probar")
- **Fecha:** 2026-06-18 · investigación del spike incorporada el 2026-07-13

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
| **Motor dedicado (PowerSync)** | Réplica Postgres ⇄ SQLite gestionada, resolución de conflictos y reintentos resueltos; el equipo escribe features, no fontanería de sync | Coste mensual (el plan gratuito **no sirve** para el piloto, ver abajo); el aislamiento de **lectura** deja de estar cubierto por RLS y pasa a depender de las *sync rules* |
| WatermelonDB | Gratis, control total, muy usado en React Native | **No trae backend**: la documentación es explícita — *"Watermelon is only a local database — you need to bring your own backend"*. Hay que escribir y mantener los endpoints `pullChanges`/`pushChanges` y la resolución de conflictos. Última versión publicada (0.28.0) es de ~abril 2025, y en Expo no es de primera clase |
| Sync a mano (cola + SQLite) | Cero dependencias | El mayor riesgo de cronograma y de bugs del proyecto. Un solo dev pierde semanas aquí, y los bugs de sync son de los más difíciles de reproducir |

## Decisión

Usar un **motor de sincronización dedicado** en lugar de construir el sync a
mano. La dirección elegida es **PowerSync**.

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

## Consecuencias

**Lo que ganamos.** El riesgo técnico más grande del proyecto deja de estar en
nuestro código. El tiempo del único desarrollador se va en funcionalidad de
negocio, no en reconciliación de estados.

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

**Lo que el prototipo todavía debe probar** (y por lo que este ADR sigue en
`propuesto`):

- Que el ciclo **escribir-offline → reconectar → sincronizar** sobrevive sin
  pérdidas ni duplicados, y que reintentar el mismo payload es **idempotente**.
- Qué hace el motor ante un **conflicto** real (misma fila editada en servidor y
  en cliente).
- El **volumen de datos por mercaderista/mes**, para saber si 30 GB del plan Pro
  sobran o se quedan cortos.

**Cómo lo sabríamos si nos equivocamos.** Si el prototipo pierde o duplica filas
al reconectar; si el aislamiento por `tenant_id` en las sync rules resulta no ser
expresable para algún caso real (p. ej. un supervisor que ve varias marcas); o si
el coste escala mal con el volumen real del piloto.
