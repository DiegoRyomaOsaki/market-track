# ADR-0003 — Fotos en Cloudflare R2, metadata en Postgres

- **Estado:** aceptado
- **Fecha:** 2026-06-18 (portado al registro el 2026-07-13)

## Contexto

Las fotos son el mayor volumen de datos del sistema y el corazón de la evidencia:
selfie de ingreso, góndola antes y después, exhibiciones, carteles de promoción.
En el piloto se estiman decenas de miles de imágenes al mes, y el volumen crece
con cada mercaderista.

Al mismo tiempo, cada foto necesita consultarse en relación con su visita, su
tienda y su SKU (galería filtrable, comparador antes/después, evidencia de una
alerta).

## Opciones consideradas

| Opción | A favor | En contra |
|---|---|---|
| **Binarios en R2 + metadata en Postgres** | R2 **no cobra egreso**, que es donde se dispara la factura al servir galerías; Postgres conserva las relaciones y los filtros | Dos sistemas que mantener consistentes; una foto puede existir en uno y no en el otro |
| Todo en Supabase Storage | Un solo proveedor, integración directa con RLS | Más caro a volumen, y el egreso se paga |
| Binarios en Postgres (`bytea`) | Consistencia transaccional total | Infla la base, encarece los respaldos y degrada las consultas. Antipatrón conocido |

## Decisión

Los **binarios** viven en **Cloudflare R2**, servidos siempre con **URLs firmadas
de expiración corta** emitidas por una Edge Function que valida rol y marca. La
**metadata** (url, hash, coordenadas, hora de captura, tipo) vive en Postgres.

## Consecuencias

**Lo que ganamos.** El renglón más caro del sistema (almacenamiento y egreso de
imágenes) se abarata, y las consultas relacionales sobre la evidencia siguen
siendo SQL normal.

**Lo que aceptamos a cambio.** Las fotos **no viajan por el motor de
sincronización**: necesitan su propio canal (cola en disco en el móvil, subida
con reintentos). Eso significa que existen dos caminos de datos distintos y que
la metadata puede quedar sincronizada antes de que la imagen exista en R2 — la UI
debe tolerar ese estado intermedio, y el borrado debe distinguir "confirmado que
no está" de "no se pudo comprobar".

Ninguna foto se sirve con URL pública. Una URL de R2 sin firmar es una fuga de
evidencia de un cliente, accesible por cualquiera que la tenga.

**Cómo lo sabríamos si nos equivocamos.** Si aparecen filas de `foto` cuya imagen
nunca llegó a R2 y no hay forma de reconciliarlas, o si el coste de R2 crece por
encima de lo previsto al activarse la foto opcional por SKU del Share of Shelf.
