---
tags: [diseño, ui, prototipo, prompt, iteración-2]
created: 2026-07-14
proyecto: market-track
---

# 11 — Segunda Iteración de Diseño (prompts por plataforma)

Volver a [[Market Track]] · Primera iteración: [[10 - Brief de Diseño UI]] · Alcance: [[04 - Módulos y Funcionalidades]]

> **Qué es esto.** El [[10 - Brief de Diseño UI]] fue el **primer prompt**: con
> él se construyó el prototipo v1 de cada producto. Este documento es la
> **segunda interacción** — un prompt-DELTA por plataforma que actualiza ese
> prototipo con lo que los **spikes ya cerraron** y ahora es decisión firme.
>
> No re-especifica la plataforma entera: parte de que el prototipo v1 ya existe
> y solo pide los cambios. Cada bloque de abajo se pega en la **misma sesión de
> Claude Design** donde vive el prototipo de esa plataforma.
>
> **Decisiones que alimentan esta iteración** (todas escritas):
> - [[adr/0001-motor-offline-dedicado|ADR-0001]] — el motor offline es
>   **PowerSync**; el servidor es la fuente de verdad (sin UI de conflictos).
> - [[adr/0008-segundo-factor-multicanal-sobre-mfa-nativo|ADR-0008]] — el 2FA se
>   monta sobre el **factor Teléfono nativo** de Supabase con entrega enrutada
>   (correo por defecto, SMS/WhatsApp); enforcement por el claim `aal2`.
> - [[adr/0003-fotos-en-r2-metadata-en-postgres|ADR-0003]] y
>   [[adr/0006-watermark-en-captura|ADR-0006]] — las fotos van por una **cola
>   propia a R2**, separada del motor de sync; el watermark se graba **en la
>   captura**.
> - **Endurecimiento de fundaciones** (auditoría, jul 2026) — la revalidación de
>   geocerca ocurre en el servidor; en una alerta el usuario solo cambia el
>   `estado`; la contingencia (bypass) dispara alerta al supervisor.

---

## PRODUCTO 1 — App móvil del mercaderista

```
Sobre el prototipo v1 de la APP MÓVIL que ya construiste, aplica estos cambios.
Vienen de decisiones técnicas ya cerradas; no cambian el flujo, afinan cómo se
comporta.

1. INDICADOR Y COLA DE SINCRONIZACIÓN — ahora son DOS colas independientes, no
   una. El motor de sync (registros) y la subida de fotos (a un almacenamiento
   aparte) van por caminos distintos y a ritmos distintos:
   - El indicador siempre visible muestra los dos contadores por separado:
     "12 registros · 8 fotos" pendientes.
   - Una visita puede quedar SINCRONIZADA mientras sus fotos siguen subiendo.
     Refléjalo: la visita aparece como "enviada" y, aparte, "subiendo 3 de 12
     fotos" con barra de progreso y botón de reintento por foto.
   - No hay pantalla de resolución de conflictos: el servidor es la fuente de
     verdad. Si algo se re-sincroniza, gana el servidor, en silencio.
   - La pantalla de Sincronización (paso 6) separa visualmente ambas colas.

2. SEGUNDO FACTOR (pantalla de login):
   - Los canales que ofrece "Recibirlo por otro medio" son SOLO los que el panel
     habilitó para este cliente. Si el cliente solo tiene correo activo, no se
     ofrece SMS ni WhatsApp.
   - Añade un check "Recordar este dispositivo por 30 días": el segundo factor NO
     se pide en cada apertura, solo cuando el dispositivo no está recordado.
   - Al canjear un PASE DE ACCESO TEMPORAL en el campo de 6 dígitos, el usuario
     entra directo a "Mi día" (el pase produce una sesión válida, igual que un
     OTP correcto). Un pase vencido o ya usado muestra el error correspondiente.

3. FOTOS Y WATERMARK:
   - Reafirma el watermark grabado EN LA CAPTURA (hora + coordenadas + usuario),
     visible sobre el placeholder de cámara. No es un sello que se añade al subir.
   - Cada foto queda en una cola LOCAL en el teléfono hasta confirmarse su subida;
     sin señal, se acumulan y no se pierden. Muéstralo en el paso de captura
     ("guardada · pendiente de subir") y en la cola de fotos.

4. CHECK-OUT: se puede cerrar la visita aunque queden fotos EN COLA. El check-out
   valida los datos obligatorios del levantamiento, no que las fotos ya estén
   arriba (pueden tardar horas en subir). Deja claro en el resumen: "visita
   cerrada · 6 fotos subirán al recuperar señal".

Mantén todo lo demás del prototipo v1 igual (wizard secuencial, árbol de precios,
contingencia, geocerca, selector de marcas, ayuda "?").
```

---

## PRODUCTO 2 — Panel de gestión (admin + supervisor)

```
Sobre el prototipo v1 del PANEL DE GESTIÓN que ya construiste, aplica estos
cambios.

1. ACCESO Y SEGUNDO FACTOR (pantalla de admin) — los switches de canales de OTP
   (correo / SMS / WhatsApp) son una política GLOBAL de la outsourcing, una sola
   para toda la plataforma (no por cliente: el staff no pertenece a ningún
   cliente). El correo no se puede desactivar (es el canal por defecto
   obligatorio); SMS y WhatsApp son los que se suman.

2. ALTA Y GESTIÓN DE USUARIOS — el prototipo v1 lista usuarios; añade el FLUJO DE
   ALTA: crear usuario con rol (admin / supervisor / cliente / mercaderista),
   cliente-marca al que pertenece (obligatorio salvo staff), supervisor asignado
   (para mercaderistas) y teléfono. Y en la baja de un cliente, muestra la
   consecuencia antes de confirmar: "N mercaderistas perderán el acceso y sus
   teléfonos se purgarán al sincronizar".

3. IMPORTACIÓN DEL EXCEL DEL CLIENTE — el v1 asume una plantilla fija; añade el
   MAPEADOR DE COLUMNAS: el cliente sube SU Excel (columnas con sus propios
   nombres), el admin mapea cada columna del archivo a un campo del sistema una
   sola vez, y el mapeo queda guardado con un nombre para reutilizarlo. Tras el
   mapeo: vista previa fila por fila con los errores marcados, y aplicación
   TRANSACCIONAL (todo o nada). Un segundo import del mismo archivo actualiza, no
   duplica.

4. REVISIÓN DE REPORTES — al Aprobar o Rechazar una visita, el resultado ESCRIBE
   un estado de revisión (aprobada / rechazada + motivo) que el mercaderista verá
   en su app. Al rechazar, el motivo es obligatorio. Muestra el estado de
   revisión en la cola (pendiente / aprobada / rechazada).

5. TABLERO DEL DÍA (supervisor) — reafirma que el feed de ALERTAS DE CONTINGENCIA
   es en tiempo real: cuando un mercaderista usa el bypass en un paso, aparece una
   alerta nueva sin recargar, y el badge de no-atendidas se incrementa.

Mantén el resto del prototipo v1 igual (catálogo con mapa y geocerca, ruteros
drag & drop, tablas con filtros, ayuda "?" por sección).
```

---

## PRODUCTO 3 — Portal del cliente / marca

```
Sobre el prototipo v1 del PORTAL DEL CLIENTE que ya construiste, aplica estos
cambios. Son pocos: el portal es de solo lectura y los spikes casi no lo tocan.

1. ALERTAS — el catálogo de tipos ahora es explícito y hay que distinguirlos con
   claridad, porque el modelo los separa:
   - quiebre, DIFERENCIA DE STOCK (distinta del quiebre), desviación de precio,
     promoción no activa, exhibición incompleta, y CONTINGENCIA (la genera el
     bypass del mercaderista en campo).
   - El ciclo de estado es nueva → vista → resuelta, y es lo ÚNICO editable de una
     alerta (el resto es evidencia inmutable). Refleja que marcar el estado no
     cambia ningún otro dato.

2. MAPA — el proveedor de tiles aún no está decidido (spike abierto): mantén el
   mapa como placeholder interactivo con los pines verde/ámbar/rojo, sin
   comprometer un proveedor concreto.

3. GALERÍA Y DETALLE DE TIENDA — reafirma el comparador antes/después; las fotos
   se sirven con URLs firmadas de expiración corta (no son públicas), así que
   modela un estado de "cargando imagen" por si la firma tarda.

Mantén el resto del prototipo v1 igual (dashboard de KPIs con su ayuda "?"
explicando el cálculo, filtros globales persistentes, reportes con exportación).
```

---

## Notas de uso

1. **Una sesión por producto**, la misma donde vive el prototipo v1. Estos
   prompts son incrementales: no pegar el [[10 - Brief de Diseño UI]] otra vez.
2. **El orden de prioridad no cambia:** la app móvil sigue siendo el producto
   crítico (ver [[10 - Brief de Diseño UI]], Notas de uso).
3. Los prototipos v2 aprobados son los que alimentan los tickets de
   implementación de cada plataforma en Linear.
