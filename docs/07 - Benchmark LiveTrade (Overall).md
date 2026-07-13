---
tags: [benchmark, competencia, livetrade, overall, referencia, powerbi, screenshots]
created: 2026-06-18
updated: 2026-06-18
proyecto: market-track
---

# 07 — Benchmark: LiveTrade (Overall)

Volver a [[Market Track]] · Relacionado: [[03 - Modelo de Datos]], [[04 - Módulos y Funcionalidades]], [[06 - Análisis de Costos y Cobro]]

> **Referente directo del producto a construir.** Análisis basado en **17 capturas reales** de la plataforma (en `screenshots/`, vista del **cliente-marca** Newell Brands Perú / Oster). LiveTrade es la herramienta de **Corporativo Overall**, líder del mercado peruano de trade marketing.

## Qué es (confirmado con capturas)

LiveTrade **no es solo una app de captura**: es una **suite de Business Intelligence de trade marketing**. Combina:
- Una **app web propia** (shell, login SSO, Tracking GPS, Photogram, gestión).
- **Power BI embebido** para todos los "Reportes BI" (confirmado: cada reporte tiene branding del cliente, slicers y estética Power BI).

El usuario observado es **"NEWELL - CLIENTE GERENCIA"** → estamos viendo el **portal del cliente-marca**, no la app del mercaderista. Versión web **1.4.9**; app móvil **3.0.45** (+50.000 instalaciones).

---

## Estructura de navegación (portal cliente)

```
Sidebar
├─ Inicio
└─ Reportes Online
   ├─ Tracking        → mapa GPS + tabla de visitas (datos de campo)
   ├─ Reportes BI     → dashboards Power BI (inteligencia comercial)
   └─ Photogram       → galería de fotos agrupadas por PDV
```

- **Selector de Cliente** (multi-tenant): ej. "NEWELL BRANDS DE PERU S.A.C".
- **Campañas**: cada cliente agrupa sus reportes en campañas. Ej. Newell tiene *KPI COMERCIAL* y *KPI TRADE*.
- Barra superior con iconos: galería, búsqueda, BI, exportar (nube), notificaciones, tareas (portapapeles), refrescar/sync, tablas.
- Idioma ES/EN · Cerrar sesión · alertas (campana).

---

## Catálogo de Reportes BI (campaña "KPI Comercial")

| Reporte | Qué muestra |
|---|---|
| **Actividades de la Competencia** | Actividades propias vs. competencia en PDV |
| **Informe Sell Out – Newell** | Ventas (sell-out) por cadena, producto, semana |
| **Reporte de Precios** | Precios en tienda y desviaciones |
| **Retail Mapping – Newell** | Market share, clustering de tiendas, distribución |
| **Warboard Newell** | Tablero de guerra (resumen ejecutivo) |
| **Reporte Web Scrapping** | Precios scrapeados de ecommerce de retailers |

---

## Detalle por módulo (KPIs, filtros, columnas)

### 1. Informe de Actividades (propias y competencia)
- **KPI:** N.° Actividades (ej. 1.516 Newell / 71 competencia).
- **Gráficos:** evolutivo por categoría, participación por cadena, participación por categoría (dona), tipo de actividad (activación, demostración, dinámica), detalle fotográfico.
- **Tabla detalle:** Línea · Fecha · Marca · Cadena · Provincia · Categoría · Tipo de actividad.
- **Filtros:** Año · Mes · Familia · Tipo de actividad · Provincia · Cadena · Marca.
- **Tabs:** Newell | Competencia.

### 2. Informe Sell Out (ventas)
- **KPIs:** Venta Soles · Venta unidades · Venta TTD (acumulado).
- **Gráficos:** venta por fecha, avance de venta (tendencia).
- **Tablas:** Ranking de venta por cadena (Venta, Soles, Unidades, **CAR%** crecimiento, Devoluciones, **MIX**), ranking de producto.
- **Tabs (¡14!):** Sell Out · **MSL** (Must Stock List) · Promoción · **Quiebres** · Lanzamiento · Evolutivo · Proyección · Personalizado · Seguimiento · Diario · Cuota · Status de Información · Tabla Descarga · Agente de Social.

### 3. Retail Mapping / Market Share
- **Gráficos:** participación período, participación por mes, **Share of Market** por categoría / retail / marca, ranking por ciudad, ranking de tiendas, ranking de modelos, **evolutivo de share** por marca (Blackline, Imaco, Miray, Ninja, Oster, Recco, Taurus, Thomas).
- **Clustering Retail (PDV y Malls):** scatter con **Cluster A/B/C/D**; KPIs Venta prom. tienda, Venta categorías principales, **SOM %**.
- **Tablas de Información:** modelos por cadena, **stock actualizado por SKU/tienda**, % distribución por canal (Not Store / Tottus / Online), participación por PDV y marca, **Status SAP** por modelo.
- **Filtros:** Año · Mes Q · Cadena Detalle · Tipo de Tienda · Tienda · Categoría · Tipo (Monto/Unidades).
- **Tabs:** HA | WR | Evolutivo | Retail Mapping – PDV | Retail Mapping – Mall | Tablas.

### 4. Reporte Web Scrapping (precios ecommerce)
- Scraping de precios en webs de retailers (Hiraoka, Falabella, Tottus, Ripley…).
- **KPIs:** precio máximo/mínimo en periodo e histórico.
- **Gráficos:** evolución diaria de precios, precios vs sell-out.
- **Tablas:** Top 10 SKUs Oster / competencia (foto, precio normal, promoción, precio tarjeta, precio final, **% dcto**).
- **Share SKU:** total SKUs (1.364), por marca, share de marca por retail/ticket (low/medium/high).
- **Comparativo de precios** por tipo de producto (licuadora, batidora, cafetera, extractor, freidora, hervidor, plancha, sanduchera…).
- **Filtros:** Año/Mes/Semana · Cadena Web · Marca · Categoría · Modelo COD SAP · Producto · Ticket + características (capacidad, potencia, funciones, velocidades, tipo SKU, material).

### 5. Tracking (GPS — datos de campo) ⭐ clave para el modelo de datos
Mapa de Lima con pines + tabla con **estas columnas exactas**:

`Usuario · Nro Documento (DNI) · Punto de Venta · Fecha Inicio · Fecha Fin · Foto Inicio · Foto Salida · Duración · Traslado · Visita Efectiva · Batería Inicio · Posición Fin · Motivo · Campaña · Actividad · País · Perfil`

Acciones: Panel · Actualizar · Expandir · Limpiar Rutas · Parámetros de Búsqueda.

### 6. Photogram (fotos)
- "Listado de fotos **agrupadas por Punto de Venta (PDV)**", con paginación por carpetas.

---

## 🔑 Distinción clave: datos de campo vs. inteligencia comercial

LiveTrade mezcla **dos capas** que conviene separar para definir el alcance del piloto:

| Capa | Módulos | ¿De dónde salen los datos? | ¿En el piloto de Market Track? |
|---|---|---|---|
| **A. Captura de campo** | Tracking GPS, Photogram, Actividades, Precios en tienda, Quiebres, Exhibiciones | **Del mercaderista** (la app móvil) | ✅ **Sí — es el núcleo del MVP** |
| **B. Inteligencia comercial** | Sell Out, Market Share / Retail Mapping, Web Scraping, Status SAP, Clustering, MSL, Cuotas | **Integradas de terceros** (ERP/SAP del cliente, paneles de mercado, scraping de ecommerce) | ❌ **No — suite avanzada, años de trabajo** |

> **Esto es lo más importante del benchmark.** El cliente ve LiveTrade y ve la **suite completa** (capas A + B). El piloto por COP 17–22M **solo puede entregar la capa A** (captura + dashboard propio). La capa B (integrar ventas del retailer, market share, web scraping) es un producto de **años** y requiere fuentes de datos externas que hoy no tenemos. **Hay que gestionar esta expectativa explícitamente.** Ver [[06 - Análisis de Costos y Cobro]].

---

## Qué cambia en nuestras notas

1. **Modelo de datos** ([[03 - Modelo de Datos]]): añadir entidades **Campaña**, **Actividad** (propia/competencia, con tipo: activación/demostración/dinámica) y enriquecer **Visita** con las columnas del Tracking (foto inicio/salida, duración, traslado, visita efectiva, batería, motivo).
2. **Módulos** ([[04 - Módulos y Funcionalidades]]): el concepto **Campaña** como agrupador es nuevo y valioso; el módulo de **Actividades/Competencia** vale la pena para el MVP (es diferenciador y barato de capturar).
3. **Dashboards:** replicar **contenidos** de los reportes de capa A (cumplimiento, quiebres, precios, fotos por PDV, tracking). Para igualar la **riqueza visual** de Power BI sin su costo → **Next.js/Tremor** o **Metabase** embebido (no Power BI Embedded en el piloto). Ver [[01 - Stack Tecnológico]].
4. **Cobro:** el benchmark confirma que el cliente compara contra una suite madura → blindar alcance a capa A y cotizar la capa B como evolución futura.

---

## Observación de contexto

El acceso es de un **cliente-marca de Overall** (Newell/Oster). Probablemente alguien compartió credenciales para que veas el producto. El cliente de Diego (la empresa de outsourcing) quiere **su propia LiveTrade** — para no depender de Overall o competir en licitaciones. Útil saberlo: **el rival a igualar es Overall**, y el piloto debe verse profesional aunque cubra menos alcance.

---

## Capturas analizadas (`screenshots/`)

| # | Pantalla |
|---|---|
| 01 | Inicio — selector de cliente y campañas (KPI Comercial / KPI Trade) |
| 02 | Índice de reportes de la campaña KPI Comercial |
| 03–04 | Informe de Actividades (Newell / Competencia) |
| 05 | Informe Sell Out (+ los 14 tabs) |
| 06–08 | Retail Mapping / Market Share (+ evolutivo) |
| 09–10 | Clustering Retail (PDV / Malls) |
| 11 | Tablas de Información (stock, status SAP, distribución) |
| 12–15 | Reporte Web Scrapping (precios ecommerce, share SKU, comparativo) |
| 16 | Photogram (fotos por PDV) |
| 17 | Tracking (mapa GPS + columnas de visita) |

---

## Fuentes
- [LiveTrade en Google Play](https://play.google.com/store/apps/details?id=pe.overall.livetrade) · [Overall — Trade Marketing](https://www.overall.pe/servicios/8/trade-marketing) · plataforma: [livetrade.overall.pe](https://livetrade.overall.pe/)

---

⬅ [[06 - Análisis de Costos y Cobro]] · Volver a [[Market Track]]
