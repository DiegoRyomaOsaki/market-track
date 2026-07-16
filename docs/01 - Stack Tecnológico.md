---
tags: [stack, arquitectura, decisiones, mobile, offline-first]
created: 2026-06-18
proyecto: market-track
---

# 01 — Stack Tecnológico

Volver a [[Market Track]]

## Resumen ejecutivo

Stack **TypeScript end-to-end** para que un solo desarrollador + Claude Code mantenga todo con el mínimo cambio de contexto:

- **App móvil:** React Native + Expo, **offline-first** con PowerSync.
- **Backend / BD / API:** Supabase (Postgres + PostGIS + Auth + Storage + Realtime + Edge Functions). La "base de datos sólida" pedida = **PostgreSQL**.
- **Panel de gestión + Portal cliente:** Next.js 15 (una sola app web, vistas por rol).
- **Fotos:** Cloudflare R2 (almacenamiento barato a volumen).
- Todo en infra managed/serverless para minimizar operaciones.

> Principio rector: **no inventar** lo que ya existe probado. El sync offline y el auth multi-tenant son las partes donde más se pierde tiempo y dinero; por eso se delegan a herramientas maduras (PowerSync, Supabase RLS).

---

## 1. App móvil del mercaderista

Es el componente más exigente: **offline real**, cámara con marca de agua, GPS/geofencing en segundo plano, en equipos Android de gama media.

### Comparativa

| | React Native + Expo | Flutter | PWA | Nativo (Kotlin) |
|---|---|---|---|---|
| Lenguaje | **TypeScript** (= backend) | Dart | TS/JS | Kotlin |
| Comparte tipos con backend | ✅ | ❌ | ✅ | ❌ |
| Offline-first maduro | ✅ (PowerSync, WatermelonDB) | ✅ (Drift, Isar) | ⚠️ frágil | ✅ |
| Cámara + watermark en vivo | ✅ | ✅ | ⚠️ limitado iOS | ✅ |
| Geofencing en background | ✅ (expo-location + task-manager) | ✅ | ❌ poco fiable | ✅ |
| Velocidad de desarrollo (solo dev) | **Alta** | Media | Alta | Baja |
| Curva con Claude Code | Baja (gran corpus TS/RN) | Media | Baja | Media |
| Build/distribución | EAS Build (OTA updates) | Codemagic | — | Manual |

### Decisión: **React Native + Expo**

1. **TypeScript compartido** con backend y web → un solo lenguaje en todo el stack, ideal para solo dev + Claude Code.
2. **Expo + EAS**: builds en la nube, **OTA updates** (parchar la app sin pasar por la tienda — clave durante un piloto que cambia rápido).
3. Ecosistema offline maduro y librerías listas para cámara, GPS y tareas en segundo plano.
4. **PWA descartada**: el offline-first con cámara fiable, watermark anti-trampa y geofencing en background es frágil en navegador (sobre todo iOS). El documento hace del offline el diferenciador #1 → necesita control nativo.
5. **Android e iOS con el mismo código** (compromiso de la propuesta aceptada): EAS compila para iOS sin Mac. Requiere cuenta Apple Developer (~USD 99/año, idealmente a nombre del cliente).

### Distribución del piloto (sin depender de las tiendas)

- **Android:** APK por **enlace directo desde el panel de gestión** (el binario se hospeda y el panel expone el link).
- **iOS:** **TestFlight** (link de invitación; aprobación ligera; builds expiran a los 90 días — renovar durante el piloto). No existe sideload en iOS.
- La publicación en App Store / Google Play queda como paso posterior; la propuesta ya advierte que sus tiempos de aprobación no se garantizan.

> *Alternativa válida:* **Flutter** si se prioriza rendimiento puro en gama baja. Cuesta el cambio de lenguaje (Dart), que rompe la coherencia TS end-to-end. Para este caso, RN+Expo gana por productividad de un solo dev.

### Librerías móviles clave
- **expo-camera** — captura en vivo (galería bloqueada).
- **expo-location** + **expo-task-manager** — GPS y geofencing en segundo plano.
- **react-native-vision-camera** + skia/overlay — si se necesita watermark grabado a fuego en el pixel.
- **PowerSync SDK** — base local SQLite + sync con Postgres.
- **expo-image-manipulator** — comprimir/redimensionar fotos antes de subir (control de costos de storage).
- **expo-notifications** — push (tareas nuevas del supervisor).

---

## 2. Offline-first (el corazón del producto)

| Opción | Qué es | Pros | Contras |
|---|---|---|---|
| **PowerSync** ⭐ | Motor de sync Postgres ↔ SQLite con resolución de conflictos | Hecho para Supabase/Postgres; sync bidireccional robusto; reglas de sync por usuario | Servicio extra (free tier; ~USD 35/mes al crecer) |
| **WatermelonDB** | BD local reactiva con framework de sync | Open source, gratis, muy rápido | Tú implementas el endpoint de sync y la resolución de conflictos |
| **Cola propia (expo-sqlite + REST)** | Guardar local y reintentar POST | Control total, cero dependencias | Reinventas sync; **alto riesgo de bugs** (no recomendado) |

### Decisión: **PowerSync** (primera opción), WatermelonDB como plan B

El sync offline es donde un solo dev pierde semanas y dinero si lo hace a mano. PowerSync se integra nativamente con Supabase/Postgres, define **reglas de sync** (cada mercaderista solo baja sus tiendas/rutero del día) y resuelve el caso crítico: trabajar 8 horas sin señal y subir todo —fotos, marcas de tiempo, formularios— al recuperar conexión.

> Las **fotos** no van por el motor de sync de datos: se guardan en disco local y se suben aparte a R2 mediante una **cola de subida** con reintentos (la metadata —URL, hash, geo, hora— sí viaja por PowerSync).

---

## 3. Backend, base de datos y API

### Decisión: **Supabase**

Una sola plataforma cubre BD + API + Auth + Storage + Realtime + funciones:

- **PostgreSQL 16** — la "base de datos sólida" pedida. Relacional, transaccional, con **PostGIS** para geocercas (radio default **100 m**, editable por tienda).
- **PostgREST** — API REST autogenerada sobre las tablas (CRUD instantáneo).
- **Supabase Auth** — usuarios y sesiones; contraseña + **segundo factor**: correo por defecto (compromiso de la propuesta aceptada) y, desde la revisión de julio 2026, **SMS y WhatsApp** como canales habilitables desde el panel. El proveedor de SMS/WhatsApp está **por decidir** (el spike de segundo factor lo cierra) y cuesta por mensaje. **RLS (Row Level Security)** para el aislamiento multi-tenant (cada marca ve solo lo suyo; cada mercaderista, su rutero).
- **Edge Functions (Deno/TS)** — lógica de servidor: motor de alertas de precios, cruces de quiebres con órdenes de compra, semáforo PVPS, webhooks de email/WhatsApp.
- **Supabase Realtime** — el dashboard del cliente con **pines en vivo** (verde/rojo) y el seguimiento del supervisor.
- **pg_cron** — jobs programados (recalcular vencimientos, reportes diarios).

> Coherente con tu stack habitual ([[POS-System]], [[Mundial 2026]], Sandia) → curva de aprendizaje cero y reutilización de patrones.

### Almacenamiento de fotos: **Cloudflare R2** (no Supabase Storage)

A volumen, las fotos dominan el costo. Estimación piloto: 40 mercaderistas × 30 fotos/día × 22 días ≈ **26.400 fotos/mes**; a ~300 KB comprimidas ≈ **8 GB/mes** acumulativos.

| | Cloudflare R2 | Supabase Storage | Backblaze B2 |
|---|---|---|---|
| Precio storage | ~USD 0,015/GB | incluido hasta límite, luego más caro | ~USD 0,006/GB |
| Egreso (descarga) | **Gratis** | Pagado | Gratis vía Cloudflare |
| Integración | S3-compatible | Nativa Supabase | S3-compatible |

**R2** gana por **egreso gratis** (el portal del cliente muestra muchas fotos) y precio bajo. La metadata vive en Postgres; el binario en R2.

---

## 4. Panel de gestión + Portal del cliente

### Decisión: **Next.js 15 (App Router)** — una sola app, dos audiencias por rol

- **Supervisor/Admin** y **Cliente/Brand Manager** comparten base de código; las vistas y permisos se separan por rol (RLS + middleware).
- **Tailwind CSS + shadcn/ui** — UI rápida y accesible (tu patrón habitual).
- **TanStack Query** + **Supabase JS client** — fetching y realtime.
- **Mapas:** **MapLibre GL** (renderizador) + **tiles propios**: un extracto de Perú en PMTiles (Protomaps) servido desde **Cloudflare R2** — mapa del Perú con pines verdes/rojos en tiempo real. Ver [[adr/0009-tiles-autohospedados-en-r2]]. El móvil **no lleva mapa**: su geocerca es un cálculo de distancia.
- **Gráficos/KPIs:** **Tremor** o **Recharts** — dashboards de indicadores.
- **Exportación:** generación de **Excel/CSV** (SheetJS) y **PDF** (react-pdf) para los reportes del cliente.

> Para el MVP, **una sola web** con rutas `/admin`, `/supervisor` y `/cliente`. Separar en apps distintas es optimización prematura.

---

## 5. IA — Share of Shelf (pospuesto a fase pagada)

El documento pide un "agente de IA" que analice la foto de góndola y cuente facings (Maracumango vs competencia). Es la pieza **más cara e incierta**.

| Enfoque | Costo/complejidad | Recomendación |
|---|---|---|
| **Conteo manual** en la app (el mercaderista digita facings) | Mínimo | ✅ **MVP / piloto** |
| **LLM con visión** (Claude vision / GPT-4o) sobre la foto | Por imagen; prompt + validación | Fase 2 — rápido de prototipar para un solo dev |
| **Detección de objetos custom** (YOLO/Roboflow fine-tuned) | Alto (dataset etiquetado, MLOps) | Solo si el volumen justifica precisión |

**Decisión:** MVP con **conteo manual**; la IA de SOS entra como **Fase 2 pagada** usando **LLM con visión**. La propuesta aceptada compromete que la plataforma sea **agnóstica al modelo de IA** (ChatGPT, Claude o Google) — en Fase 2 se construye solo el puente de integración, con el proveedor como detalle intercambiable. Esto saca del presupuesto del piloto la parte más riesgosa.

---

## 6. Alertas y notificaciones

- **Email transaccional:** **Resend** + React Email (alertas de quiebre/precio/vencimiento al ejecutivo de cuentas). En MVP.
- **Push móvil:** Expo Notifications (tareas del supervisor).
- **WhatsApp Business API:** **fase posterior** (vía proveedor: 360dialog, Gupshup o Twilio). Requiere aprobación de Meta → iniciar trámite temprano si el cliente lo exige.

---

## 7. Infraestructura y DevOps

| Componente | Servicio |
|---|---|
| Backend/BD/Auth | **Supabase** (plan Pro) |
| Sync offline | **PowerSync** (cloud) |
| Web (gestión + portal) | **Vercel** |
| App móvil (build/OTA) | **Expo EAS** |
| Fotos | **Cloudflare R2** |
| Email | **Resend** |
| Errores | **Sentry** (free tier) |
| Repos / CI | **GitHub** + Actions; monorepo **Turborepo** (móvil + web + tipos compartidos) |
| Dominio/DNS | **Cloudflare** |

---

## 8. Costos de infraestructura (piloto, 20–50 mercaderistas)

| Servicio | USD/mes |
|---|---|
| Supabase Pro | 25 |
| PowerSync | 0–35 |
| Vercel | 0–20 |
| Cloudflare R2 (fotos) | 5–15 |
| Resend | 0–20 |
| Expo EAS | 0–19 |
| Sentry | 0 (free) |
| **Total** | **~35–135 USD/mes** |

> **Recomendación de negocio:** que el **cloud lo pague el cliente** (cuentas a su nombre o reembolso), para no erosionar tu margen en un proyecto de presupuesto ajustado. Detalle en [[06 - Análisis de Costos y Cobro]].

---

## Stack final (resumen)

```
Móvil      React Native + Expo + PowerSync (SQLite local)
Web        Next.js 15 + Tailwind + shadcn/ui + MapLibre + Tremor
API/BD     Supabase (Postgres 17 + PostGIS + PostgREST + Edge Functions)
Auth       Supabase Auth + RLS (multi-tenant)
Realtime   Supabase Realtime (pines en vivo)
Fotos      Cloudflare R2 (S3-compatible)
Alertas    Resend (email) · Expo Push · WhatsApp (fase 2)
IA SOS     Manual (MVP) → Claude vision (fase 2)
Infra      Vercel + EAS + GitHub Actions + Turborepo + Sentry
```

---

## Decisiones por validar

- ¿PowerSync (managed, paga al crecer) vs WatermelonDB (gratis, más trabajo)? → empezar con **PowerSync**, evaluar migración si el costo molesta.
- ~~¿MapLibre (gratis) vs Mapbox (managed, free tier)? → **MapLibre** para evitar costo por carga de mapa.~~ **Resuelto y corregido (jul 2026):** la pregunta estaba mal planteada — MapLibre es un renderizador, no un proveedor de mapas, y no evita ningún costo: lo mueve al proveedor de tiles. Decidido autohospedar los tiles (Protomaps/PMTiles en R2) en [[adr/0009-tiles-autohospedados-en-r2]].
- ¿WhatsApp en el piloto o solo email? → **solo email** salvo que el cliente lo exija por contrato.

Ver arquitectura en [[02 - Arquitectura Técnica]] y modelo de datos en [[03 - Modelo de Datos]].

---

⬅ [[00 - Análisis del Proyecto]] · Siguiente: [[02 - Arquitectura Técnica]]
