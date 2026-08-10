# Market Track

## Project Context

Plataforma de **retail execution / trade marketing** para una empresa de
outsourcing de mercaderistas en el retail peruano (Plaza Vea, Tottus, Metro,
Wong). Tres frentes sobre una misma API y base de datos: app móvil
**offline-first** para mercaderistas (check-in geocercado, fotos con watermark,
levantamiento de quiebres/precios/exhibiciones), panel de gestión para
supervisores/admins, y portal web para el cliente-marca (dashboard, mapa en
vivo, alertas). Multi-tenant por diseño. Meta: piloto operativo con 1 cliente
real (20–50 mercaderistas).

**El alcance contractual es `docs/Propuesta Maracumango.pdf`** (aceptada el
23 jun 2026) — ante cualquier discrepancia con los demás docs, manda la
propuesta. La documentación completa vive en `docs/` — empezar por
`docs/Market Track.md` (índice), `docs/02 - Arquitectura Técnica.md`
(arquitectura y estructura del repo), `docs/03 - Modelo de Datos.md` (esquema)
y `docs/04 - Módulos y Funcionalidades.md` (alcance MVP: solo lo marcado ✅
entra al piloto).

### Las fechas y el dinero NO guían el desarrollo

**El proyecto se entrega cuando está terminado, no cuando toca.** El calendario
(`docs/05`) y las cifras (`docs/06`, `docs/08`) son **información de guía para el
developer** — nada más. No se usan para decidir el alcance, priorizar tickets,
recortar calidad ni justificar una decisión técnica. La fecha puede variar mucho
y eso está previsto.

Lo que sí manda: **el alcance** (`docs/04`, solo lo ✅) y **el orden de
dependencias técnicas** (abajo). Si un razonamiento empieza por "no da tiempo" o
"para ese presupuesto", es el razonamiento el que está mal.

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
| Backend/DB | Supabase — **Postgres 17** + PostGIS, PostgREST, Auth + RLS, Realtime, Edge Functions (Deno), pg_cron |
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

> Workspaces vivos: `apps/web`, `apps/mobile`, `packages/db` y
> `packages/shared`. Las tareas de turbo corren en la raíz y en cada uno.
>
> pnpm está fijado en `packageManager` (10.34.5) y pnpm lo autodescarga: no
> hace falta que tu pnpm global coincida.
>
> **Ojo con `lint` y `typecheck`:** los scripts de la raíz (`pnpm lint`,
> `pnpm typecheck`) revisan **solo la raíz** — turbo los invoca como tareas
> `//#lint` y `//#typecheck`. Para revisar **todo el monorepo** usa las tareas
> de turbo. No pueden llamarse igual: un script raíz `lint: turbo run lint`
> haría que turbo se invocase a sí mismo (error de recursión).

| Task | Command | |
|---|---|---|
| **Equipo nuevo** | `pnpm bootstrap` | instala, activa los hooks y audita las herramientas. Ver `SETUP.md` |
| Install | `pnpm install` | activa los hooks de paso (script `prepare`) |
| Dev (todo) | `pnpm dev` | |
| Build | `pnpm build` | |
| Test | `pnpm test` | Vitest (web y packages) · Jest/jest-expo (móvil). Tests co-locados: `*.test.ts` junto al código. **No necesita Docker** |
| **Aislamiento (RLS)** | `pnpm turbo run test:db` | `packages/db/test/` — **exige `supabase start`** |
| **Lint (todo)** | `pnpm turbo run lint` | raíz + workspaces |
| **Type check (todo)** | `pnpm turbo run typecheck` | raíz + workspaces |
| Lint (solo raíz) | `pnpm lint` | `eslint .` |
| Type check (solo raíz) | `pnpm typecheck` | `tsc --noEmit` |
| Format | `pnpm format` | escribe; `pnpm format:check` solo verifica |
| Dev web | `pnpm --filter web dev` | |
| Dev mobile | `pnpm --filter mobile start` | Metro + QR. Para probar en un teléfono hace falta un build de EAS (`development` o `preview`), no Expo Go: la app usa módulos nativos |
| **Mapa base (dev)** | `pnpm --filter web tiles:dev` | baja el extracto de Lima (9,4 MiB) a `public/tiles/`. Ver ADR-0009 |
| DB local | `supabase start` / `supabase db reset` | |
| Nueva migración | `supabase migration new <nombre>` | |
| Tipos DB | `pnpm db:types` | regenera tras cada migración |

**Prettier no toca el Markdown** (`.prettierignore`): los docs son la fuente de
verdad contractual del proyecto, los leen humanos y no se compilan. Prettier
manda en el código; la documentación se escribe a mano.

**TypeScript está fijado en `~6.0.3`, no en la última.** TypeScript 7 (el port
nativo en Go) **hace crashear a `typescript-eslint`**, cuyo peer declarado es
`<6.1.0`. No es un aviso: es un `TypeError` y exit 2. Es una restricción
temporal — se revisa cuando typescript-eslint publique soporte para TS 7.

## Git Workflow

**Base branch: `dev`.** Todo PR de trabajo apunta a `dev`, nunca a `main`.

- **`main` = producción.** Solo recibe PRs **desde `dev`**. Nada más.
- **`dev` = integración.** Recibe PRs desde las ramas de trabajo.
- **Nada de commits directos a `dev` ni a `main`** — todo pasa por PR.
- Rama de trabajo: la que sugiere Linear (`diegopuerto0628/mar-N-...`), creada
  **desde `dev`**. Se borra al mergear.

> ⚠️ **Esta regla no la hace cumplir GitHub.** La protección de ramas y los
> rulesets exigen **GitHub Pro** cuando el repositorio es privado, y este lo es
> (verificado: la API responde 403 *"Upgrade to GitHub Pro or make this
> repository public"*). Lo único que hay es el hook `.githooks/pre-push`, que
> rechaza el push directo a `main` y `dev` — un guardarraíl, no un candado:
> `--no-verify` lo salta y solo protege a quien lo tenga activado.
>
> **Activarlo en cada clon:** `git config core.hooksPath .githooks`
>
> Lo mismo vale para CI: `.github/workflows/ci.yml` corre en cada PR y **se pone
> roja**, pero GitHub **no impide mergear** con los checks en rojo — los *required
> checks* son parte del mismo muro de pago. El rojo es una señal, no un candado:
> hay que mirarlo antes de mergear.

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

- **Supabase: usar exclusivamente el servidor MCP `supabase-mt`** — prefijo
  `mcp__supabase-mt__*`. Organización **`market-track`**, proyecto
  **`market-track`** (`us-east-1`).
- ⚠️ Misma historia que con Linear: el conector `mcp__claude_ai_Supabase__` de
  esta máquina apunta a **otra cuenta** (org `Gobigagency`, proyecto "Gobig Back
  office") y **no** es este proyecto. Está desactivado en este repo; no
  reactivarlo.
- **Región `us-east-1`, no São Paulo.** AWS no tiene región en la costa oeste de
  Sudamérica y el tráfico internacional de Perú enruta por Miami: Virginia queda
  más cerca *en red* que São Paulo, aunque el mapa diga lo contrario. Sin medir
  desde Lima — si alguna vez se mide, esto se revisa.

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

El orden de abajo es una **cadena de dependencias técnicas**, no un calendario:
no hay check-in geocercado sin auth, ni auth sin RLS, ni RLS sin modelo de
datos. Por eso manda. Las fechas de `docs/05` no — ver arriba.

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
- **El GRANT es la puerta; la RLS es el portero.** Una tabla nueva **no le da ni
  `SELECT` a `authenticated`**: sin el `grant`, la consulta muere con
  `42501 permission denied` **antes** de que ninguna política se evalúe — y el
  error parece de RLS sin serlo. Toda tabla nueva necesita **las dos cosas**.
  Y el grant tiene que cubrir **cada verbo que la política permite**: una política
  `for all` con un grant de `select, insert, update` muere en el `delete`.
- **Una consulta de UNA fila bajo una política de lectura permisiva devuelve
  muchas.** `select(...).maybeSingle()` sin `.eq('id', …)` sobre una tabla que el
  staff lee entera trae todas las filas, falla por multiplicidad y deja al gate
  concluyendo lo contrario de lo que debía. Toda consulta que resuelve *quién
  llama* filtra por el id del que llama.
- **En una política RLS, las funciones van SIEMPRE envueltas en `(select ...)`.**
  Sin el `select`, Postgres las evalúa **una vez por fila**; con él, una vez por
  consulta. Medido sobre 200.000 filas: **42.480 ms contra 12,9 ms**. En una
  tabla de 3 filas da igual; en `visita` es un dashboard o un timeout.
- **Nunca `col::date between $1 and $2` sobre una columna `timestamptz`
  indexada.** El cast por fila anula el índice `(tenant_id, fecha)` y fuerza un
  rescan; un rango medio-abierto sobre la columna cruda (`col >= $1 and col <
  ($2 + 1)`) es sargable y sí usa el índice. Gemela de la pitfall de `(select
  ...)` de arriba: ambas son "un dashboard o un timeout".
- **Nunca `jsonb_agg(x order by x->>'campo')`.** Ordenar por el jsonb recién
  construido obliga a Postgres a re-evaluar el `jsonb_build_object` entero
  —subconsultas incluidas— solo para sacar la clave de orden; se ordena por la
  columna cruda. Medido: duplica el subplan **por nivel**, y estos árboles se
  anidan tres.
- **En un upsert, `coalesce(valor, DEFAULT)` en el SELECT no protege lo que ya
  había.** `excluded` llega con el default y el `do update` lo escribe encima del
  valor real; para conservarlo, el `coalesce` se resuelve contra la fila existente
  con un `left join` a la propia tabla. Medido: un reimport con la celda vacía
  devolvía el radio de geocerca de una tienda a su default, y los mercaderistas de
  esa tienda dejaban de poder fichar.
- **Si un rol no puede ver una fila, lo dice la POLÍTICA, no la consulta que la
  agrupa.** Excluir un tipo de fila en la vista o la RPC solo la esconde de esa
  pantalla: sigue siendo legible por PostgREST, y toda Edge Function que actúe
  de proxy (firmar una URL, reenviar un blob) tiene como techo lo que la RLS
  permite, no lo que la consulta enseñaba. Medido: el cliente-marca leía la
  selfie del mercaderista pese a que la galería la excluía.
- **La regla de acceso tiene un solo dueño: `app.perfil_efectivo()`.** No copiar
  el rol ni el `tenant_id` a los claims del JWT: un claim es una copia rancia y
  el mercaderista de un cliente que canceló seguiría dentro hasta que expire el
  token. La función lo recalcula en cada consulta — la revocación es inmediata.
- **`tenant` es el CLIENTE, no la marca.** Un cliente tiene varias marcas (Oster,
  Sharpie…) y el `sku` cuelga de la **marca**. El mercaderista es **exclusivo de
  un cliente** (`profile.tenant_id` único) y audita todas las marcas de ese
  cliente que se vendan en la tienda: **una visita = un `levantamiento` por
  marca**, porque cada marca está en un pasillo distinto y tiene su propia
  góndola, su foto "Antes", su Share of Shelf y su foto "Después".
- **Si un cliente cancela, sus mercaderistas pierden el acceso.** El acceso es
  **derivado**: `profile.activo AND (tenant_id IS NULL OR tenant.activo)`. Nunca
  apagar `profile.activo` con un trigger al dar de baja al cliente — se perdería
  el estado individual y, al reactivarlo, volverían todos, incluido el
  desvinculado. Y la revocación **tiene que llegar al teléfono**: las *sync
  rules* deben exigir el acceso efectivo, o la réplica local seguirá
  descargándose datos de un excliente.
- **En el móvil, RLS protege la escritura pero NO la lectura.** Las subidas van
  por el cliente de Supabase (PostgREST) y sí pasan por RLS. La bajada la
  replica PowerSync con un rol `BYPASSRLS`: lo que el mercaderista se descarga
  lo deciden **solo las reglas de sincronización**. Es una segunda superficie de
  seguridad — y un harness que solo pruebe RLS da un **falso verde** para el
  móvil. Nunca filtrar por parámetros que controle el cliente (puede enviar
  cualquier valor): solo por `auth.user_id()` o por tabla. El formato vigente es
  **Sync Streams (edition 3)**; las *sync rules* con `bucket_definitions` y
  `request.user_id()` son legacy — verificado a la fuerza en el prototipo. Ver
  `docs/adr/0001-motor-offline-dedicado.md`.
- **El gate `aal2` NO cubre la bajada del móvil.** Vive en
  `app.perfil_efectivo()`, o sea en la RLS, y la RLS no interviene en lo que
  PowerSync descarga. **Medido**: un mercaderista con sesión `aal1` (sin segundo
  factor) recibe sus datos igual. Si se quiere que el 2FA cubra el teléfono, la
  regla de sincronización tiene que exigir el claim `aal` explícitamente.
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
- **El "hoy" del negocio es el día de calendario en Lima (UTC-5), no en UTC.**
  `new Date().toISOString().slice(0,10)` da la fecha UTC: entre las 19:00 y
  medianoche de Lima ya rodó al día siguiente. Toda ventana de fechas
  (dashboards, reportes, KPIs) resuelve el día con `America/Lima`.
- **Nunca poner `passWithNoTests: true` en Vitest.** El default (`false`) es lo
  único que impide que la suite vuelva a ser un verde falso: si alguien borra el
  último test, Vitest sale con exit 1 en vez de fingir que todo está bien.
- **Un `vitest.config.ts` en un workspace rompe `pnpm lint`** (`not found by the
  project service`) salvo que se añada `"*.ts"` al `include` de su
  `tsconfig.json` — ESLint y `tsc` tienen que ver los mismos archivos. Hoy
  `packages/db` no necesita config: los defaults de Vitest ya bastan. El primer
  workspace que necesite una (apps/web, con jsdom) debe tocar las dos cosas en el
  mismo commit.
- **Una Server Action importada desde un componente cliente arrastra su grafo
  entero al empaquetado.** Next genera una entrada de acción con todas sus
  dependencias transitivas, y un `require` perezoso que en Node no se evalúa
  nunca —el `@aws-sdk/client-s3` de `unzipper`, vía `read-excel-file`— hace
  fallar a webpack igualmente. Se marca la librería en `serverExternalPackages`,
  no se instala el paquete fantasma. `tsc` y los tests pasan en verde: esto solo
  lo ve `next build`, y **el CI no lo corre**.
- **Una columna de tipo array NO tiene clave foránea.** Las FK compuestas
  `(x_id, tenant_id)` protegen las columnas escalares; `exhibicion_negociada.
  sku_ids` (`uuid[]`) y `promocion.clusters` (`text[]`) no las protege nadie.
  Lo que se guarde en un array lo valida la acción contra el `tenant_id`, o no
  lo valida nadie.
- **Los tipos de BD se regeneran con `pnpm db:types`, nunca con una redirección.**
  Si Docker está apagado, `supabase gen types` **escribe su error en stdout**: un
  `> database.types.ts` machacaría la fuente de verdad con un blob JSON. El script
  valida la salida antes de escribir. Y `packages/db/src/database.types.ts` está
  en `.prettierignore` **a propósito**: si Prettier lo reformatea, deja de
  coincidir con la salida del generador y el check de CI se pone rojo para siempre.
- **Al cambiar de rama que añade o quita rutas, `.next/types` queda rancio** y
  `tsc` falla en rutas que no tocaste (`Cannot find module '.../page.js'`).
  Limpiar con `git clean -fdx apps/web/.next` (o `next build`) antes del typecheck.
- **El 2FA nunca se desactiva por usuario.** Al mercaderista que no recibe su
  OTP se le emite un **pase de acceso temporal** (un solo uso, 15 min, motivo
  obligatorio, auditado). Un interruptor de "sin 2FA para este usuario" se queda
  encendido para siempre y se vuelve una puerta abierta permanente.
- **La ayuda contextual (`?`) viaja con la app, no se descarga** — el
  mercaderista la consulta en un sótano sin señal. Contenido estático en
  `packages/shared`, no una tabla de BD.
