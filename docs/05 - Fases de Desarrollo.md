---
tags: [roadmap, fases, planning, gantt]
created: 2026-06-18
proyecto: market-track
status: propuesta-v1
---

# 05 — Fases de Desarrollo

Volver a [[Market Track]]

> [!warning] Las fechas de este documento son informativas y NO vinculantes
> El proyecto **se entrega cuando está terminado, no cuando toca**. El calendario, la ventana de semanas y la fecha de piloto que aparecen abajo son **información de guía para el developer** — no se usan para decidir el alcance, priorizar tickets, recortar calidad ni justificar una decisión técnica. La fecha puede variar mucho, y eso está previsto.
>
> Lo que sí es vinculante de este documento es el **orden de las fases**, porque es una cadena de dependencias técnicas reales: no hay check-in geocercado sin auth, ni auth sin RLS, ni RLS sin modelo de datos.
>
> El alcance lo fija [[04 - Módulos y Funcionalidades]] (solo lo ✅).

> **Propuesta v1 — para cerrar juntos.** Plan para llegar a un **piloto operativo con 1 cliente real (20–50 mercaderistas)**, desarrollado por Diego + Claude Code. Alcance = MVP de [[04 - Módulos y Funcionalidades]].

## Marco temporal

- **Hoy:** 18 de junio de 2026.
- **Arranque efectivo:** ~24 de junio de 2026.
- **Meta de piloto:** ~21 de noviembre de 2026.
- **Ventana:** ~22 semanas (~5 meses).
- **Productividad asumida:** 1 dev + Claude Code ≈ **2,5–3×** un dev solo (tu mismo supuesto en [[Sandia/Corporativo/Plan-Sandia/11-Plan-Solo-Developer]]).

---

## Roadmap (Gantt)

```mermaid
gantt
    title Market Track — Piloto Noviembre 2026
    dateFormat  YYYY-MM-DD
    axisFormat  %b

    section Fase 0 — Descubrimiento & Setup
    Levantamiento de requisitos con cliente   :f0a, 2026-06-24, 1w
    Definir SKUs/cadenas/tiendas/ruteros       :f0b, after f0a, 1w
    Setup monorepo + Supabase + Expo + CI      :f0c, 2026-06-24, 2w
    Wireframes/UI base (móvil + web)           :f0d, after f0a, 1w

    section Fase 1 — Fundaciones
    Modelo de datos + RLS multi-tenant         :f1a, 2026-07-08, 2w
    Auth + roles (4 perfiles)                  :f1b, after f1a, 1w
    App shell móvil + navegación               :f1c, 2026-07-08, 1w
    Check-in geocercado (PostGIS)              :f1d, after f1c, 1w
    Cámara + watermark en vivo                 :f1e, after f1d, 1w
    Base offline (PowerSync)                   :f1f, after f1b, 1w

    section Fase 2 — Levantamiento & Offline
    Pre-carga (precios, promos, exhibiciones)  :f2a, 2026-08-05, 1w
    Levantamiento SKU (quiebres, SOS manual)   :f2b, after f2a, 2w
    Motor de alertas de precio/promo           :f2c, after f2b, 1w
    Check-out + validaciones                   :f2d, after f2b, 1w
    Hardening offline + cola de fotos (R2)      :f2e, after f2c, 1w

    section Fase 3 — Gestión & Portal
    Panel supervisor (ruteros, aprobaciones)   :f3a, 2026-09-09, 2w
    Portal cliente (dashboard + KPIs)          :f3b, 2026-09-09, 2w
    Mapa en tiempo real (pines verde/rojo)     :f3c, after f3b, 1w
    Galería fotos antes/después                :f3d, after f3a, 1w

    section Fase 4 — Alertas, Export & QA
    Alertas por email (Resend)                 :f4a, 2026-10-14, 1w
    Exportación de reportes (Excel/PDF)        :f4b, after f4a, 1w
    Pruebas en campo (dispositivos reales)     :f4c, after f4a, 2w
    Corrección de bugs + OTA updates           :f4d, after f4b, 1w

    section Fase 5 — Piloto
    Capacitación supervisores/mercaderistas    :f5a, 2026-11-11, 1w
    Go-live piloto + soporte cercano           :f5b, after f5a, 1w
    Estabilización + ajustes                   :milestone, 2026-11-21, 0d
```

---

## Resumen de fases

| Fase | Foco | Duración | Periodo | Entregable |
|---|---|---|---|---|
| **0** | Descubrimiento + setup técnico | 2 sem | 24 jun – 7 jul | Repos, infra, datos del cliente, wireframes |
| **1** | Fundaciones (datos, auth, check-in, offline base) | 4 sem | 8 jul – 4 ago | Mercaderista puede hacer check-in geocercado offline |
| **2** | Levantamiento + offline robusto + check-out | 5 sem | 5 ago – 8 sep | Levantamiento completo funcionando offline |
| **3** | Panel gestión + portal cliente + dashboard | 4 sem | 9 sep – 13 oct | Supervisor y cliente ven datos y mapa en vivo |
| **4** | Alertas, export, pruebas en campo, bugs | 4 sem | 14 oct – 10 nov | Alertas email + reportes + app probada en campo |
| **5** | Capacitación + go-live piloto | 2 sem | 11 nov – 21 nov | **Piloto operando con cliente real** |
| | | **~21 sem** | | |

> Hay ~1 semana de **colchón** antes del 30 de noviembre para imprevistos. Realista pero **sin margen para crecer el alcance** — de ahí la importancia del corte MVP de [[04 - Módulos y Funcionalidades]].

---

## Hitos de control (checkpoints con el cliente)

```mermaid
graph LR
    H0[✔ Fin Fase 0<br/>7 jul<br/>Alcance + datos firmados] --> H1[✔ Fin Fase 1<br/>4 ago<br/>Check-in offline demo]
    H1 --> H2[✔ Fin Fase 2<br/>8 sep<br/>Levantamiento demo]
    H2 --> H3[✔ Fin Fase 3<br/>13 oct<br/>Dashboard cliente demo]
    H3 --> H4[✔ Fin Fase 4<br/>10 nov<br/>App probada en campo]
    H4 --> GO[🚀 Piloto<br/>21 nov]
```

Cada checkpoint = **demo + visto bueno del cliente**. Sirve para controlar cambios de alcance (todo lo nuevo se cotiza aparte) y para cobrar por hitos si se acuerda pago fraccionado.

---

## Estrategia de ejecución (solo dev + Claude Code)

1. **Sprints de 2 semanas** alineados a las fases.
2. **MVP estricto**: si algo no está en [[04 - Módulos y Funcionalidades]] como ✅, no entra al piloto.
3. **Claude Code para lo repetitivo**: CRUD, migraciones, tipos, formularios del levantamiento, tests, componentes de dashboard.
4. **Tú decides** lo crítico: arquitectura offline, geocercas, UX del mercaderista en campo, resolución de conflictos.
5. **Pruebas en campo temprano** (Fase 4 dedicada): el offline solo se valida en un sótano real, no en el emulador.
6. **OTA updates (Expo EAS)** para parchar la app durante el piloto sin pasar por la tienda.
7. **No perfeccionar, iterar**: versión funcional por sprint.

### ¿Dónde podría entrar un contratado?
Solo si el plazo aprieta y el presupuesto lo permite (ver [[06 - Análisis de Costos y Cobro]]): tareas **acotadas y paralelizables** —diseño UI del portal, maquetación de dashboards, QA de la Fase 4— **no** el núcleo offline (ese lo controlas tú). Con el presupuesto actual, lo más probable es **recortar alcance antes que contratar**.

---

## Riesgos del cronograma

| Riesgo | Mitigación |
|---|---|
| Offline-first toma más de lo previsto | Es la Fase 1–2; si se atrasa, se recorta levantamiento, no el offline |
| Datos del cliente (SKUs, ruteros) llegan tarde | Bloquear Fase 0 hasta tenerlos; es prerrequisito |
| Dedicación part-time (otras empresas) | Proteger bloques de tiempo; el Gantt asume ~25–30 h/sem efectivas |
| Cambios de alcance del cliente | Checkpoints + control de cambios por escrito |
| Pruebas en campo revelan problemas graves | Fase 4 con 2 semanas dedicadas + colchón de noviembre |

---

## Pendiente de cerrar contigo

- [ ] ¿Dedicación real semanal al proyecto? (ajusta el Gantt)
- [ ] ¿Mermas / PVPS entran al piloto o van a Fase 2? (hoy: Fase 2)
- [ ] ¿WhatsApp lo exige el cliente piloto? (hoy: solo email)
- [ ] ¿Pago por hitos o 50/50? (ver [[06 - Análisis de Costos y Cobro]])

---

⬅ [[04 - Módulos y Funcionalidades]] · Siguiente: [[06 - Análisis de Costos y Cobro]]
