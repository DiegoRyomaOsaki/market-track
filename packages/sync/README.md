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
  integración de Supabase (MAR-63).
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
`packages/db`. Prerrequisitos:

```sh
supabase start                                  # Postgres + Auth local
supabase functions serve --env-file supabase/functions/.env   # el hook del OTP
pnpm --filter @market-track/sync sync:up        # el servicio PowerSync
```

Luego, con la anon key del Supabase local en el entorno:

```sh
ANON_KEY=<anon key local> pnpm --filter @market-track/sync test:sync
```

Para apagarlo: `pnpm --filter @market-track/sync sync:down`.

Los checks estáticos (`test`) sí corren sin nada levantado y van en CI.
