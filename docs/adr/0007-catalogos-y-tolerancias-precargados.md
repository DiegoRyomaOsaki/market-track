# ADR-0007 — Catálogos y tolerancias pre-cargados por marca

- **Estado:** aceptado
- **Fecha:** 2026-06-18 (portado al registro el 2026-07-13)

## Contexto

El levantamiento no funciona sin datos maestros previos. El mercaderista debe ver
la **lista exacta de SKUs codificados en esa tienda**, y la app debe conocer el
**precio regular** y las **promociones vigentes** para poder detectar una
desviación en el momento.

Además, cada marca tolera una desviación de precio distinta: lo que para una es
una alerta, para otra es ruido.

**El documento del cliente lo exige explícitamente**: pide que los precios
regulares, las promociones vigentes y las exhibiciones negociadas estén
"pre-cargados" en la app. No es solo una preferencia técnica nuestra.

## Opciones consideradas

| Opción | A favor | En contra |
|---|---|---|
| **Pre-carga por marca, configurable desde el panel** | El motor de alertas compara contra un valor esperado real; cambiar una tolerancia o una promo **no requiere desplegar** | Sin una pre-carga correcta, la app del mercaderista no sirve: la calidad del dato depende de un trabajo de tablas y formularios |
| Umbrales fijos en el código | Nada que configurar | Cada cambio de tolerancia es un despliegue. Y una tolerancia única para todas las marcas es sencillamente falsa |
| Que el mercaderista introduzca el precio esperado | Cero pre-carga | Destruye el propósito: si el dato de referencia lo pone la misma persona que reporta, no hay desviación que detectar |

## Decisión

Los **catálogos** (cadenas, tiendas, SKUs, matriz de codificación tienda × SKU),
los **precios regulares**, las **promociones** y las **tolerancias de desviación**
se pre-cargan por marca desde el panel de administración. Son datos, no código.

## Consecuencias

**Lo que ganamos.** El motor de alertas tiene contra qué comparar, y el negocio
ajusta sus umbrales sin tocar el repositorio ni esperar un despliegue.

**Lo que aceptamos a cambio.** La pre-carga se convierte en una **dependencia
operativa crítica**: si la matriz de codificación de una tienda está mal, el
mercaderista verá SKUs que esa tienda no vende y no verá los que sí — y el dato
del día queda inservible. Es trabajo denso, poco frecuente y sin margen de error,
así que el panel de admin debe tratarlo como tal (carga masiva, validación,
ayuda contextual en cada sección).

**Cómo lo sabríamos si nos equivocamos.** Si en el piloto los mercaderistas
reportan sistemáticamente SKUs ausentes o precios de referencia que no cuadran, el
problema no estará en la app: estará en la pre-carga, y significará que el flujo
de mantenimiento del catálogo no es viable para el cliente.
