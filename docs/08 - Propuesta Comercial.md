---
tags: [propuesta, comercial, alcance, precio, cliente]
created: 2026-06-18
proyecto: market-track
status: borrador-v1
---

# 08 — Propuesta Comercial

Volver a [[Market Track]] · Base: [[APP de levantamiento]] · Soporte: [[04 - Módulos y Funcionalidades]], [[05 - Fases de Desarrollo]], [[06 - Análisis de Costos y Cobro]]

> [!warning] Documento comercial. Sus fechas y cifras NO guían el desarrollo
> **Ojo con la versión.** Este es un **borrador interno**; el documento contractual real es **`Propuesta Maracumango.pdf`** (aceptada el 23 jun 2026) y es el que manda ante cualquier discrepancia.
>
> Las fechas y las cifras que aparezcan aquí son **información de guía para el developer**: no deciden alcance, prioridad de tickets ni decisiones técnicas. El proyecto se entrega cuando está terminado.

> **Borrador para presentar al cliente.** El alcance está ceñido al documento de levantamiento. Completa los campos marcados con `[…]` antes de enviar. Las cifras son la recomendación de [[06 - Análisis de Costos y Cobro]] (ajustables). La sección final **"Notas internas"** NO se envía al cliente.

---
---

# Propuesta de Desarrollo
## Plataforma **Market Track** — Ejecución en Punto de Venta

**Preparado para:** `[Nombre de la empresa de outsourcing — Cliente]`
**Preparado por:** `[Tu nombre / empresa]`
**Fecha:** 18 de junio de 2026
**Validez de la propuesta:** 30 días

---

## 1. Resumen ejecutivo

Proponemos el desarrollo de **Market Track**, una plataforma propia de **ejecución en punto de venta (retail execution)** para profesionalizar y digitalizar la operación de mercaderismo. La solución integra tres componentes conectados —una **app móvil** para los mercaderistas, un **panel de gestión** para supervisores y un **portal web** para los clientes-marca— sobre una **base de datos sólida** y un **servicio de API**, con **modo offline** para operar sin señal en sótanos y trastiendas.

La solución completa se entrega **por fases**. La **Fase 1 (piloto operativo)** estará lista para **noviembre de 2026**, permitiendo operar con un cliente real (20–50 mercaderistas) y demostrar la plataforma en licitaciones.

---

## 2. Entendimiento del proyecto

`[Cliente]` es una empresa de outsourcing de mercaderismo que coloca personal en cadenas de retail para representar marcas de consumo masivo. Hoy enfrenta tres necesidades:

1. **Controlar al personal en campo** — saber quién visitó cada tienda, a qué hora, con evidencia.
2. **Capturar datos de valor** para las marcas — quiebres, participación de góndola, precios, exhibiciones.
3. **Blindarse legalmente** — cumplir la normativa laboral peruana (SUNAFIL, jornada, autonomía de mando).

Market Track responde a las tres, con la captura estructurada y las alertas automáticas que pide el documento de levantamiento.

---

## 3. Objetivos

- Digitalizar el flujo del mercaderista de extremo a extremo: **check-in → levantamiento → check-out**.
- Dar a las marcas-cliente **visibilidad en tiempo real** de la ejecución en sus puntos de venta.
- Generar **KPIs de ejecución** automáticos: cumplimiento de rutero, quiebres, Share of Shelf, exhibiciones y precios.
- Operar de forma confiable **sin conexión** y sincronizar al recuperar señal.

---

## 4. La solución

Market Track se compone de tres aplicaciones sobre una misma base de datos y API:

```
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│  📱 App Móvil    │     │ 🖥️ Panel Gestión │     │ 🖥️ Portal Cliente│
│  Mercaderista    │     │   Supervisor     │     │  Marca / Cliente │
│  (offline)       │     │                  │     │                  │
└────────┬────────┘     └────────┬─────────┘     └────────┬────────┘
         │                       │                        │
         └───────────────┬───────┴────────────────────────┘
                         │  🔌 API  +  🗄️ Base de datos
                         │  ☁️ Nube + sincronización offline
```

- **App móvil (mercaderista):** marca asistencia, levanta información y sube evidencia fotográfica; funciona sin señal.
- **Panel de gestión (supervisor):** diseña ruteros, asigna tareas, aprueba reportes y da seguimiento en tiempo real.
- **Portal web (cliente-marca):** consulta dashboards, mapa en vivo, fotos, alertas y reportes.

---

## 5. Alcance funcional

> Todo el alcance proviene del documento de levantamiento entregado por `[Cliente]`. Se organiza en fases para garantizar una entrega operativa en noviembre.

### 🟢 Fase 1 — Piloto operativo (entrega noviembre 2026)

**App móvil — Mercaderista**
- **Check-in con geocerca:** bloqueo si está a más de 50 m de la tienda asignada (anti-falsificación de GPS).
- **Selfie de ingreso con marca de agua** (hora y coordenadas); solo cámara en vivo, galería bloqueada.
- **Marcación de jornada** con hora de servidor.
- **Levantamiento secuencial** (sin saltarse pasos):
  - Foto "Antes" de la góndola.
  - **Share of Shelf** — registro de caras (facings) propias vs. competencia *(captura manual en esta fase)*.
  - **Quiebres / OSA** — checklist de SKUs codificados por tienda; unidades en sistema vs. piso; alerta de quiebre.
  - **Precios y promociones** — digitación del precio del cliente; precios regulares y promociones **pre-cargados**; motor de alertas de desviación (regular/promoción, comunicada o no, con tolerancia configurable por marca).
  - **Exhibiciones negociadas y material POP** — verificación de armado, unidades y foto de evidencia.
  - Foto "Después".
- **Check-out:** validación de tareas pendientes (no permite salir con reportes incompletos), bitácora de comentarios y marcación de salida con GPS.
- **Modo offline:** opera sin señal y sincroniza datos y fotos automáticamente al recuperar conexión.

**Panel de gestión — Supervisor**
- Pre-carga de clientes-marca, cadenas, tiendas, SKUs, precios y promociones.
- Diseño y asignación de **ruteros** a mercaderistas.
- Asignación de tareas y **seguimiento en tiempo real**.
- Aprobación/rechazo de reportes de visita.
- **Autonomía de mando:** las órdenes al mercaderista salen únicamente del supervisor (candado SUNAFIL por diseño).

**Portal web — Cliente / Marca**
- **Dashboard en tiempo real** con **mapa de pines** (verde: reposición hecha / rojo: quiebre crítico).
- **KPIs de ejecución:** cumplimiento de rutero, quiebres, Share of Shelf, exhibiciones, precios.
- Galería de **fotos antes/después** por tienda.
- **Alertas automáticas por correo** ante quiebre o desviación de precio.
- **Exportación de reportes** (Excel / PDF).

### 🔵 Fase 2 — Inteligencia de campo (evolución posterior)

- **Share of Shelf con IA:** un agente analiza la foto de la góndola y cuenta automáticamente las caras propias y de la competencia.
- **Cruce de quiebres** con órdenes de compra en tránsito y SKUs descontinuados.
- **Exhibiciones adicionales** con control de vigencia por fotografía.
- **Módulo de Mermas:** tipificación (manipulación / transporte / vencimiento), evidencia fotográfica (código de barras + daño) y cargo digital al encargado del retail.
- **Alertas de vencimiento (PVPS):** registro de lote y fecha de vencimiento con semáforo verde / ámbar / rojo.

### 🟣 Fase 3 — Cumplimiento y comunicación (evolución posterior)

- **Control de jornada SUNAFIL:** corte automático a 8 h / 48 h y aprobación obligatoria de horas extra; registro de herramientas, SCTR y fotocheck.
- **Comunicación interna:** comunicados al equipo, confirmación de lectura y material de capacitación móvil.
- **Alertas por WhatsApp** (además del correo).
- **Reconocimiento facial / biométrico** en el check-in.
- **KPIs avanzados** por supervisor y por mercaderista.

---

## 6. Cronograma (Fase 1)

| Etapa | Periodo |
|---|---|
| Descubrimiento y configuración (datos del cliente, ruteros, SKUs) | Jun – Jul 2026 |
| Fundaciones (base de datos, check-in, captura offline) | Jul – Ago 2026 |
| Levantamiento, precios, exhibiciones y sincronización | Ago – Sep 2026 |
| Panel de gestión y portal del cliente | Sep – Oct 2026 |
| Alertas, reportes, pruebas en campo y ajustes | Oct – Nov 2026 |
| **Capacitación y puesta en marcha del piloto** | **Noviembre 2026** |

Cada etapa cierra con una **demostración** y aprobación de `[Cliente]`.

---

## 7. Lo que NO incluye (exclusiones)

Para mantener el alcance y los tiempos, esta propuesta **no contempla** (pueden cotizarse por separado en el futuro):

- Integración con el **ERP/SAP** del cliente o de las marcas.
- Reportes de **Sell Out / ventas** del retailer y módulos de **cuotas, proyección o MSL**.
- **Market Share / Retail Mapping** y clustering de tiendas con datos de paneles de mercado.
- **Web scraping** de precios de tiendas online (ecommerce).
- Migración de datos históricos de otros sistemas.
- Hardware (equipos móviles, lectores) y planes de datos del personal.

---

## 8. Tecnología

Plataforma moderna, en la nube y de bajo costo operativo:
- **App móvil** multiplataforma con **almacenamiento local** para operar sin señal.
- **Base de datos relacional robusta** y **API** segura en la nube.
- **Aislamiento de datos por cliente-marca** (cada marca ve solo lo suyo).
- **Actualizaciones remotas** de la app sin reinstalar.

La infraestructura es escalable y se dimensiona según el número de mercaderistas y tiendas.

---

## 9. Inversión

> Cifras en pesos colombianos (COP). Referencia en USD a TC ~3.150.

| Fase | Alcance | Inversión (COP) | Ref. (USD) |
|---|---|---|---|
| **Fase 1 — Piloto operativo** | App móvil + panel + portal (sección 5) | **$ 22.000.000** | ~$ 7.000 |
| Fase 2 — Inteligencia de campo | IA Share of Shelf, mermas, PVPS, cruces | $ 20.000.000 | ~$ 6.300 |
| Fase 3 — Cumplimiento y comunicación | Jornada SUNAFIL, comunicados, WhatsApp, biometría | $ 18.000.000 | ~$ 5.700 |
| **Solución completa** | Fases 1 + 2 + 3 | **$ 60.000.000** | ~$ 19.000 |

**Servicios recurrentes (desde la puesta en marcha):**

| Concepto | COP / mes | Ref. USD |
|---|---|---|
| **Mantenimiento y soporte** (correcciones, mejoras menores, actualizaciones, soporte al usuario) | $ 800.000 | ~$ 250 |
| **Infraestructura en la nube** (hosting, base de datos, almacenamiento de fotos) | A cargo del cliente, estimado $ 250.000 – $ 450.000 | ~$ 80 – 140 |

> La inversión inicial recomendada para arrancar es la **Fase 1: $ 22.000.000**, que entrega una plataforma **operativa** en noviembre. Las Fases 2 y 3 se contratan cuando `[Cliente]` decida ampliar la solución.

---

## 10. Forma de pago (Fase 1)

| Hito | % | Monto (COP) |
|---|---|---|
| A la firma (inicio) | 40% | $ 8.800.000 |
| Avance — fin de levantamiento (demo) | 30% | $ 6.600.000 |
| Entrega y puesta en marcha del piloto | 30% | $ 6.600.000 |

---

## 11. Condiciones y supuestos

- El alcance corresponde a lo descrito en la sección 5; cambios o adiciones se cotizan por separado (control de cambios por escrito).
- `[Cliente]` provee a tiempo la información de configuración: cadenas, tiendas, SKUs codificados por tienda, precios regulares, promociones y exhibiciones negociadas.
- La infraestructura en la nube se contrata a nombre de `[Cliente]` (o se factura como reembolso).
- Los equipos móviles y planes de datos del personal son provistos por `[Cliente]`.
- El piloto se ejecuta con **un (1) cliente-marca** y hasta **50 mercaderistas**.

---

## 12. Garantía y soporte

- **Garantía de corrección de errores:** 30 días posteriores a la puesta en marcha, sin costo.
- **Soporte y evolución continua:** mediante el plan de **mantenimiento mensual** (sección 9).
- **Capacitación** a supervisores y mercaderistas incluida en la Fase 1.

---

## 13. Siguientes pasos

1. Aprobación de esta propuesta y firma del acuerdo de Fase 1.
2. Pago del anticipo (40%) para iniciar.
3. Sesión de descubrimiento para cargar los datos del cliente piloto.

`[Tu nombre]` · `[correo]` · `[teléfono]`

---
---

## 🔒 Notas internas (NO enviar al cliente)

- **Precio Fase 1 = COP 22M (tope del rango del cliente):** justificado en [[06 - Análisis de Costos y Cobro]]. No bajar del tope; el valor de mercado del producto es mucho mayor.
- **Cobrar por valor, no por hora:** tu tarifa efectiva en Fase 1 ronda USD 14–20/h. Lo que hace rentable la cuenta es el **recurrente + Fases 2/3**, no la Fase 1 aislada.
- **No contratar full-time** para la Fase 1 (se come el margen). Recorta alcance antes que contratar; apoyo puntual máx. USD 500–1.000.
- **Hosting a cuenta del cliente:** mantenlo fuera de tu fee. No absorbas el cloud.
- **Blindaje de alcance:** la sección 7 (exclusiones) es tu protección frente a la comparación con la suite completa de LiveTrade ([[07 - Benchmark LiveTrade (Overall)]]). Si el cliente pide algo de ahí, es Fase futura y cotización aparte.
- **SOS con IA** está en el documento del cliente, por eso se incluye en el alcance total (Fase 2), no se omite — pero se saca de la Fase 1 por costo/riesgo.
- **Pendiente de completar:** nombres (cliente y proveedor), datos de contacto, y validar si el cliente piensa en COP o en soles (si es soles, convertir: COP 22M ≈ S/ 20.500 a TC ref.).
- **Ajustes posibles** si el cliente presiona el precio: ofrecer Fase 1 con SOS manual y sin export PDF (solo Excel), o pago 50/50, antes que bajar de COP 20M.

---

⬅ [[07 - Benchmark LiveTrade (Overall)]] · Volver a [[Market Track]]
