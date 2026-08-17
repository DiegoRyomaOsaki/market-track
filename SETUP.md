# Puesta a punto en un equipo nuevo

```bash
git clone https://github.com/DiegoRyomaOsaki/market-track.git
cd market-track
pnpm bootstrap
```

Eso instala las dependencias, activa los hooks de git y te dice qué falta. Luego
quedan **dos pasos manuales** que ningún script puede hacer por ti (abajo).

> **pnpm no hace falta instalarlo.** La versión exacta está fijada en
> `packageManager` (con hash de integridad) y se autodescarga sola. Sí necesitas
> **Node ≥ 22.14**.

---

## Lo que `pnpm bootstrap` hace por ti

| | |
|---|---|
| **Instala** las dependencias (`pnpm install`) | |
| **Activa los hooks de git** (`core.hooksPath`) | Git **ignora** `.githooks/` por defecto: los hooks versionados no se activan solos. Sin esto, `.githooks/pre-push` no existe en tu máquina y **nada impide un push directo a `main` o `dev`** |
| **Audita** `gh` y `docker` | Te dice cuáles faltan y dónde bajarlos |

Es idempotente: correrlo dos veces no rompe nada. `pnpm install` también activa
los hooks por su cuenta (script `prepare`).

---

## Los dos pasos manuales

### 1. Autenticar Linear

El servidor MCP ya viene declarado en `.mcp.json`, así que Claude Code lo
reconoce al abrir el proyecto. Falta el OAuth:

```
/mcp  →  linear-mt  →  Authenticate
```

> ⚠️ **Cierra sesión en linear.app antes** (o hazlo en una ventana de incógnito).
> Si no, el flujo OAuth reusa la sesión abierta y acabas autenticado en el
> workspace equivocado. La cuenta correcta es **`diegopuerto0628@gmail.com`**.

### 2. Autenticar Supabase

```
/mcp  →  supabase-mt  →  Authenticate
```

Organización **`market-track`**, proyecto **`market-track`** (`us-east-1`).

### 3. Desactivar los conectores equivocados

```
/mcp  →  claude.ai Linear    →  disable
/mcp  →  claude.ai Supabase  →  disable
```

Los dos apuntan a **otras cuentas**: el de Linear a `diego@scrybe.pro`
(workspaces Scrybe/Sonar, que **no ven Market-Track**), y el de Supabase a la
organización `Gobigagency` (el proyecto "Gobig Back office", que **no es este**).

Si se quedan activos, un ticket puede acabar en el workspace equivocado o una
migración en la base de datos equivocada. Viven en `~/.claude.json`, que es
configuración **de tu máquina**: no viaja con el repositorio, así que **hay que
desactivarlos en cada equipo**.

---

## Por qué el script no automatiza esos dos pasos

Ambos viven en `~/.claude.json`, la configuración **global** de Claude Code.

Un script de un repositorio no debería reescribir la configuración global de tu
máquina a tus espaldas — es exactamente el tipo de cosa que un repo hostil
usaría para hacer daño, y el hábito de aceptarlo es peor que el ahorro de dos
comandos. Además, la autenticación OAuth es interactiva: abre un navegador y te
pide credenciales. No hay script que lo haga.

---

## Herramientas externas

| Herramienta | Para qué | Cuándo hace falta |
|---|---|---|
| **Node ≥ 22.14** | Todo | Siempre |
| **`gh`** ([GitHub CLI](https://cli.github.com)) | Abrir PRs | Siempre |
| **Docker** ([Desktop](https://docs.docker.com/desktop/)) | `supabase start` (base de datos local) | Al llegar a Supabase |
| **Android Studio / `adb`** | Probar la app móvil en un dispositivo real | Fase 1 |

---

## Cuentas cloud

De momento solo **Supabase**, con dos proyectos en la organización
`market-track`:

| Entorno | Proyecto | Región | Se despliega desde |
|---|---|---|---|
| Staging | `market-track-staging` | us-east-2 | `dev` |
| Producción | `market-track` | us-east-1 | `main` |

> La región de **producción** está razonada en `CLAUDE.md` (Virginia queda más
> cerca *en red* de Lima que São Paulo). Staging está en us-east-2 y da igual: no
> le sirve a ningún usuario, así que su latencia no mide nada.

PowerSync, Cloudflare R2 y Resend todavía no tienen cuenta. Cuando aparezcan,
cada app tendrá su `.env.example` y las claves **no** se versionan. Ver
`CLAUDE.md` → *Environment Variables*.

---

## Desplegar a la nube

**Nadie despliega a mano.** El esquema y las Edge Functions llegan por
`.github/workflows/deploy-supabase.yml` al hacer push a `dev` (staging) o `main`
(producción). Un `db push` desde un portátil deja la nube y el repositorio
contando historias distintas, y quien descubre la diferencia es el cliente.

Usar entornos de GitHub y no secretos del repositorio es lo que permite exigir
**aprobación manual antes de tocar producción** (Settings → Environments →
*required reviewers*). El workflow no puede imponerlo solo.

### Los secretos, y por qué están donde están

Viven en **dos sitios distintos**, y no es arbitrario:

**En GitHub** (Settings → Environments → `staging` / `produccion`) — los que
necesita el *pipeline* para hablar con Supabase:

| Secreto | Qué es | De dónde sale |
|---|---|---|
| `SUPABASE_ACCESS_TOKEN` | Token de tu cuenta para el CLI | [supabase.com/dashboard/account/tokens](https://supabase.com/dashboard/account/tokens) |
| `SUPABASE_DB_PASSWORD` | Contraseña de la base del proyecto | Al crear el proyecto (o Settings → Database → *Reset password*) |
| `SUPABASE_PROJECT_REF` | El `ref` del proyecto | Está en la URL del dashboard |

**En Supabase** (`supabase secrets set`) — los que necesitan las *Edge Functions*
en ejecución. El pipeline **no** los toca: se cargan una vez por entorno y se
quedan ahí.

```bash
supabase secrets set --project-ref <REF> \
  R2_ACCOUNT_ID=… R2_ACCESS_KEY_ID=… R2_SECRET_ACCESS_KEY=… R2_BUCKET=… \
  RESEND_API_KEY=… \
  ALERTA_WEBHOOK_SECRET=… PASE_HASH_SECRET=… FOTO_VERIFICACION_SECRET=…
```

> `SUPABASE_SERVICE_ROLE_KEY` **no se carga a mano**: Supabase ya lo inyecta en
> las Edge Functions. Ponerlo otra vez sería una copia más que mantener.

**En la base** (`alter database … set`) — las GUCs `app.settings.*` que leen los
triggers y jobs de pg_cron para llamar a las Edge Functions con `pg_net`. **No
son secretos de función ni migraciones**: viven en la configuración del
`postgres` de cada proyecto, y sin ellas los webhooks son un **no-op silencioso**
(en local, a propósito: no hay Resend ni R2 que consultar). Una sesión de pg_cron
solo ve GUCs puestas a nivel de base o de rol.

```sql
alter database postgres set app.settings.functions_url = 'https://<REF>.supabase.co/functions/v1';
alter database postgres set app.settings.alerta_webhook_secret = '<el mismo ALERTA_WEBHOOK_SECRET>';
alter database postgres set app.settings.foto_verificacion_secret = '<el mismo FOTO_VERIFICACION_SECRET>';
```

Comprobar qué hay puesto: `select setconfig from pg_db_role_setting;`. Las
sesiones nuevas las ven al reconectar. Quién las usa: `app.notificar_alerta_email`
(email de alertas) y `app.barrer_fotos_sin_verificar` (sello de autenticidad de
las fotos, cada 5 min). Para este último, además, verificar tras el despliegue
que `pg_cron` quedó habilitada (`select * from cron.job`) y hacer un barrido de
humo a mano:

```bash
curl -X POST https://<REF>.supabase.co/functions/v1/fotos-verificar \
  -H 'x-webhook-secret: <FOTO_VERIFICACION_SECRET>' -H 'Content-Type: application/json' \
  -d '{"modo":"barrer","limite":5}'      # esperar selladas > 0
```

### Poner en marcha un entorno por primera vez

Carga los secretos de las dos tablas de arriba y haz push a la rama del entorno.
El workflow hace el resto. Después, el paso que no se puede automatizar:

### ⚠️ Apagar *Allow public access* en Realtime

**En cada proyecto, la primera vez.** Dashboard → Realtime → Settings.

Los feeds en vivo del supervisor y del portal usan **canales privados** cuya
autorización son las políticas RLS sobre `realtime.messages`. Con el acceso
público encendido Realtime **no las evalúa**, y cualquiera con una sesión puede
suscribirse a los canales de cualquier cliente — el aislamiento multi-tenant, que
es la promesa contractual del producto, se cae en ese canal.

Es configuración de proyecto, no migración: no hay forma de ponerlo en el
repositorio, y por eso vive aquí y no en un archivo que alguien pueda revisar.

### El seed nunca toca la nube

`db push` no lo ejecuta, pero `db reset --linked` sí — y `seed.sql` crea un admin
con la contraseña `password123`. El archivo **aborta** si no está en el Supabase
local; si alguien lo intenta, el mensaje de error explica el resto.

### Comprobar que un despliegue quedó bien

```bash
supabase migration list --project-ref <REF>   # local y remoto deben coincidir
supabase functions list --project-ref <REF>   # las de supabase/functions/
```

---

## El flujo de ramas

- **`main`** = producción. Solo recibe PRs **desde `dev`**.
- **`dev`** = integración. Recibe los PRs de las ramas de trabajo.
- **Cero commits directos** a ninguna de las dos.

> ⚠️ **GitHub no puede hacer cumplir esto**: la protección de ramas exige GitHub
> Pro en repositorios privados, y este lo es. El hook `pre-push` es un
> **guardarraíl, no un candado** — `--no-verify` lo salta. La regla se sostiene
> sobre disciplina, no sobre el servidor.

---

## Comprobar que todo quedó bien

```bash
pnpm turbo run lint typecheck   # ambos en verde
pnpm format:check               # sin cambios pendientes
git config --get core.hooksPath # -> .githooks
```

Y el contexto del proyecto está en **`CLAUDE.md`** (stack, convenciones,
trampas conocidas) y en **`docs/`** (arquitectura, modelo de datos, alcance).
Empieza por `docs/Market Track.md`.
