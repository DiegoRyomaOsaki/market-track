# ADR-0005 — La IA de Share of Shelf queda fuera del MVP

- **Estado:** aceptado
- **Fecha:** 2026-06-18 (portado al registro el 2026-07-13)

## Contexto

El documento original del cliente pide un "agente de IA" que analice la foto de la
góndola y cuente automáticamente los frentes propios frente a los de la
competencia. Es la funcionalidad más vistosa del producto y la más incierta: exige
elegir modelo, evaluar precisión sobre góndolas reales peruanas, y asumir un coste
por inferencia que crece con cada visita.

El piloto tiene presupuesto ajustado y una fecha comprometida.

## Opciones consideradas

| Opción | A favor | En contra |
|---|---|---|
| **Conteo manual en el MVP** | Coste cero, riesgo cero, funciona el primer día; el dato queda capturado igual | El mercaderista digita, lo que alarga el paso de Share of Shelf en tienda |
| IA de visión en el MVP | Funcionalidad estrella, argumento de licitación | Coste e incertidumbre altos justo donde el piloto no puede permitírselos. Una precisión mediocre destruye la confianza en el dato *y* en el resto del producto |

## Decisión

En el piloto, el Share of Shelf se captura **a mano**. La IA se pospone a una
**Fase 2 pagada**, y se diseñará **agnóstica al modelo** para no quedar atada a un
proveedor.

## Consecuencias

**Lo que ganamos.** El piloto no depende de que un modelo de visión funcione bien
sobre una góndola mal iluminada de Plaza Vea. Y como la captura manual ya deja el
dato estructurado, la IA de Fase 2 tendrá **un conjunto de datos etiquetado por
humanos** contra el que medirse — que es justo lo que hace falta para evaluarla en
serio.

**Lo que aceptamos a cambio.** Tiempo del mercaderista en tienda. El coste sube
con la decisión (revisión con el cliente, julio 2026) de capturar el Share of
Shelf **también por SKU**: son 15–25 SKUs por visita, y ese es hoy el paso más
largo del levantamiento.

**Cómo lo sabríamos si nos equivocamos.** Si en las pruebas de campo el paso de
Share of Shelf resulta tan lento que los mercaderistas empiezan a despacharlo con
datos inventados. Un dato manual poco fiable es peor que no tener el dato.
