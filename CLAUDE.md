# Market Track

## Project Context

Plataforma de **retail execution / trade marketing** para una empresa de
outsourcing de mercaderistas en el retail peruano (Plaza Vea, Tottus, Metro,
Wong). Tres frentes sobre una misma API y base de datos: app móvil
**offline-first** para mercaderistas (check-in geocercado, fotos con watermark,
levantamiento de quiebres/precios/exhibiciones), panel de gestión para
supervisores/admins, y portal web para el cliente-marca (dashboard, mapa en
vivo, alertas). Multi-tenant por diseño. Meta: piloto operativo con 1 cliente
real (20–50 mercaderistas); la propuesta aceptada fija **septiembre 2026**.

**El alcance contractual es `docs/Propuesta Maracumango.pdf`** (aceptada el
23 jun 2026) — ante cualquier discrepancia con los demás docs, manda la
propuesta. La documentación completa vive en `docs/` — empezar por
`docs/Market Track.md` (índice), `docs/02 - Arquitectura Técnica.md`
(arquitectura y estructura del repo), `docs/03 - Modelo de Datos.md` (esquema)
y `docs/04 - Módulos y Funcionalidades.md` (alcance MVP: solo lo marcado ✅
entra al piloto).

## Workflows & Agents

- Orchestration principles: `default-workflows.md`
- Agent & skill index: `.claude/README.md`

## Coding Practices

- All code follows `.claude/rules/coding_practices.md` (includes TypeScript,
  Next.js, Expo/offline-first, and Supabase/RLS sections).

## Stack Summary

| Layer | Technology |
|---|---|
| Language | TypeScript (strict) end-to-end |
| Monorepo | Turborepo + pnpm workspaces |
| Mobile (`apps/mobile`) | React Native + Expo — **Android e iOS** (EAS Build, OTA updates; distribución piloto: APK por enlace directo + TestFlight) |
| Offline sync | PowerSync (Postgres ⇄ SQLite local) |
| Auth | Supabase Auth — contraseña + **2FA multicanal** (correo por defecto · SMS · WhatsApp, habilitables desde el panel) + **pase de acceso temporal** para el usuario que no recibe su OTP + RLS multi-tenant |
| Web (`apps/web`) | Next.js 15 App Router — `/admin`, `/supervisor`, `/cliente` |
| UI (web) | Tailwind CSS + shadcn/ui · MapLibre GL (mapas) · Tremor/Recharts (KPIs) |
| Backend/DB | Supabase — Postgres 16 + PostGIS, PostgREST, Auth + RLS, Realtime, Edge Functions (Deno), pg_cron |
| Validation | Zod (`packages/shared`) + tipos generados de Supabase (`packages/db`) |
| Server state (web) | TanStack Query + supabase-js |
| Photo storage | Cloudflare R2 (URLs firmadas, metadata en Postgres) |
| Email/alerts | Resend (+ Expo Push; WhatsApp en fase 2) |
| Tests | Vitest + Testing Library (web/packages) · Jest/jest-expo + RN Testing Library (mobile) |
| Lint/format | ESLint + Prettier |
| Infra | Vercel (web) · Expo EAS (mobile) · GitHub Actions (CI) · Sentry |

## Repo Structure

```
apps/mobile/          Expo (React Native) — app del mercaderista
apps/web/             Next.js 15 — admin/supervisor/cliente
packages/db/          schema SQL, tipos generados de Supabase
packages/shared/      tipos de dominio, schemas Zod, lógica compartida
packages/sync/        reglas y config de PowerSync
packages/ui/          componentes compartidos
supabase/migrations/  migraciones (único canal de cambios de schema)
supabase/functions/   Edge Functions (motor de alertas, webhooks, URLs firmadas)
docs/                 documentación de arquitectura y alcance
todos/                task tracker
```

## Dev Commands

> El esqueleto del monorepo (package.json raíz, pnpm-workspace.yaml,
> turbo.json) ya existe. **Todavía no hay ningún workspace**: las tareas de
> turbo corren en 0 paquetes y salen en verde. Las filas marcadas *(pendiente)*
> aún no son ejecutables — dependen de tickets que no han aterrizado.
>
> pnpm está fijado en `packageManager` (10.34.5) y pnpm lo autodescarga: no
> hace falta que tu pnpm global coincida.

| Task | Command | |
|---|---|---|
| Install | `pnpm install` | |
| Dev (todo) | `pnpm dev` | |
| Build | `pnpm build` | |
| Test | `pnpm test` | |
| Lint | `pnpm lint` | |
| Type check | `pnpm typecheck` | |
| Dev web | `pnpm --filter web dev` | *(pendiente: apps/web)* |
| Dev mobile | `pnpm --filter mobile start` | *(pendiente: apps/mobile)* |
| Format | `pnpm prettier --write .` | *(pendiente: tooling compartido)* |
| DB local | `supabase start` / `supabase db reset` | *(pendiente: Supabase)* |
| Nueva migración | `supabase migration new <nombre>` | *(pendiente: Supabase)* |
| Tipos DB | `supabase gen types typescript --local > packages/db/src/database.types.ts` | *(pendiente: packages/db)* |

## Git Workflow

Base branch: main

## Integrations

- **Linear: usar exclusivamente el servidor MCP `linear-mt`** — prefijo de
  herramientas `mcp__linear-mt__*`, autenticado como `diegopuerto0628@gmail.com`.
  Es el único que ve el workspace de este proyecto.
- Linear workspace: `market-track` (linear.app/market-track)
- Linear team key: `Market-Track`
- Ticket prefix: `MAR`
- ⚠️ La misma máquina tiene conectado el conector `mcp__claude_ai_Linear__`, que
  apunta a **otra cuenta** (`diego@scrybe.pro`, workspaces Scrybe/Sonar) y **no
  ve** Market-Track. Nunca usarlo para este proyecto: los tickets caerían en el
  workspace equivocado.
- Si `linear-mt` no aparece en `/mcp`, registrarlo con
  `claude mcp add --transport http linear-mt https://mcp.linear.app/mcp`,
  reiniciar la sesión y autenticar con la cuenta de arriba (cerrar sesión en
  linear.app antes, o usar incógnito, para que el OAuth no reuse la otra cuenta).

## Naming & File Organization

- Archivos kebab-case; componentes React en PascalCase.
- Tests co-locados: `*.test.ts` / `*.test.tsx` junto al código.
- Tipos de dominio y schemas Zod solo en `packages/shared`; tipos de BD solo
  generados en `packages/db`. Las apps importan, nunca redefinen.
- Nombres de dominio en español (visita, rutero, levantamiento, merma,
  quiebre, **diferencia**, **frente**) — coinciden con el modelo de datos y el
  vocabulario del cliente. Código de infraestructura/utilidades en inglés.
- **"Frente", nunca "cara" ni "facing"** — el cliente fijó el término en la
  revisión de julio 2026. Aplica a la UI, al esquema (`frentes_propios`,
  `frentes_competencia`) y a los tipos de dominio.

## Implementation Order

Sigue `docs/05 - Fases de Desarrollo.md` (⚠️ pendiente de re-basar: la
propuesta aceptada fija el piloto para **septiembre 2026**, docs/05 aún dice
noviembre):

1. **Fase 0** — scaffolding del monorepo (Turborepo + pnpm), proyecto Supabase,
   app Expo, app Next.js, CI. Wireframes.
2. **Fase 1** — modelo de datos + RLS multi-tenant, auth + 4 roles + **2FA por
   correo**, shell móvil, check-in geocercado (PostGIS), cámara + watermark,
   base offline (PowerSync).
3. **Fase 2** — pre-carga (precios/promos/exhibiciones), levantamiento SKU
   **con mecanismo de contingencia (bypass + alerta)**, motor de alertas de
   precio, check-out, hardening offline + cola de fotos R2.
4. **Fase 3** — panel supervisor (incl. alertas de contingencia en vivo),
   portal cliente, mapa realtime, galería.
5. **Fase 4** — alertas email (Resend), exportación (Excel/PDF), distribución
   (APK por enlace directo + TestFlight), pruebas en campo, bugs.
6. **Fase 5** — capacitación + go-live del piloto.

Regla de alcance: si un módulo no está marcado ✅ en
`docs/04 - Módulos y Funcionalidades.md`, no entra al piloto.

## Environment Variables

Aún no hay `.env`. Al scaffoldear, crear `.env.example` por app. Previstas:

| Variable | Scope | Nota |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` / `EXPO_PUBLIC_SUPABASE_URL` | cliente | pública |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` / `EXPO_PUBLIC_SUPABASE_ANON_KEY` | cliente | pública (RLS protege) |
| `SUPABASE_SERVICE_ROLE_KEY` | server only | **nunca** en cliente ni prefijos públicos |
| `POWERSYNC_URL` / token | cliente + server | según SDK |
| `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET` | server only | Edge Functions |
| `RESEND_API_KEY` | server only | Edge Functions |
| `SENTRY_DSN` | cliente | |

## Common Pitfalls

- **Nada de llamadas de red en flujos de campo del móvil** — todo pasa por la
  réplica SQLite de PowerSync; las fotos por la cola de disco a R2. El offline
  es el diferenciador #1 del producto.
- **Toda tabla nueva habilita RLS en su misma migración** con políticas por
  rol y `tenant_id` — una tabla sin RLS es legible por el mundo vía PostgREST.
- **En el móvil, RLS protege la escritura pero NO la lectura.** Las subidas van
  por el cliente de Supabase (PostgREST) y sí pasan por RLS. La bajada la
  replica PowerSync con un rol `BYPASSRLS`: lo que el mercaderista se descarga
  lo deciden **solo las *sync rules***. Es una segunda superficie de seguridad —
  y un harness que solo pruebe RLS da un **falso verde** para el móvil. Nunca
  filtrar por *client parameters* en una sync rule (el cliente puede enviar
  cualquier valor): solo por `request.user_id()` o por tabla. Ver
  `docs/adr/0001-motor-offline-dedicado.md`.
- **La validación de geocerca del cliente es UX, no seguridad** — se re-valida
  en servidor al sincronizar (PostGIS + timestamp de servidor).
- **Watermark y timestamps se graban al capturar**, nunca al subir — la subida
  puede ocurrir horas después.
- **El levantamiento secuencial no es un bloqueo absoluto** — existe el
  mecanismo de contingencia (bypass): registrar hallazgo + motivo, continuar,
  y disparar alerta `contingencia` al supervisor al sincronizar. Implementar
  el flujo sin el bypass incumple la propuesta aceptada.
- **Campos derivados** (quiebre, diferencia, semáforo, KPIs) se calculan en
  vistas/triggers/Edge Functions, una sola vez — no en el código de las apps.
- **El 2FA nunca se desactiva por usuario.** Al mercaderista que no recibe su
  OTP se le emite un **pase de acceso temporal** (un solo uso, 15 min, motivo
  obligatorio, auditado). Un interruptor de "sin 2FA para este usuario" se queda
  encendido para siempre y se vuelve una puerta abierta permanente.
- **La ayuda contextual (`?`) viaja con la app, no se descarga** — el
  mercaderista la consulta en un sótano sin señal. Contenido estático en
  `packages/shared`, no una tabla de BD.
