---
tags: [diagramas, arquitectura, excalidraw, presentacion]
created: 2026-06-22
proyecto: market-track
---

# 09 — Diagramas de Arquitectura

Volver a [[Market Track]] · Base: [[00 - Análisis del Proyecto]] · [[01 - Stack Tecnológico]] · [[02 - Arquitectura Técnica]] · [[04 - Módulos y Funcionalidades]]

> Diagramas en **Excalidraw** (estilo hand-drawn) pensados para **presentar en reuniones**: uno de negocio para cualquier audiencia y uno técnico para el equipo. Son archivos `.excalidraw` **dentro del vault** → ábrelos con un clic, edítalos en Obsidian y expórtalos a PNG/SVG para slides.

---

## 1. Arquitectura de la Solución (negocio)

![[09a — Arquitectura de la Solución.excalidraw]]

🖊️ Editar: [[09a — Arquitectura de la Solución.excalidraw]]

Cuenta el **flujo de valor** sin tecnicismos:

- El **Mercaderista** (app móvil, 100% offline) captura datos y fotos en tienda.
- La **Plataforma Market Track** los procesa: captura estructurada, motor de alertas, dashboard en vivo y aislamiento multi-tenant.
- El **Brand Manager** (la marca cliente) consume KPIs, mapa de pines y alertas en tiempo real.
- **Administrador** y **Supervisor** alimentan la plataforma (catálogos, ruteros, tareas).
- Cierra con el diferenciador #1: **offline real — cero datos en sótanos sin señal**.

Úsalo para abrir una reunión comercial o de kickoff.

---

## 2. Arquitectura Técnica (equipo / dev)

![[09b — Arquitectura Técnica.excalidraw]]

🖊️ Editar: [[09b — Arquitectura Técnica.excalidraw]]

El stack en **3 capas**:

- **Clientes** — App móvil (React Native + Expo, SQLite local) · Panel de Gestión y Portal Cliente (Next.js 15).
- **Backend Supabase** — PostgreSQL + PostGIS, PostgREST API, Realtime (pines en vivo), Auth + RLS (multi-tenant), pg_cron, Edge Functions (alertas, cruces, IA).
- **Servicios externos** — Cloudflare R2 (fotos), Resend (email); en **punteado, la Fase 2**: WhatsApp API y Claude Vision (Share of Shelf).

**PowerSync** conecta la app offline con Postgres; las fotos suben **directo a R2**. Resumen del pie: monorepo Turborepo, TypeScript end-to-end, infra serverless/managed, multi-tenant por RLS.

---

## Cómo presentarlos

1. Haz clic en el diagrama (o en el enlace **Editar**) → se abre en el editor Excalidraw de Obsidian.
2. Selecciona todo (`Ctrl/Cmd + A`) → clic derecho → **Copy to clipboard as PNG/SVG**, o usa el menú **⋮ → Export image** (PNG o SVG, fondo blanco o transparente).
3. Pega la imagen en PowerPoint / Google Slides / Keynote.

> Los diagramas viven **en el vault** (`.excalidraw`), no dependen de ningún enlace externo: se versionan con git y se editan offline. Si necesitas una versión congelada, exporta a imagen.

---

⬅ [[02 - Arquitectura Técnica]] · Siguiente: [[03 - Modelo de Datos]]
