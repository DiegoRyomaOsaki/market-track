# @market-track/sync

Las reglas de sincronización del móvil y su harness de aislamiento (ADR-0001).

## Qué hay aquí

- **`config/streams.yaml`** — las *sync streams* (edición 3): qué se descarga al
  teléfono. **Es una superficie de seguridad aparte de la RLS**: PowerSync
  replica con un rol `BYPASSRLS`, así que la bajada NO pasa por las políticas de
  Postgres. El acceso vive en un solo CTE (`mi_tenant`) que exige acceso efectivo
  (usuario activo, cliente activo) **y** segundo factor (`aal2`, MAR-71). Si algo
  de eso falla, no baja ni una fila.
- **`config/service.yaml`** + **`docker-compose.yaml`** — el servicio PowerSync
  autohospedado para desarrollo y para el harness. Bucket storage en MongoDB
  (autohospedar exige un replica set; el storage en Postgres no arranca en la
  1.23.3 — ver ADR-0001).
- **`config/postgres-setup.sql`** — el rol de replicación (`powersync_role`,
  `BYPASSRLS`) y la publicación. Local/harness; en producción lo gestiona la
  integración de Supabase (MAR-63). Lo aplica `sync:setup`, y también el
  preflight del harness. **Hace falta después de cada `supabase db reset`**: el
  reset reconstruye la base y se lleva la publicación por delante.
- **`test/preparacion.ts`** — el preflight: prepara Postgres y comprueba los
  prerrequisitos antes de que los tests puedan mentir. Sin él, una replicación
  muerta se ve exactamente igual que un fallo de aislamiento.
- **`src/streams.test.ts`** — checks estáticos del contrato de seguridad
  (rápidos, sin servicios, corren en CI).
- **`test/aislamiento.sync.test.ts`** — el harness en vivo: conecta clientes
  PowerSync reales como distintos usuarios y afirma qué se replica.

## El sync es el edición 3, no las «sync rules» legacy

`request.user_id()` y `bucket_definitions` son legacy; se rechazan al arrancar.
En edición 3 el usuario del token es `auth.user_id()` y los claims,
`auth.parameter('...')`. **Nunca** filtrar por `connection.parameter` /
`subscription.parameter`: los controla el cliente y falsificarlos sería la fuga
entre marcas.

## Correr el harness de aislamiento

Es un test pesado (habla con servicios reales), como el harness de RLS de
`packages/db`. Desde un clon nuevo:

```sh
supabase start                            # Postgres + Auth + edge-runtime
supabase db reset                         # esquema y seed
pnpm --filter @market-track/sync sync:up  # Mongo + el servicio PowerSync

ANON_KEY=$(supabase status -o env | sed -n 's/^ANON_KEY="\(.*\)"/\1/p') \
  pnpm --filter @market-track/sync test:sync
```

El **preflight** hace el resto: aplica `postgres-setup.sql` (rol, grants y
publicación), comprueba que el rol entra y tiene `replication`/`bypassrls`, y se
asegura de que PowerSync esté replicando **contra la base actual** — si no lo
está, lo reinicia. Por eso no hay pasos manuales que recordar tras un reset.

El OTP del 2FA: `supabase start` levanta el `edge-runtime` con el hook, así que
ya no hace falta `functions serve` aparte. Si prefieres correrlo a mano, sigue
valiendo:

```sh
supabase functions serve --env-file supabase/functions/.env
```

Sin proveedor de correo, `enviar-otp` devuelve 500 salvo que `MT_OTP_DRY_RUN=true`
—entonces deja el código en su log—; el harness no lo necesita, porque lo lee de
`auth.mfa_challenges` por SQL. En CI se pone a `true` por eso.

Para apagarlo: `pnpm --filter @market-track/sync sync:down`.
Para reparar Postgres sin lanzar la suite: `pnpm --filter @market-track/sync sync:setup`.

Los checks estáticos (`test`) corren sin nada levantado. **Y desde MAR-132 el
harness corre en CI**, en el job «Aislamiento de la bajada (PowerSync)»: hasta
entonces solo lo lanzaba quien se acordaba, y un test que nadie ejecuta aparenta
cobertura sin protegerte de nada.
