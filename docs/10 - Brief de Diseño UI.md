---
tags: [diseño, ui, prototipo, prompt]
created: 2026-07-09
updated: 2026-07-13
proyecto: market-track
---

# 10 — Brief de Diseño UI (prompt para Claude Design)

Volver a [[Market Track]] · Alcance: [[04 - Módulos y Funcionalidades]] · Fuente contractual: `Propuesta Maracumango.pdf`

> **Objetivo: PROTOTIPO INTERACTIVO navegable** (no wireframes estáticos) —
> Claude Design ofrece esa opción. El prototipo debe poder recorrerse de
> principio a fin (clic/tap funcionales, flujos que bifurcan, estados que
> cambian) para validar con el cliente y servir de esqueleto del diseño final.
>
> **Forma recomendada de uso:** pegar/adjuntar como contexto el documento
> [[10a - Contexto de Diseño UI (completo)]] (dominio completo, lógica de
> negocio pantalla por pantalla, interacciones a simular, datos de ejemplo) y
> acompañarlo de una instrucción corta: *"Construye el prototipo interactivo
> del PRODUCTO 1 (app móvil) según las secciones 6 y 10 del contexto"*. El
> prompt condensado de abajo es la alternativa rápida cuando no se puede
> adjuntar el archivo.
>
> Recomendación en ambos casos: correr **3 sesiones separadas** (una por
> producto). Usar los screenshots de LiveTrade (`docs/screenshots/`) como
> referencia competitiva en el portal.

---

## Prompt

```
# CONTEXTO (incluir siempre)

Construye un PROTOTIPO INTERACTIVO Y NAVEGABLE (no wireframes estáticos) para
"Market Track", una plataforma de ejecución en punto de venta (retail
execution) para una empresa de outsourcing de mercaderistas en el retail
peruano (Plaza Vea, Tottus, Metro, Wong).

Fidelidad y estilo del prototipo:
- Visual limpio y profesional, estética tipo shadcn/ui + Tailwind (el stack
  real del proyecto), SIN branding definitivo: base neutra (grises/blancos),
  un color de acento provisional, y colores semánticos del dominio:
  verde = completado/ok · ámbar = en curso/advertencia · rojo = alerta.
- Contenido 100% realista en español (nunca lorem ipsum).
- Navegable de principio a fin: cada botón lleva a algún lado, los flujos
  bifurcan según lo que el usuario ingresa, y los estados cambian (badges,
  contadores, indicadores). Las cámaras y mapas se simulan con placeholders
  interactivos.

La plataforma tiene 3 productos sobre una misma base de datos:
1. APP MÓVIL (mercaderista) — Android e iOS, offline-first
2. PANEL DE GESTIÓN (admin + supervisor) — web desktop
3. PORTAL DEL CLIENTE (brand manager de la marca, ej. "Maracumango") — web

Vocabulario del dominio (usar tal cual en las pantallas):
- Mercaderista: operario que visita tiendas y repone producto
- Rutero: plan de tiendas del día de un mercaderista
- Visita: ejecución real en una tienda (check-in → levantamiento → check-out)
- Levantamiento: captura secuencial de datos en tienda
- Quiebre (OSA): producto con stock en sistema pero sin stock en piso
- Diferencia: hay stock en piso pero no cuadra con el sistema (piso > 0 y ≠)
- Frente (facing): unidad de producto visible de frente en la góndola. La UI
  dice SIEMPRE "frentes" — nunca "caras" ni "facings"
- Share of Shelf (SOS): frentes propios vs. competencia en góndola
- SKU: producto de la marca; "codificado" = autorizado para esa tienda
- Exhibición negociada: cabecera/isla/ruma acordada con el retail
- Contingencia (bypass): cuando un paso no se puede completar por causa externa

Reglas transversales:
- Toda pantalla define 4 estados: cargando, vacío, error y éxito
- Multi-tenant: el cliente-marca solo ve SUS datos; nunca mostrar otras marcas
- AYUDA CONTEXTUAL en todas partes: cada paso del wizard móvil y cada sección
  del panel y del portal llevan un ícono discreto "?" que abre una ayuda breve
  (qué se registra aquí, cómo hacerlo bien, qué hacer si no se puede). En móvil
  es un bottom sheet; en web, un popover junto al título. Nunca un modal que
  bloquea ni un tour de onboarding
- Datos de ejemplo verosímiles (SKUs de pulpa de fruta, tiendas "Plaza Vea
  Higuereta", "Tottus Atocongo", precios en soles S/)

---

# PRODUCTO 1 — APP MÓVIL DEL MERCADERISTA (mobile, 360×800)

Usuario: operario en tienda, teléfono Android de gama media, uso de pie y con
una sola mano, a veces en sótanos SIN SEÑAL. Prioridades: botones grandes
(touch target ≥ 48px), alto contraste, texto grande, mínima carga cognitiva.

REGLA DE ORO: un indicador de estado de conexión/sincronización SIEMPRE visible
(online / offline / N registros pendientes de subir). Trabajar offline es
normal, no un error. Incluir en el prototipo un TOGGLE DE SIMULACIÓN
online/offline para demostrar que el flujo no cambia, solo el indicador.

Flujo a prototipar (recorrible completo, en orden):
1. Login — usuario/contraseña + pantalla de segundo factor. El código de 6
   dígitos llega por el canal configurado en el panel: CORREO (default), SMS o
   WHATSAPP. La pantalla dice por dónde se envió y ofrece "Recibirlo por otro
   medio". Enlace secundario "No me llegó el código" → explica que puede
   reintentar, cambiar de canal, o pedir a su supervisor un PASE DE ACCESO
   TEMPORAL, que se canjea en el mismo campo de 6 dígitos
2. Mi día — rutero: lista ordenada de tiendas con estado (pendiente / en curso
   / completada), hora estimada, dirección; la tienda activa destacada
3. Check-in — validación de geocerca (simular ambos casos: "estás a 18 m ✓"
   habilita el botón, "estás a 240 m ✗" lo bloquea; radio default 100 m),
   selfie con cámara en vivo simulada (placeholder con marca de agua visible:
   hora + coordenadas + usuario), confirmación de inicio de jornada
4. Levantamiento — wizard SECUENCIAL de 5 pasos con barra de progreso; no se
   avanza sin completar el paso; cada paso tiene el enlace secundario
   "No puedo completar este paso" que abre el flujo de CONTINGENCIA
   (motivo → foto opcional → continuar; el paso queda marcado "⚠ Omitido") y un
   ícono "?" de ayuda en su header:
   4.1 Foto "Antes" de la góndola (cámara simulada + watermark)
   4.2 Share of Shelf en DOS NIVELES:
       (a) agregado de góndola — steppers grandes: frentes propios y frentes por
           competidor (lista agregable); share calculado en vivo; foto opcional
       (b) detalle POR SKU — lista de los SKUs codificados con steppers de
           frentes en línea y botón de cámara (foto OPCIONAL) por SKU. Son 15–25
           SKUs: diseñar para recorrerlos rápido de pie, JAMÁS una pantalla por
           SKU. Aviso suave si el detalle no cuadra con el agregado
   4.3 Quiebres y diferencias (título literal de la sección) — checklist de SKUs
       codificados: unidades en sistema y en piso (steppers). Dos badges
       automáticos y excluyentes, con el mismo peso visual: rojo "QUIEBRE"
       (piso = 0 y sistema > 0) y ámbar "DIFERENCIA" (piso > 0 y piso ≠ sistema,
       mostrando el delta: "sistema 12 · piso 9 · faltan 3")
   4.4 Precios y promociones — POR SKU, prototipar el árbol de decisión REAL:
       digitar precio → si es menor al regular pregunta "¿Hay promoción
       activa?" → si Sí, "¿Está comunicada?" → si Sí, pide foto del cartel;
       si No, muestra "Se notificará la desviación". Si es mayor al regular,
       alerta directa. Con promo pre-cargada: precio mayor a la promo pregunta
       "¿La promoción está comunicada?" y bifurca entre alerta "Promoción no
       activa" y "Promoción comunicada pero no activa". Una decisión por
       pantalla (diálogos), no formularios largos.
   4.5 Exhibiciones y POP — tarjetas de exhibiciones negociadas (¿instalada? →
       unidades → ¿completa? → foto), "+ Nueva exhibición adicional", y foto
       "Después" (mostrar la miniatura del "Antes" como guía de encuadre)
5. Check-out — resumen con completados y omitidos (contingencias visibles con
   motivo); si falta algo obligatorio, bloqueo con enlace directo al paso
   faltante; bitácora opcional; salida con GPS → "modo tránsito" hacia la
   siguiente tienda (cronómetro de traslado)
6. Sincronización — cola pendiente ("8 fotos · 12 registros"), progreso al
   recuperar señal, reintento manual, última sync exitosa

Interacciones clave a simular: avance/bloqueo del wizard, bifurcación completa
del árbol de precios, flujo de contingencia, toggle online/offline, badges
QUIEBRE y DIFERENCIA reactivos, SOS en dos niveles, canje del pase de acceso
temporal, ayuda "?" abierta en un paso, bloqueo de check-out con navegación al
paso faltante.

---

# PRODUCTO 2 — PANEL DE GESTIÓN (web desktop, 1440px, sidebar de navegación)

Dos roles con el mismo shell (simular el cambio de rol):
- ADMIN: pre-carga y configura los datos maestros
- SUPERVISOR: opera el día a día de sus rutas

Pantallas ADMIN (CRUD funcional, tablas con búsqueda/filtros/paginación):
1. Clientes-marca (tenants) — lista + formulario (nombre, tolerancia de
   desviación de precio %, activo)
2. Catálogo — cadenas, tiendas (mapa simulado para fijar ubicación y radio de
   geocerca, default 100 m, círculo visible), SKUs, y matriz tienda×SKU de
   "codificados"
3. Precios y promociones — precio regular por SKU/cadena, promos con vigencia
   y clusters de tienda
4. Exhibiciones negociadas — por tienda: tipo, SKUs, unidades, vigencia
5. Usuarios — mercaderistas (con supervisor asignado), supervisores, clientes
6. Acceso y segundo factor — switches de canales de OTP (correo default, SMS,
   WhatsApp) con advertencia al desactivar el 2FA; desde la ficha del usuario,
   "Generar pase de acceso" → motivo obligatorio → código de 6 dígitos mostrado
   UNA sola vez con cuenta regresiva (vence en 15 min, un solo uso) para
   dictárselo por teléfono; bitácora de pases (usuario, quién lo emitió, motivo,
   estado usado/vencido/revocado) con acción "Revocar"

Pantallas SUPERVISOR:
7. Tablero del día — mapa simulado + tabla de visitas en vivo (columnas:
   mercaderista, DNI, punto de venta, check-in, check-out, fotos, duración,
   traslado, visita efectiva, % batería, motivo, estado) + feed de ALERTAS DE
   CONTINGENCIA en vivo con acción "Marcar atendida" (el badge de no-atendidas
   decrementa al atender)
8. Diseño de ruteros — vista semanal por mercaderista: asignar tiendas,
   ordenar paradas (drag & drop), duplicar semana anterior, publicar
9. Revisión de reportes — cola de visitas por aprobar → detalle (fotos
   antes/después lado a lado, datos por paso, contingencias, bitácora) →
   Aprobar / Rechazar con comentario (simular ambas salidas)

El supervisor solo emite y ve pases de acceso DE SUS PROPIOS mercaderistas; el
admin, de cualquiera. Cada sección del panel lleva su ícono "?" de ayuda.

Interacciones clave a simular: navegación admin↔supervisor, marcar alerta
atendida, aprobar/rechazar reporte, editar radio de geocerca sobre el mapa,
emitir y revocar un pase de acceso temporal, ayuda "?" abierta en una sección.

---

# PRODUCTO 3 — PORTAL DEL CLIENTE / MARCA (web, 1440px responsive a tablet)

Usuario: brand manager de la marca (ej. "Maracumango"). NO opera nada — solo
consume. Tono: dashboard ejecutivo denso pero legible (el usuario compara
contra Power BI). Solo ve datos de SU marca. Filtros globales persistentes:
rango de fechas · cadena · tienda.

Pantallas:
1. Dashboard principal — fila de KPIs con tendencia (% cumplimiento de rutero,
   quiebres detectados hoy, diferencias de stock, Share of Shelf promedio =
   frentes propios / frentes totales, exhibiciones cumplidas vs. negociadas,
   desviaciones de precio) + MAPA con pines de tiendas (verde/ámbar/rojo; clic
   en pin → mini-card → detalle) + feed de alertas recientes con severidad
2. Detalle de tienda — última visita, fotos antes/después lado a lado, datos
   del levantamiento, historial de visitas
3. Galería de evidencia — fotos agrupadas por punto de venta, filtrables por
   cadena/tienda/tipo/fecha; vista comparativa antes/después
4. Alertas — tabla con filtros (tipo — incluyendo "diferencia de stock" —,
   severidad, estado nueva/vista/resuelta) → detalle con evidencia (precio
   esperado vs. registrado, foto); marcar vista/resuelta cambia el estado en la
   tabla
5. Reportes — configurador (fechas, cadenas, KPIs) → vista previa → botones
   de exportación Excel/PDF (simulados)

Cada sección lleva su ícono "?" de ayuda; en el portal explica sobre todo CÓMO
SE CALCULA cada KPI y qué significa cada tipo de alerta.

Interacciones clave a simular: clic en pin → detalle de tienda, filtros que
alteran los datos mostrados, ciclo de estado de una alerta (incluida una de
diferencia de stock), comparador antes/después en la galería, ayuda "?" abierta
sobre un KPI.

---

Entregables por producto: prototipo navegable completo con los estados clave
de cada pantalla (cargando / vacío / error / éxito) accesibles dentro del
propio prototipo, y anotaciones breves justificando decisiones de layout
donde no sea obvio.
```

---

## Notas de uso

1. **Prioridad de iteración: la app móvil.** Es el producto que 20–50 personas
   usan 8 horas al día en condiciones adversas; el wizard de levantamiento —
   con su árbol de decisión de precios y el flujo de contingencia — es la
   parte más importante de todo el prototipo.
2. **Del prototipo al diseño final:** el prototipo ya usa estética
   shadcn/ui + Tailwind (el stack real), así que la transición al diseño
   final es aplicar branding (color, logo, tipografía de marca) sobre la
   estructura ya validada — casi 1:1 implementable.
3. **Demo al cliente:** el toggle online/offline del prototipo móvil es el
   argumento de venta #1 (offline real) — úsalo en las demos de los hitos.
4. **Referencia competitiva:** los screenshots de LiveTrade en
   `docs/screenshots/` sirven como referencia de qué muestra el competidor en
   su portal (ver [[07 - Benchmark LiveTrade (Overall)]]).
5. Los prototipos aprobados alimentan la tarea "Wireframes/UI base" de la
   Fase 0 ([[05 - Fases de Desarrollo]]).

---

⬅ [[09 - Diagramas de Arquitectura]] · Volver a [[Market Track]]
