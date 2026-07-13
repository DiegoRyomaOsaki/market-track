# ADR-0006 — Watermark grabado en la captura, no en la subida

- **Estado:** aceptado
- **Fecha:** 2026-06-18 (portado al registro el 2026-07-13)

## Contexto

La foto es la prueba de que el mercaderista estuvo donde dice que estuvo, a la
hora que dice, y de que la góndola quedó como dice. Sostiene dos cosas a la vez:
el valor comercial para la marca y el **blindaje laboral** de la outsourcing ante
la fiscalización peruana (SUNAFIL).

Y hay un hecho operativo que lo condiciona todo: **la subida puede ocurrir horas
después de la captura**, porque el trabajo pasa en sótanos sin señal.

## Opciones consideradas

| Opción | A favor | En contra |
|---|---|---|
| **Watermark grabado en el pixel al capturar** (hora, coordenadas, usuario) | La marca es contemporánea al hecho que documenta; la evidencia se sostiene sola | Hay que resolverlo en el cliente, sobre la cámara nativa, en gama media |
| Watermark añadido al subir (en el servidor) | Más simple, un solo sitio donde hacerlo | **No prueba nada.** Si la foto se sube seis horas después, la marca refleja la hora y el lugar de la *subida*, no los de la captura. Sería una prueba fabricada |
| Sin watermark, solo metadata en la BD | Trivial | La imagen deja de ser autónoma: separada de su fila, no dice nada. Y la metadata la escribe el cliente, así que es igual de manipulable |

## Decisión

El watermark —**hora, coordenadas y usuario**— se graba **en el pixel, en el
instante de la captura**. La galería del teléfono no participa en el flujo: solo
se admite cámara en vivo.

## Consecuencias

**Lo que ganamos.** Una evidencia que se sostiene fuera del sistema: la imagen,
sacada de contexto y enviada por correo a un cliente o a un inspector, sigue
diciendo cuándo y dónde se tomó.

**Lo que aceptamos a cambio.** Complejidad en el cliente móvil, sobre hardware de
gama media: hay que componer el texto sobre el fotograma en el momento de disparar
y comprimir sin destruir la marca. Qué librería lo resuelve es lo que decide el
spike de captura con watermark; **este ADR fija el principio, no la herramienta**.

Bloquear la galería es una molestia deliberada para el mercaderista. Es el precio
de que la foto valga como prueba.

**Cómo lo sabríamos si nos equivocamos.** Si el watermark degrada tanto el
rendimiento de captura en gama media que el levantamiento se vuelve inusable, o si
la marca resulta trivialmente falsificable en un dispositivo con la hora del
sistema alterada — riesgo que se mitiga revalidando en el servidor contra la hora
de servidor y la geocerca (PostGIS) al sincronizar.
