-- `exhibicion_negociada` no tenía clave natural.
--
-- `precio_regular` y `promocion` la recibieron en
-- `20260714220000_endurecimiento_fundaciones.sql`, pero exhibiciones se quedó
-- solo con `unique (id, tenant_id)`, que no impide nada: es el id contra sí
-- mismo. Cargar dos veces el mismo trato creaba dos filas, y el motor de alertas
-- disparaba `exhibicion_incompleta` por duplicado sobre la misma cabecera.
--
-- La clave es el hecho comercial: una marca negocia UN espacio de UN tipo en UNA
-- tienda a partir de UNA fecha. Lleva `fecha_inicio` a propósito — sin ella,
-- renegociar la misma cabecera para el mes siguiente exigiría borrar el trato
-- anterior y con él su histórico.
--
--   Oster · Plaza Vea Angamos · cabecera · 01-jul   una sola vez
--   Oster · Plaza Vea Angamos · isla     · 01-jul   trato distinto, entra
--   Oster · Plaza Vea Angamos · cabecera · 01-ago   renegociada, entra
--
-- Ninguna columna de la clave es nullable, así que no hace falta
-- `nulls not distinct` (sí lo necesitaba `precio_regular` por su `tipo_tienda`).

alter table public.exhibicion_negociada
  add constraint exh_neg_natural_uq
  unique (tenant_id, tienda_id, marca_id, tipo, fecha_inicio);

comment on constraint exh_neg_natural_uq on public.exhibicion_negociada is
  'El trato comercial: una marca, un tipo de espacio, una tienda, una fecha de inicio. Cargarlo dos veces actualiza en vez de duplicar.';
