---
tags: [diseño, ui, contexto, prototipo]
created: 2026-07-09
updated: 2026-07-13
proyecto: market-track
---

# 10a — Contexto de Diseño UI (completo)

Volver a [[Market Track]] · Prompt de uso: [[10 - Brief de Diseño UI]]

> **Cómo usar este archivo:** pégalo (o adjúntalo) completo como CONTEXTO en la
> sesión de Claude Design, seguido de la instrucción de qué producto
> prototipar (ver [[10 - Brief de Diseño UI]]). Contiene todo el dominio, la
> lógica de negocio pantalla por pantalla, las interacciones a simular y los
> datos de ejemplo que el prototipo necesita.
>
> **Entregable objetivo: PROTOTIPO INTERACTIVO NAVEGABLE** (no wireframes
> estáticos) — ver la especificación completa en la sección 10.

---

# MARKET TRACK — CONTEXTO COMPLETO PARA DISEÑO DE INTERFAZ

## 1. Qué es el producto

Market Track es una plataforma de **ejecución en punto de venta (retail
execution)** para una empresa peruana de **outsourcing de mercaderistas**. La
empresa coloca personal (mercaderistas/reponedores) en cadenas de retail —
Plaza Vea, Tottus, Metro, Wong — para representar marcas de consumo masivo
(la marca de ejemplo es **"Maracumango"**, pulpas y néctares de fruta).

El software cumple tres objetivos a la vez:
1. **Controlar al personal en campo**: probar con evidencia verificable quién
   visitó cada tienda, a qué hora, y qué hizo.
2. **Capturar datos de valor comercial** para la marca: quiebres de stock,
   participación de góndola, precios, promociones, exhibiciones.
3. **Blindar legalmente** a la empresa frente a la fiscalización laboral
   peruana (SUNAFIL): jornada real registrada, órdenes solo del supervisor.

Son **tres productos sobre una misma base de datos**:

| Producto | Usuario | Dispositivo |
|---|---|---|
| App móvil | Mercaderista | Android/iOS gama media, en campo |
| Panel de gestión | Admin + Supervisor (empresa de outsourcing) | Web desktop |
| Portal del cliente | Brand Manager de la marca | Web desktop/tablet |

**Multi-tenant:** la plataforma sirve a varias marcas a la vez. Cada marca ve
ÚNICAMENTE sus datos. Ninguna pantalla del portal debe insinuar la existencia
de otras marcas.

**El referente a igualar** es LiveTrade (de Corporativo Overall, líder peruano
de trade marketing): el piloto debe verse igual de profesional aunque cubra
menos módulos. Su portal organiza todo en: Tracking (mapa GPS + tabla de
visitas), Reportes BI y Photogram (galería de fotos agrupada por punto de
venta).

---

## 2. Personas

### 🧑‍🔧 El Mercaderista (app móvil)
Operario de campo, 20–45 años, teléfono Android de gama media. Su día real:
sale de casa 5:30 AM con uniforme y botas de seguridad; entra a la primera
tienda por la puerta de personal ~8:00 AM presentando DNI y fotocheck; pasa la
mañana entre la trastienda (buscar stock, rotar producto por vencimiento) y la
góndola (limpiar, reponer, colocar material publicitario); al mediodía hace el
levantamiento de información en la app; almuerza 45 minutos (por ley); va a
una segunda tienda por la tarde; termina ~6:00 PM.

**Condiciones de uso críticas para el diseño:**
- Usa la app **de pie, con una sola mano**, a menudo con la otra ocupada.
- Los **sótanos y trastiendas no tienen señal** — gran parte del trabajo
  ocurre offline. Esto es NORMAL, no una condición de error.
- Iluminación variable (almacenes oscuros, piso de venta muy iluminado).
- No es usuario técnico: la app debe guiarlo paso a paso, sin ambigüedad.
- Le preocupa que "no se registre" su trabajo: necesita confirmación visual
  clara de que cada dato y foto quedó guardado (aunque no haya subido aún).

### 🧭 El Supervisor de Ruta (panel de gestión)
Controla 5–15 mercaderistas en varias rutas. Diseña los ruteros semanales,
monitorea el día en vivo, atiende contingencias y aprueba/rechaza los reportes
de visita. **Es la única persona que puede dar órdenes al mercaderista**
(candado legal SUNAFIL: si el jefe de tienda del retail necesita algo, se lo
pide al supervisor y este lo canaliza por la app). Trabaja en desktop, con
interrupciones constantes — el tablero debe permitirle recuperar el contexto
del día de un vistazo.

### 👔 El Administrador (panel de gestión)
Rol interno de la empresa de outsourcing. Hace la "pre-carga": da de alta
marcas-cliente, cadenas, tiendas (con su geocerca), SKUs codificados por
tienda, precios regulares, promociones vigentes y exhibiciones negociadas.
Sin una pre-carga correcta, la app del mercaderista no funciona — es trabajo
de tablas y formularios, denso pero poco frecuente.

### 📊 El Brand Manager (portal del cliente)
Ejecutivo de la marca (ej. gerente comercial de Maracumango). **No opera
nada: solo consume.** Quiere saber en tiempo real: ¿mis tiendas están
atendidas? ¿hay quiebres? ¿mis promociones están activas y comunicadas? ¿cómo
quedó mi góndola? Compara mentalmente contra suites BI maduras (Power BI), así
que espera un dashboard ejecutivo denso y pulido. Recibe además alertas por
correo y entra al portal a investigar el detalle.

---

## 3. Glosario del dominio (usar estos términos EXACTOS en la UI)

| Término | Significado |
|---|---|
| **Mercaderista** | Operario que visita tiendas y repone producto |
| **Rutero** | Plan de tiendas del día/semana de un mercaderista |
| **Parada** | Cada tienda dentro del rutero, en orden |
| **Visita** | Ejecución real en una tienda: check-in → levantamiento → check-out |
| **Levantamiento** | Captura secuencial de datos dentro de la tienda |
| **Quiebre (OSA)** | Producto con stock en sistema pero sin unidades en piso |
| **Share of Shelf (SOS)** | Frentes propios vs. competencia en góndola |
| **SKU** | Producto de la marca; **"codificado"** = autorizado en esa tienda |
| **Frente (facing)** | Unidad de producto visible de frente en la góndola. **La UI dice siempre "frentes", nunca "caras" ni "facings"** |
| **Diferencia** | El stock en piso no cuadra con el sistema (piso > 0 y piso ≠ sistema). Distinto del quiebre, que es piso = 0 |
| **Exhibición negociada** | Cabecera, isla o ruma acordada con el retail |
| **Exhibición adicional** | Espacio extra conseguido por el mercaderista |
| **Material POP** | Publicidad en tienda: stoppers, saltarines, rompetráficos |
| **Contingencia (bypass)** | Paso que no se pudo completar por causa externa |
| **Bitácora** | Comentario libre del mercaderista al cerrar la visita |
| **Modo tránsito** | Estado entre tiendas; mide el tiempo de traslado |
| **Pre-carga** | Datos maestros que el admin carga antes de operar |
| **Tenant / cliente-marca** | La marca que contrata (ej. Maracumango) |

---

## 4. Principios de diseño (aplican a los tres productos)

1. **Offline visible, nunca alarmante (móvil).** Un indicador permanente
   muestra: `● En línea` / `○ Sin conexión — trabajando localmente` /
   `↑ 12 registros y 8 fotos pendientes de subir`. Perder señal no cambia el
   flujo ni muestra errores; solo cambia el indicador.
2. **Toda pantalla define 4 estados:** cargando, vacío (con guía de qué hacer),
   error (con acción de recuperación) y éxito.
3. **La evidencia es sagrada.** Las fotos siempre se toman con cámara en vivo
   (nunca galería) y muestran su marca de agua (fecha, hora, coordenadas,
   usuario) visible en la miniatura. La confirmación de "foto guardada" debe
   ser inequívoca.
4. **Guiar, no castigar (móvil).** El flujo secuencial impide saltarse pasos,
   pero siempre ofrece la salida honesta: "No puedo completar este paso"
   (contingencia). El tono nunca culpa al mercaderista.
5. **Densidad según el usuario.** Móvil: una decisión por pantalla, botones
   ≥ 48 px, texto grande. Panel: tablas eficientes con filtros. Portal:
   dashboard ejecutivo denso pero jerarquizado.
6. **Multi-tenant estricto.** El portal jamás muestra datos, nombres o
   totales de otra marca. El panel sí ve todo (con selector de cliente-marca,
   como hace LiveTrade).
7. **Estados de color del dominio:** verde = completado/ok, amarillo/ámbar =
   en curso/advertencia, rojo = alerta/incumplido. Se usan igual en el mapa,
   las listas y los badges de los tres productos.
8. **Ayuda contextual en todas partes.** Cada paso del wizard móvil y cada
   sección del panel y del portal llevan un ícono discreto **`?`** que abre una
   ayuda breve: qué se registra aquí, cómo hacerlo bien, y qué hacer si algo no
   se puede completar. En móvil abre una hoja inferior (*bottom sheet*); en web,
   un popover junto al título de la sección. Nunca es un modal que bloquea, ni
   un tour de onboarding: es consulta puntual, disponible siempre, y **funciona
   sin conexión** (el texto viaja con la app, no se descarga).

---

## 5. Datos de ejemplo realistas (usar en todos los wireframes)

- **Marca (tenant):** Maracumango — pulpas y néctares de fruta.
- **SKUs:** Pulpa de Maracuyá 500 g · Pulpa de Mango 500 g · Néctar
  Maracumango 1 L · Néctar Maracumango 300 mL six-pack · Pulpa Mixta 1 kg.
- **Cadenas y tiendas:** Plaza Vea Higuereta · Plaza Vea Primavera · Tottus
  Angamos · Tottus Atocongo · Metro Chorrillos · Wong La Molina.
- **Personas:** José Quispe, María Huamán, Carlos Rojas (mercaderistas);
  Ana Torres (supervisora); Luis Paredes (brand manager Maracumango).
- **Precios en soles:** Néctar 1 L — regular S/ 8.90, promo S/ 6.90;
  Pulpa 500 g — regular S/ 12.50.
- **Competidores en góndola:** Frutísima, Selva Viva, Pulpa Andina.
- **Un rutero típico:** 2 tiendas/día (mañana + tarde), 15–25 SKUs codificados
  por tienda.
- **Motivos de contingencia:** "Sin acceso al almacén" · "Información no
  disponible" · "Góndola en remodelación" · "Encargado no autoriza" · "Otro".

---

## 6. PRODUCTO 1 — App móvil del mercaderista

**Formato:** mobile 360×800. **Navegación:** flujo lineal guiado por el día;
sin menús profundos. **Header persistente:** tienda actual + indicador de
conexión/sync.

### 6.1 Login y segundo factor
- Usuario/contraseña → pantalla de código de 6 dígitos.
- **El código llega por el canal configurado en el panel: correo (default), SMS
  o WhatsApp.** La pantalla dice por dónde se envió ("Te enviamos un código al
  correo j****@maracumango.pe") y, si hay más de un canal habilitado, ofrece
  **"Recibirlo por otro medio"** → selector de canal → reenvío.
- **"No me llegó el código"** (enlace secundario, siempre visible): explica que
  puede reintentar, cambiar de canal, o pedirle a su supervisor un **pase de
  acceso temporal**. Al pedirlo, la pantalla acepta ese pase en el mismo campo
  de 6 dígitos — no hay una pantalla distinta.
- La sesión persiste (el 2FA no se repite cada día en el mismo dispositivo).
- Estado de error: credenciales inválidas / código vencido / sin conexión en
  primer login (mensaje honesto: el segundo factor **necesita señal**; sugerir
  hacer el primer login antes de entrar a la tienda).

### 6.2 Mi Día (home)
- Fecha + saludo + resumen: "2 tiendas hoy · 1 completada".
- Lista ordenada de paradas del rutero: nombre de tienda, dirección, distancia,
  ventana horaria, estado (`pendiente` / `en curso` / `completada ✓`).
- La tienda activa se destaca; las completadas se comprimen.
- Acceso secundario: pantalla de sincronización y notificaciones/tareas del
  supervisor (push).
- Estado vacío: "No tienes rutero asignado para hoy — contacta a tu supervisor".

### 6.3 Check-in
Secuencia en una sola pantalla con pasos visibles:
1. **Validación de geocerca:** feedback claro y binario —
   `✓ Estás en Plaza Vea Higuereta (a 18 m)` o
   `✗ Estás a 240 m de la tienda asignada — acércate para hacer check-in`
   (botón deshabilitado hasta estar dentro del radio de la tienda, **100 m por
   defecto**). Funciona offline con coordenadas pre-descargadas.
2. **Selfie de ingreso:** cámara frontal en vivo (galería inexistente en el
   flujo), guía de encuadre ("muestra tu uniforme y fotocheck"), y la marca de
   agua visible sobre la vista previa: `08:02 · -12.1219, -76.9975 · J. Quispe`.
3. **Confirmación:** "Jornada iniciada a las 08:02" (hora del servidor cuando
   hay señal; local marcada como "por confirmar" cuando no).

### 6.4 Levantamiento — wizard secuencial de 5 pasos
Barra de progreso persistente (Paso 2 de 5). No se puede avanzar sin completar
el paso actual. **Cada paso incluye, discreto pero siempre visible, el enlace
"No puedo completar este paso"** que abre el flujo de contingencia (6.5), y un
**ícono `?` de ayuda** en el header del paso (principio 4.8) que explica qué se
registra ahí y cómo.

**Paso 1 — Foto "Antes".** Cámara en vivo, foto panorámica de la góndola tal
como la encontró. Miniatura con watermark + botón repetir.

**Paso 2 — Share of Shelf (conteo manual). Dos niveles: góndola y SKU.**

*Nivel 1 — agregado de la góndola* (rápido, siempre):
- "¿Cuántos **frentes** tiene Maracumango?" — stepper numérico GRANDE (+/−).
- "Competencia": lista agregable — seleccionar competidor (Frutísima, Selva
  Viva, Pulpa Andina, Otro) + stepper de frentes. Ej.: Maracumango 4 ·
  Frutísima 6 · Selva Viva 2.
- Resumen visual del share calculado (Maracumango 33%).
- Foto opcional de la góndola completa.

*Nivel 2 — detalle por SKU* (el cambio de la revisión con el cliente):
- Debajo del agregado, la **lista de los SKUs codificados de esa tienda**; por
  cada uno: stepper de **frentes propios**, frentes por competidor, y un botón
  de **cámara (foto opcional)** del frente de ese SKU.
- **Diseñar para la velocidad, no para la exhaustividad:** son 15–25 SKUs y el
  mercaderista está de pie frente a la góndola. Todo en una lista con steppers
  en línea — jamás una pantalla por SKU. La foto es opcional y se toma solo
  cuando hay algo que mostrar.
- Indicador de cuadre: la suma de frentes propios por SKU vs. el agregado de
  góndola. Si no cuadran, aviso **suave** ("El detalle suma 6 y registraste 4
  en la góndola") — informa, no bloquea.
- Progreso visible: "8 de 18 SKUs con frentes registrados".

**Paso 3 — Quiebres y diferencias (checklist de SKUs codificados).**
- Título literal de la sección: **"Quiebres y diferencias"**.
- Lista de los SKUs codificados EN ESA TIENDA (15–25 ítems). Por SKU, dos
  entradas numéricas: **unidades en sistema** y **unidades en piso** (góndola
  + exhibiciones + trastienda).
- Dos flags automáticos y **excluyentes** en la fila, con el mismo peso visual:
  - piso = 0 y sistema > 0 → badge **rojo "QUIEBRE"**.
  - piso > 0 y piso ≠ sistema → badge **ámbar "DIFERENCIA"**, con el delta
    visible (ej. "sistema 12 · piso 9 · **faltan 3**", o "sobran 3").
- Progreso visible ("12 de 18 SKUs registrados"); los SKUs con quiebre **y los
  que tienen diferencia** quedan destacados en el resumen del paso.

**Paso 4 — Precios y promociones (por SKU, la lógica más delicada).**
El mercaderista digita el precio de venta de HOY (teclado numérico grande,
formato S/ 0.00). Solo productos de la marca, nunca de la competencia. La app
tiene pre-cargados el precio regular y las promos vigentes, y reacciona así:

- **SKU sin promoción activa:**
  - Precio digitado < regular → pregunta 1: *"¿Hay alguna promoción
    activa?"* → Si **Sí** → pregunta 2: *"¿La promoción está comunicada?"*
    → Si **Sí** → pedir **foto del cartel/encarte** (cámara en vivo). → Si
    **No** → se registra alerta de **diferencia de precio** (aviso discreto:
    "Se notificará la desviación", sin culpar).
  - Precio digitado > regular → alerta automática de **diferencia de precio**.
  - Precio = regular → ✓ sin fricción, pasa al siguiente SKU.
- **SKU con promoción activa pre-cargada:**
  - Precio digitado > precio promo → pregunta: *"¿La promoción está
    comunicada?"* → **No** → alerta **"Promoción no activa"** · **Sí** →
    alerta **"Promoción comunicada pero no activa"**.
  - Precio digitado < precio promo → alerta de **diferencia de precio**.
  - Precio = promo → ✓.

Las desviaciones dentro de la tolerancia configurada por la marca (± %) no
generan alerta. Diseñar el flujo de preguntas como diálogos de una decisión
por pantalla, no formularios largos.

**Paso 5 — Exhibiciones, material POP y foto "Después".**
- **Exhibiciones negociadas** (pre-cargadas para esa tienda): tarjeta por
  exhibición — tipo (cabecera / isla / ruma), SKUs que lleva, cantidad
  sugerida, vigencia. Preguntas: *¿Está instalada?* (sí/no) → unidades
  actuales (stepper) → *¿Está completa?* → foto de evidencia. Si faltan
  unidades vs. lo sugerido, la app lo indica y se genera alerta.
- **Material POP**: misma mecánica que exhibiciones (instalado / foto).
- **Exhibiciones adicionales**: botón "+ Nueva exhibición adicional" — tipo,
  foto (cámara en vivo; la fecha/hora sale de la captura). En visitas
  posteriores la app pregunta por su vigencia: *"La ruma conseguida el 02/07,
  ¿sigue instalada?"* → Sí + foto / No.
- **Foto "Después"**: cierre del paso — la góndola repuesta y ordenada, en el
  mismo encuadre que el "Antes" (mostrar la miniatura del Antes como guía).

### 6.5 Flujo de contingencia (bypass) — disponible en todo paso
1. Tocar "No puedo completar este paso".
2. Seleccionar motivo (lista de la sección 5) + comentario opcional + foto
   opcional del hallazgo.
3. Confirmar → el paso queda marcado `⚠ Omitido — [motivo]` y el wizard avanza.
4. Aviso al usuario: "Tu supervisor fue notificado" (la alerta llega al panel
   en tiempo real; si está offline, al sincronizar).
El diseño debe hacer la contingencia accesible sin promoverla: acción
secundaria, no botón principal.

### 6.6 Check-out
- **Resumen de la visita:** checklist de lo completado; las contingencias
  visibles con su motivo; conteo de fotos y registros capturados.
- Si falta algo obligatorio: bloqueo claro — *"No puedes salir de la tienda
  hasta completar el reporte de Quiebres"* — con enlace directo al paso
  faltante (o a su contingencia).
- **Bitácora:** campo de texto libre opcional ("Ej.: remodelarán el pasillo de
  bebidas la próxima semana").
- **Salida:** marcación con GPS. Si hay una siguiente parada → **modo
  tránsito**: pantalla de traslado con la siguiente tienda y el cronómetro de
  traslado corriendo. Si era la última → "Jornada finalizada · Resumen del día".

### 6.7 Pantalla de sincronización
- Cola visible: "8 fotos · 12 registros pendientes", progreso al recuperar
  señal, botón "Reintentar ahora", hora de la última sincronización exitosa.
- Nunca presentar lo pendiente como error; es el estado natural del trabajo
  en sótano.

**Simulación offline (clave para la demo):** el prototipo incluye un **toggle
online/offline** (puede vivir en la pantalla de sincronización o como control
de demo). Al activarlo, el flujo NO cambia — solo el indicador (banner
`○ Sin conexión — todo se guarda en tu teléfono`) y los contadores de la cola
de sync. Demostrar que check-in, wizard y check-out funcionan idénticos en
ambos estados es el argumento de venta #1 del producto.

---

## 7. PRODUCTO 2 — Panel de gestión (admin + supervisor)

**Formato:** web desktop 1440 px, sidebar de navegación, shell compartido.
El admin ve además un **selector de cliente-marca** (multi-tenant) en el
header. Tablas con búsqueda, filtros, orden y paginación. **Cada sección lleva
su ícono `?` de ayuda** junto al título (principio 4.8): un popover que explica
para qué sirve la sección y qué consecuencia tiene lo que se configura ahí — la
pre-carga es densa y es donde un error silencioso rompe la app del mercaderista.

### Sección ADMIN (pre-carga de datos maestros)

**7.1 Clientes-marca (tenants).** Lista + formulario: nombre, logo,
tolerancia de desviación de precio regular (%), tolerancia de precio
promocional (%), estado activo.

**7.2 Catálogo.**
- **Cadenas**: Plaza Vea, Tottus, Metro, Wong (+ tipo de tienda: híper/súper/
  express).
- **Tiendas**: nombre, cadena, dirección, y un **mapa para fijar la ubicación
  y el radio de geocerca** (**default 100 m**, editable por tienda, círculo
  visible sobre el mapa); cluster de la tienda.
- **SKUs**: código, nombre, presentación, código de barras, activo.
- **Matriz de codificación tienda × SKU**: qué SKUs están autorizados en cada
  tienda (checkboxes en masa por cadena/cluster) — de aquí sale la "lista
  exacta" que ve el mercaderista.

**7.3 Precios y promociones.**
- Precio regular por SKU × cadena × tipo de tienda, con vigencia.
- Promociones: SKU, precio promo, fecha inicio/fin, clusters de tienda donde
  aplica, flag "comunicada".

**7.4 Exhibiciones negociadas.** Por tienda: tipo (cabecera/isla/ruma), SKUs
de carga (multi-select), cantidad sugerida, vigencia (desde/hasta). Misma
configuración reutilizada para material POP.

**7.5 Usuarios.** Mercaderistas (DNI, teléfono, supervisor asignado, SCTR
vigente hasta), supervisores, usuarios del portal cliente (marca a la que
pertenecen).

**7.5b Acceso y segundo factor.** Pantalla de configuración + acción de rescate:
- **Canales de OTP**: switches para `Correo` (default, siempre disponible),
  `SMS` y `WhatsApp`. Un switch maestro activa/desactiva el segundo factor.
  Advertencia visible al desactivar: se está bajando la seguridad de todos.
- **Pase de acceso temporal** (el rescate del mercaderista que no recibe su
  código): desde la ficha del usuario, botón **"Generar pase de acceso"** →
  pedir **motivo** (obligatorio) → se muestra **una sola vez** un código de 6
  dígitos con su cuenta regresiva (**vence en 15 minutos, un solo uso**). El
  supervisor se lo dicta al mercaderista por teléfono.
- **Bitácora de pases**: tabla con usuario, quién lo emitió, motivo, hora,
  y estado (`usado` / `vencido` / `revocado`), con acción **"Revocar"** sobre
  los pases vivos. Es un registro de auditoría: quien puede emitir un pase
  puede entrar como ese mercaderista, y eso tiene que quedar escrito.
- El supervisor solo ve y emite pases **de sus propios mercaderistas**; el
  admin, de cualquiera.

### Sección SUPERVISOR (operación del día)

**7.6 Tablero del día (pantalla principal).**
- **Mapa en vivo** de sus rutas (Lima): pin por mercaderista/tienda con estado
  (verde completada, amarillo en curso, gris pendiente, rojo con alerta).
- **Tabla de visitas en vivo** — columnas de referencia (basadas en el
  Tracking del líder del mercado): Mercaderista · DNI · Punto de venta ·
  Check-in · Check-out · Foto ingreso · Foto salida · Duración · Traslado ·
  Visita efectiva (sí/no) · % Batería al inicio · Motivo · Estado.
- **Feed de alertas de contingencia en tiempo real** (panel lateral):
  "10:42 — José Quispe no pudo completar *Quiebres* en Tottus Angamos — Sin
  acceso al almacén" + botón "Marcar atendida". Badge de no-atendidas en el
  ícono de la sección.

**7.7 Diseño de ruteros.** Vista semanal por mercaderista: asignar tiendas a
días, ordenar paradas (drag & drop), ver carga (nº tiendas/día), duplicar
semana anterior, publicar (lo que dispara la descarga al teléfono).

**7.8 Revisión de reportes.** Cola de visitas por aprobar. Detalle de visita:
fotos antes/después lado a lado (con watermark), datos del levantamiento por
paso (SOS, quiebres, precios con sus alertas, exhibiciones), contingencias
destacadas, bitácora. Acciones: **Aprobar** / **Rechazar con comentario** (el
comentario llega al mercaderista como tarea/push).

---

## 8. PRODUCTO 3 — Portal del cliente (brand manager)

**Formato:** web 1440 px, responsive a tablet. Solo lectura. Header con logo
de SU marca. Tono: ejecutivo, denso en datos, comparable a un dashboard de BI
profesional (el usuario está acostumbrado a Power BI). Filtros globales
persistentes: rango de fechas · cadena · tienda · cluster. **Cada sección lleva
su ícono `?` de ayuda** (principio 4.8) — aquí explica sobre todo *cómo se
calcula* cada KPI y qué significa cada tipo de alerta.

**8.1 Dashboard principal.**
- **Fila de KPIs** (tarjetas con tendencia vs. período anterior):
  - **% Cumplimiento de rutero** = visitas realizadas / planificadas.
  - **Quiebres activos** = SKUs con quiebre reportado hoy (y % OSA).
  - **Diferencias de stock** = SKUs con piso ≠ sistema (piso > 0) hoy.
  - **Share of Shelf promedio** = frentes propios / frentes totales.
  - **Exhibiciones cumplidas** = instaladas y completas / negociadas.
  - **Desviaciones de precio** detectadas en el período.
- **Mapa en tiempo real** (protagonista visual): pines de tiendas — verde
  (visita completada), amarillo (en curso), rojo (alerta o no visitada). Click
  en pin → mini-card con último estado y enlace al detalle.
- **Feed de alertas recientes** con tipo, severidad, tienda y hora.
- Los KPIs por mercaderista / supervisor / tienda existen como corte básico
  (tabla ranking), no como analítica avanzada.

**8.2 Detalle de tienda.** Última visita (hora, mercaderista, duración), fotos
antes/después lado a lado, levantamiento resumido (SOS con gráfico simple,
quiebres listados, precios con desviaciones marcadas, exhibiciones con su
estado), historial de visitas de la tienda.

**8.3 Galería de evidencia** (estilo "Photogram"): fotos agrupadas **por punto
de venta**, filtrables por cadena, tienda, tipo de foto (antes / después /
**frentes de un SKU** / exhibición / cartel de promo) y fecha. Vista comparativa
antes/después. Toda foto muestra su watermark.

**8.4 Alertas.** Tabla completa con filtros: tipo (`quiebre` ·
`diferencia de stock` · `desviación de precio` · `promoción no activa` ·
`promoción comunicada pero no activa` · `exhibición incompleta`),
severidad (info / alta / crítica),
estado (nueva / vista / resuelta), tienda, fecha. Detalle con el contexto y
la evidencia (foto, precio esperado vs. registrado). Nota: las alertas
también llegan por correo; el portal es donde se investiga.

**8.5 Reportes.** Configurador: rango de fechas, cadenas/tiendas, KPIs y
secciones a incluir → vista previa → **exportar Excel / PDF**.

---

## 9. Qué NO prototipar (fuera del piloto)

- IA de análisis de fotos (el SOS es conteo manual en el piloto).
- Módulo de mermas y semáforo de vencimientos (PVPS).
- **Alertas** por WhatsApp (las alertas salen solo por correo) y
  chat/comunicación interna. Ojo: el **OTP** por WhatsApp/SMS sí entra al piloto
  (sección 6.1) — es otro caso de uso, no lo confundas con las alertas.
- Reconocimiento facial/biométrico.
- Control fino de jornada y horas extra (SUNAFIL) — el piloto solo registra
  check-in/check-out.
- Sell-out, market share, scraping de precios, integraciones ERP/SAP.
- Cualquier pantalla de configuración del sistema no listada arriba.

Si un módulo de los listados aparece referenciado (p. ej. en navegación),
omítelo por completo — el alcance del piloto es exactamente lo descrito en
las secciones 6–8.

---

## 10. Entregable esperado: PROTOTIPO INTERACTIVO

### Fidelidad y estilo visual
- **Prototipo navegable de principio a fin**, no pantallas estáticas: cada
  botón lleva a algún lado, los flujos bifurcan según lo que el usuario
  ingresa y los estados cambian (badges, contadores, indicadores).
- Visual limpio y profesional, estética **shadcn/ui + Tailwind** (el stack
  real del proyecto): base neutra (grises/blancos), un color de acento
  provisional, tipografía neutra — **sin branding definitivo** (el logo y los
  colores de marca se aplican después sobre la estructura validada).
- **Colores semánticos del dominio** (sección 4.7): verde = completado/ok ·
  ámbar = en curso/advertencia · rojo = alerta. Consistentes en los tres
  productos.
- **Contenido 100% realista en español** (datos de la sección 5, nunca lorem
  ipsum).
- Cámaras, mapas y GPS se simulan con **placeholders interactivos** (una
  "cámara" que al disparar produce la miniatura con watermark; un "mapa" con
  pines clicables).

### Interacciones que el prototipo DEBE simular

**App móvil:**
- Avance y bloqueo del wizard secuencial (no avanza sin completar el paso).
- El **árbol de decisión de precios completo** (sección 6.4): digitación →
  preguntas encadenadas → foto del cartel o aviso de alerta, con todas sus
  bifurcaciones recorribles.
- El **flujo de contingencia** en cualquier paso (motivo → foto opcional →
  paso marcado "⚠ Omitido" → aviso "tu supervisor fue notificado").
- Badges reactivos en el paso 3: **QUIEBRE** (rojo, piso = 0 y sistema > 0) y
  **DIFERENCIA** (ámbar, piso > 0 y piso ≠ sistema, con el delta).
- **SOS en dos niveles** (sección 6.4, paso 2): agregado de góndola + lista por
  SKU con steppers de frentes y foto opcional, más el aviso suave de descuadre.
- **Segundo factor multicanal** (6.1): reenvío por otro canal y el camino
  completo de "No me llegó el código" → canje del pase temporal.
- Geocerca en ambos casos: dentro (botón habilitado) / fuera (bloqueado con
  distancia).
- Bloqueo de check-out con enlace directo al paso faltante.
- **Toggle online/offline** (sección 6.7): el flujo no cambia, solo el
  indicador y la cola de sincronización.
- **Ayuda `?`** abierta en al menos un paso del wizard (bottom sheet).

**Panel de gestión:**
- Cambio de rol admin ↔ supervisor en el mismo shell.
- Feed de contingencias: "Marcar atendida" decrementa el badge.
- Aprobar / rechazar reporte con comentario (ambas salidas recorribles).
- Edición del radio de geocerca sobre el mapa (círculo que crece/decrece).
- **Emisión de un pase de acceso temporal** (7.5b): motivo → código mostrado una
  sola vez con cuenta regresiva → aparece en la bitácora → "Revocar".
- Switches de canales de OTP, con la advertencia al desactivar el 2FA.
- **Ayuda `?`** abierta en al menos una sección (popover).

**Portal del cliente:**
- Clic en pin del mapa → mini-card → detalle de tienda.
- Filtros globales que alteran visiblemente los datos mostrados.
- Ciclo de estado de una alerta (nueva → vista → resuelta), incluyendo una del
  tipo **diferencia de stock**.
- Comparador antes/después en la galería.
- **Ayuda `?`** abierta sobre un KPI (cómo se calcula).

### Estados y anotaciones
- Los estados clave de cada pantalla (cargando / vacío / error / éxito)
  accesibles dentro del propio prototipo (p. ej. datos de demo que incluyen
  una tienda sin visitas, una alerta crítica, un rutero vacío).
- Anotaciones breves justificando decisiones de layout no obvias.

### Prioridad
El **wizard de levantamiento de la app móvil** es la parte más importante de
toda la plataforma (20–50 personas lo usarán 8 horas al día en condiciones
adversas) — si hay que elegir dónde invertir detalle de interacción, es ahí.
