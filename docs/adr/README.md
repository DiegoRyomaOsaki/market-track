---
tags: [adr, decisiones, arquitectura]
created: 2026-07-13
proyecto: market-track
---

# Registro de decisiones de arquitectura (ADR)

Volver a [[Market Track]] · Arquitectura: [[02 - Arquitectura Técnica]]

> Un **ADR** (Architecture Decision Record) es el acta de *una* decisión: qué se
> decidió, qué alternativas se descartaron, por qué, y qué consecuencias trae.
> Existe para responder la pregunta que aparece seis meses después —
> *"¿por qué está hecho así?"* — sin depender de la memoria de nadie ni de un
> comentario perdido en un ticket.

## Reglas del registro

**Un archivo, una decisión.** Nunca se agrupan varias en un mismo ADR: si un día
hay que reemplazar una, debe poder reemplazarse sola.

**Los ADR no se editan, se reemplazan.** Un ADR aceptado es un hecho histórico.
Si la decisión cambia, se escribe uno nuevo que declara `Reemplaza a: ADR-XXXX`,
y el viejo pasa a estado `reemplazado` con un enlace al que lo sustituye. Así el
registro conserva *por qué se pensó lo que se pensó entonces*, que es
exactamente lo que se pierde al editar en sitio.

**Numeración correlativa**, sin huecos y sin reservas: el siguiente ADR toma el
número libre más bajo. No se pre-asignan números a decisiones que aún no se han
tomado — un spike puede cancelarse y dejaría un hueco.

**Nombre de archivo:** `NNNN-titulo-en-kebab-case.md`.

### Estados

| Estado | Significado |
|---|---|
| `propuesto` | La dirección elegida, aún sin validar. Un spike (o una prueba) debe confirmarla o tumbarla. |
| `aceptado` | Decisión firme. El código puede apoyarse en ella. |
| `reemplazado` | Sustituida por un ADR posterior, que se enlaza. |

Distinguir `propuesto` de `aceptado` no es burocracia: escribir "aceptado" sobre
algo que todavía puede caerse es documentar el plan como si fuera un hecho, y
alguien construirá encima creyendo que está cerrado.

## Cuándo escribir uno

- **Todo spike cierra con un ADR.** Es su entregable, no un extra.
- Cualquier decisión que sea cara de revertir: elección de proveedor, modelo de
  datos estructural, límite entre servicios, mecanismo de autenticación.
- No hace falta ADR para lo reversible en una tarde (nombre de una variable,
  orden de una lista, estilo de un componente).

## Índice

| # | Decisión | Estado | Fecha |
|---|---|---|---|
| [0001](0001-motor-offline-dedicado.md) | Offline-first con un motor de sincronización dedicado | **propuesto** | 2026-06-18 |
| [0002](0002-multi-tenant-por-rls.md) | Multi-tenant por RLS, no por base de datos separada | aceptado | 2026-06-18 |
| [0003](0003-fotos-en-r2-metadata-en-postgres.md) | Fotos en Cloudflare R2, metadata en Postgres | aceptado | 2026-06-18 |
| [0004](0004-una-web-por-rol.md) | Una sola app web para los tres roles | aceptado | 2026-06-18 |
| [0005](0005-ia-de-share-of-shelf-fuera-del-mvp.md) | La IA de Share of Shelf queda fuera del MVP | aceptado | 2026-06-18 |
| [0006](0006-watermark-en-captura.md) | Watermark grabado en la captura, no en la subida | aceptado | 2026-06-18 |
| [0007](0007-catalogos-y-tolerancias-precargados.md) | Catálogos y tolerancias pre-cargados por marca | aceptado | 2026-06-18 |
| [0008](0008-segundo-factor-multicanal-sobre-mfa-nativo.md) | Segundo factor multicanal sobre el MFA nativo de Supabase | aceptado | 2026-07-14 |
| [0009](0009-tiles-autohospedados-en-r2.md) | Los tiles de los mapas se autohospedan en R2 con Protomaps (PMTiles) | aceptado | 2026-07-16 |

Plantilla: [`0000-plantilla.md`](0000-plantilla.md). Siguiente número libre: **0010**.

Los ADR 0001–0007 portan al registro las decisiones que ya estaban tomadas y
resumidas en la tabla "Decisiones de arquitectura" de
[[02 - Arquitectura Técnica]] (A1–A7). El registro es desde ahora la fuente de
verdad; esa tabla queda como índice y enlaza aquí.
