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
  ALERTA_WEBHOOK_SECRET=… PASE_HASH_SECRET=… FOTO_VERIFICACION_SECRET=… \
  SEND_SMS_HOOK_SECRET='v1,whsec_<base64 de ≥32 bytes>'
```

**Ocho de ellos son obligatorios porque su función es *fail-closed*:** sin el
secreto lanza al cargar el módulo y no atiende ni una petición. Es la postura
correcta para un endpoint cuya única puerta es ese secreto — pero enterarse por
casualidad no lo es, así que **el despliegue lo comprueba** (`scripts/verificar-
secretos-funciones.mjs`) y se pone rojo nombrando el que falte. `RESEND_API_KEY`
y `RESEND_FROM` no entran en esa lista: sin ellas el envío degrada a *dry-run*,
no revienta.

> `SEND_SMS_HOOK_SECRET` tiene dos trampas. **El formato lo valida el CLI**
> (`v1,whsec_<base64>`), no solo la función: uno mal formado hace que `supabase
> start` muera al leer `config.toml`, en local y en CI. Y su valor tiene que ser
> **el mismo** que el proyecto tenga en Authentication → Hooks; cargarlo sin
> activar el hook allí deja el 2FA igual de roto.

> `SUPABASE_SERVICE_ROLE_KEY` **no se carga a mano**: Supabase ya lo inyecta en
> las Edge Functions. Ponerlo otra vez sería una copia más que mantener.

### ⚠️ Los hooks de auth se activan a mano, en cada proyecto

`config.toml` **solo manda en local**. En la nube, los dos hooks que este
producto usa se activan en Dashboard → Authentication → Hooks:

| Hook | Apunta a | Sin él |
|---|---|---|
| **Send SMS** | `https://<REF>.supabase.co/functions/v1/enviar-otp`, con `SEND_SMS_HOOK_SECRET` | No se entrega ningún OTP: **nadie completa el 2FA**, y como el gate `aal2` vive en la RLS, una sesión que no llega a aal2 no ve ni una fila |
| **Custom Access Token** | La función de Postgres `public.custom_access_token_hook` | El pase de acceso temporal no eleva la sesión a `aal2` (ADR-0008) |

Misma familia que apagar *Allow public access* en Realtime: es configuración de
proyecto, no viaja en migraciones, y no hay forma de ponerla en el repositorio.

### La configuración que vive en el vault

**En la base** (`vault.create_secret`) — los valores que leen los triggers y los
jobs de pg_cron para llamar a las Edge Functions con `pg_net`. **No son secretos
de función ni migraciones**: se cargan una vez por proyecto y sin ellos los
webhooks son un **no-op silencioso** (en local, a propósito: no hay Resend ni R2
que consultar).

```sql
select vault.create_secret('https://<REF>.supabase.co/functions/v1', 'functions_url',              'base de las Edge Functions de este proyecto');
select vault.create_secret('<el mismo ALERTA_WEBHOOK_SECRET>',        'alerta_webhook_secret',      'compartido con enviar-alerta-email');
select vault.create_secret('<el mismo FOTO_VERIFICACION_SECRET>',     'foto_verificacion_secret',   'compartido con fotos-verificar');
```

Para cambiar uno ya cargado, `create_secret` **falla** (el nombre es único):
`select vault.update_secret(id, '<valor nuevo>') from vault.secrets where name = 'functions_url';`

> **Por qué el vault y no `alter database … set app.settings.*`**, que es lo que
> decía este runbook hasta el 18 ago 2026 — y que **nunca se pudo ejecutar**:
> desde Postgres 15, fijar un parámetro *placeholder* a nivel de base o de rol
> exige **superusuario**, y en Supabase gestionado `postgres` no lo es
> (`rolsuper = false`). El intento muere con `42501: permission denied to set
> parameter`. Tampoco hay salida por `grant set on parameter` ni por la API de
> configuración del proyecto, que responde `400: Unrecognized key`. La que sí
> está puesta, `app.settings.jwt_exp`, la pone `supabase_admin`, que es de ellos.
>
> Lo que costó creerlo: staging pasó **desde que existe** sin enviar un solo
> correo de alerta y sin sellar una sola foto, las dos cosas en silencio.

Comprobar qué falta: `select app.config_faltante();` — devuelve solo **nombres**,
nunca valores, y es lo mismo que mira el despliegue. Quién los usa:
`app.notificar_alerta_email` (email de alertas) y `app.barrer_fotos_sin_verificar`
(sello de autenticidad de las fotos, cada 5 min). Para este último, además,
verificar tras el despliegue que `pg_cron` quedó habilitada
(`select * from cron.job`) y hacer un barrido de humo a mano:

```bash
curl -X POST https://<REF>.supabase.co/functions/v1/fotos-verificar \
  -H 'x-webhook-secret: <FOTO_VERIFICACION_SECRET>' -H 'Content-Type: application/json' \
  -d '{"modo":"barrer","limite":5}'      # esperar selladas > 0
```

**El despliegue lo comprueba solo.** El último paso de
`.github/workflows/deploy-supabase.yml` consulta `app.config_faltante()` y pone
el job **rojo** con el comando que falta por ejecutar. La primera vez que se
despliega un entorno nuevo sale rojo, y así debe ser: es esta lista de deberes,
no un fallo del pipeline. También caza la `functions_url` copiada de otro
entorno — mandar los webhooks de producción a las funciones de staging responde
`200` y no lo delata nada más.

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

### Migraciones que llegan fuera de orden

`supabase migration new` numera con la hora **de tu reloj al crearla**, no con la
de mergear. Con varias ramas abiertas a la vez, dos cosas pasan solas:

- **dos ramas eligen el mismo timestamp** (pasó el 17 ago 2026), o
- **una rama abierta el lunes se mergea el viernes**, detrás de otra numerada el
  miércoles.

La segunda es la cara: `supabase db push` **se planta** ante una migración local
que ordena antes de la última aplicada en la nube y **deja de aplicar todas las
siguientes**. El despliegue se pone rojo, pero como nada más falla, el rojo se
puede quedar semanas sin mirar — así estuvo staging seis migraciones por detrás
desde el 14 ago 2026, tres de ellas de seguridad.

**El CI de cada PR lo caza antes de mergear** (`node scripts/verificar-migraciones.mjs`).
Si se pone rojo, el arreglo es renumerar tu archivo por encima de la última de
`dev` — mientras la migración siga en tu rama es gratis:

```bash
git mv supabase/migrations/2026MMDDHHMMSS_lo_tuyo.sql \
       supabase/migrations/<mayor-que-la-última-de-dev>_lo_tuyo.sql
pnpm exec supabase db reset            # comprobar que sigue aplicando limpio
```

Lo mismo a mano, cuando quieras comprobarlo antes de abrir el PR:

```bash
git fetch origin dev
node scripts/verificar-migraciones.mjs origin/dev
```

**Nunca renumeres una migración ya mergeada**: puede estar aplicada en un entorno,
y ahí el número es historia vivida, no un nombre. Para ese caso el despliegue usa
`db push --include-all`, que la aplica fuera de orden. Es seguro **salvo** que la
rezagada toque los mismos objetos que una posterior ya aplicada — entonces la
revertiría. Antes de desatascar un despliegue así, comparar qué toca cada una.

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
