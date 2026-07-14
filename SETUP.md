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

### 2. Desactivar el conector de Linear equivocado

```
/mcp  →  claude.ai Linear  →  disable
```

Ese conector apunta a **otra cuenta** (`diego@scrybe.pro`, workspaces
Scrybe/Sonar) y **no ve Market-Track**. Si se queda activo, un ticket puede
acabar creado en el workspace equivocado. Está en `~/.claude.json`, que es
configuración **de tu máquina**: no viaja con el repositorio, así que **hay que
desactivarlo en cada equipo**.

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

**Todavía no existe ninguna.** No hay `.env` que copiar ni secretos que pasarse
por un canal seguro — el proyecto está en Fase 0.

Cuando aparezcan (Supabase, PowerSync, Cloudflare R2, Resend), cada app tendrá
su `.env.example` y las claves **no** se versionan. Ver `CLAUDE.md` →
*Environment Variables*.

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
