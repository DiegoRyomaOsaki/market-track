---
tags: [moc, proyecto, retail-execution, trade-marketing, mobile-app]
created: 2026-06-18
status: planning
proyecto: market-track
---

# 📍 Market Track — Map of Content

> **Tipo:** Plataforma de **ejecución en punto de venta (retail execution / trade marketing)** para una empresa de **outsourcing de mercaderistas**.
> **Mercado del cliente:** Perú (retail: Plaza Vea, Tottus, Metro, Wong…). Marco legal peruano (SUNAFIL, Ley de Tercerización N.º 29245, SCTR).
> **Desarrollo:** Diego en solitario + Claude Code (posible contratado puntual).
> **Meta:** Piloto operativo con **1 cliente real (20–50 mercaderistas)** para **noviembre 2026**.
> **Documento fuente del cliente:** [[APP de levantamiento]]

## Visión rápida

Una plataforma de tres frentes conectados por una API y una base de datos sólida:

1. **App móvil (mercaderistas)** — check-in geocercado, captura fotográfica con marca de agua (geo + hora), levantamiento de información (quiebres, precios, promociones, exhibiciones), **modo offline obligatorio** y sincronización diferida.
2. **Panel de gestión (supervisores)** — ruteros, asignación de tareas, aprobación de reportes, seguimiento en tiempo real, comunicación interna.
3. **Portal web (cliente / marca)** — dashboard en tiempo real con mapa de pines, KPIs de ejecución, fotos antes/después, alertas automáticas y exportación de reportes.

El diferenciador comercial frente a competidores (Repsly, Teamcore, Repsly) es el **offline real** (sótanos sin señal), el **blindaje legal SUNAFIL** y los **agentes de IA** para Share of Shelf.

---

## Índice de notas

### Análisis y estrategia
- [[00 - Análisis del Proyecto]]
- [[01 - Stack Tecnológico]]
- [[02 - Arquitectura Técnica]]
- [[09 - Diagramas de Arquitectura]] — diagramas Excalidraw (solución + técnica) para presentar

### Dominio y producto
- [[03 - Modelo de Datos]]
- [[04 - Módulos y Funcionalidades]]
- [[10 - Brief de Diseño UI]] — prompt para el prototipo interactivo en Claude Design (Fase 0)
- [[10a - Contexto de Diseño UI (completo)]] — contexto de dominio completo para las sesiones de prototipado

### Ejecución y negocio
- [[05 - Fases de Desarrollo]]
- [[06 - Análisis de Costos y Cobro]]
- [[08 - Propuesta Comercial]] — borrador para presentar al cliente
- **`Propuesta Maracumango.pdf`** — ⭐ **propuesta final aceptada (23 jun 2026)** — fuente contractual del alcance; ante cualquier discrepancia, manda este documento

### Referencia
- [[07 - Benchmark LiveTrade (Overall)]] — análisis del competidor/referente directo
- [[APP de levantamiento]] — documento base entregado por el cliente

---

## Decisiones clave (TL;DR)

| Área | Decisión |
|---|---|
| App móvil | **React Native + Expo** (TypeScript, EAS Build) |
| Offline-first | **PowerSync** (sync Postgres ↔ SQLite) o WatermelonDB |
| Backend / BD / API | **Supabase** (Postgres + PostGIS + Auth + Storage + Realtime + Edge Functions) |
| Panel gestión + Portal cliente | **Next.js 15** (App Router) — una app, vistas por rol |
| Mapas | **MapLibre / Mapbox** + Supabase Realtime (pines en vivo) |
| Almacenamiento de fotos | **Cloudflare R2** (más barato que Supabase Storage a volumen) |
| Geocercas | **PostGIS** (radio default **100 m**, editable por tienda; anti *fake GPS*) |
| IA Share of Shelf | **Pospuesto a Fase 2 pagada** (MVP con conteo manual) |
| Alertas | **Resend** (email) en MVP · WhatsApp Business API en fase posterior |
| Modelo de cobro | **Proyecto cerrado (one-time)** para el piloto + recurrente recomendado |

Detalle en [[01 - Stack Tecnológico]] y [[02 - Arquitectura Técnica]].

---

## Estado actual

- [x] Leer documento base del cliente
- [x] Definir actores, alcance y KPIs ([[00 - Análisis del Proyecto]])
- [x] Recomendar stack ([[01 - Stack Tecnológico]])
- [x] Esbozar arquitectura ([[02 - Arquitectura Técnica]])
- [x] Esbozar modelo de datos ([[03 - Modelo de Datos]])
- [x] Mapear módulos ([[04 - Módulos y Funcionalidades]])
- [x] Propuesta v1 de fases ([[05 - Fases de Desarrollo]])
- [x] Análisis de costos y cobro ([[06 - Análisis de Costos y Cobro]])
- [x] **Validar alcance del piloto con el cliente** — propuesta aceptada 23 jun 2026 (`Propuesta Maracumango.pdf`)
- [ ] Definir SKUs, cadenas y ruteros del cliente piloto (sesión de descubrimiento)
- [ ] Re-basar [[05 - Fases de Desarrollo]] a la meta de la propuesta (piloto listo septiembre 2026, no noviembre)

---

## ⚠️ Alerta de negocio

El presupuesto del cliente (**COP 17–22M ≈ USD 5.000–7.000**) está **muy por debajo** del valor de mercado de este producto completo. Es viable **solo** con un **piloto de alcance estrictamente recortado**, desarrollado por Diego + Claude Code, y conviene complementarlo con **mantenimiento mensual + fases pagadas**. Ver el detalle y la estrategia en [[06 - Análisis de Costos y Cobro]].

---

⬆ [[Projects|Volver a Projects]] · [[Vault|🏠 Índice maestro]]
