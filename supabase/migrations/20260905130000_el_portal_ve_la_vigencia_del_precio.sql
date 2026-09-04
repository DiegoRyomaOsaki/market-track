-- El detalle de alerta dice DESDE CUÁNDO rige el precio esperado.
--
-- El cliente-marca ya veía "precio esperado S/ 6.90", pero no desde cuándo lo
-- era. Sin la ventana, un precio que cambió en agosto y una alerta de julio se
-- leen como una contradicción, y la pregunta al supervisor es siempre la misma.
--
-- Se resuelve a la FECHA DE LA VISITA y no a la de hoy, con el mismo instante
-- que usó el motor: `check_in_recibido_at` —el sello del SERVIDOR— y no
-- `check_in_at`, que lo escribe el teléfono. Así el portal enseña la ventana
-- contra la que de verdad se evaluó, no una recalculada hoy que podría no
-- coincidir.
--
-- Sale por el resolvedor único: la pantalla no reimplementa el desempate.

create or replace function public.detalle_alerta(p_alerta_id uuid)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_build_object(
    'id', a.id,
    'tipo', a.tipo,
    'severidad', a.severidad,
    'estado', a.estado,
    'creado_at', a.creado_at,
    'payload', a.payload,
    'tienda_nombre', t.nombre,
    'cadena_nombre', ca.nombre,
    'marca_nombre', ma.nombre,
    'sku_codigo', sk.codigo,
    'sku_nombre', sk.nombre,
    'visita_id', a.visita_id,
    'visita_check_in_at', v.check_in_at,
    'precio_vigente_desde', pr.vigente_desde,
    'precio_vigente_hasta', pr.vigente_hasta,
    'foto', app.foto_de_la_alerta(a.visita_id, a.marca_id, a.tipo, a.payload)
  )
  from public.alerta a
  left join public.visita v on v.id = a.visita_id
  left join public.tienda t on t.id = v.tienda_id
  left join public.cadena ca on ca.id = t.cadena_id
  left join public.marca ma on ma.id = a.marca_id
  left join public.sku sk on sk.id = app.uuid_del_payload(a.payload, 'sku_id')
  -- `left join lateral` y no dos llamadas a la función: con dos, el resolvedor
  -- se evalúa una vez por cada campo que se lee de él.
  left join lateral app.precio_regular_vigente(
    a.tenant_id, sk.id, t.cadena_id,
    (v.check_in_recibido_at at time zone 'America/Lima')::date) pr on true
  where a.id = p_alerta_id
    -- La verja: con el módulo apagado, el mismo null indistinguible de "no
    -- existe o no es del tenant" — no se confirma la existencia de la alerta.
    and (select app.modulo_habilitado('alertas'));
$$;

comment on function public.detalle_alerta(uuid) is
  'El detalle de una alerta para el portal del cliente, con la ventana de vigencia del precio esperado resuelta a la fecha de la visita. Devuelve null —indistinguible de "no existe"— si el módulo de alertas está apagado para ese cliente.';
