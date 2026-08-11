-- La regla de precio y promoción, extraída del motor de alertas.
--
-- Hasta ahora el árbol de decisión vivía DENTRO de
-- `app.alertas_levantamiento_sku()`, mezclado con la creación de alertas. El
-- puntaje de Perfect Store necesita exactamente la misma regla —"un SKU cuenta
-- como correcto si está dentro de la tolerancia y la promo está comunicada"— y
-- copiarla habría dejado dos reglas de precio que divergen a la primera
-- corrección. Un solo dueño.
--
-- Devuelve un VEREDICTO y no un booleano: las alertas necesitan saber CUÁL de los
-- casos se dio para elegir el tipo de alerta, y el puntaje necesita distinguir
-- "no se pudo evaluar" de "estaba mal". Un booleano perdería las dos cosas.

create type public.evaluacion_precio as enum (
  -- No hay precio regular vigente contra el que comparar: no es un fallo del
  -- punto de venta, es que falta el maestro. No entra en el denominador.
  'sin_precio_vigente',
  'correcto',
  'sobreprecio',
  -- Por debajo del regular y el mercaderista vio una promo SIN comunicar.
  'promo_no_comunicada',
  -- Por debajo del regular sin ninguna promo que lo justifique.
  'subvaluado_sin_promo'
);

/*
 * El árbol de precio de un SKU levantado.
 *
 * `p_fecha` es la fecha de la VISITA, no `current_date`. El motor de alertas
 * evaluaba con el día en curso —correcto para él, que corre al insertar— pero el
 * puntaje se puede recalcular meses después, y entonces la promo vigente "hoy"
 * no es la que estaba activa cuando el mercaderista miró la góndola.
 */
create function app.evaluar_precio_sku(
  p_tenant           uuid,
  p_sku              uuid,
  p_marca            uuid,
  p_cadena           uuid,
  p_precio           numeric,
  p_hay_promo        boolean,
  p_promo_comunicada boolean,
  p_fecha            date
)
returns public.evaluacion_precio
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_regular numeric;
  v_tol     numeric;
  v_promo_comunicada boolean;
begin
  if p_precio is null then return 'sin_precio_vigente'; end if;

  -- El general de la cadena (tipo_tienda nulo) primero, el más reciente. La
  -- tienda no lleva tipo_tienda, así que no se resuelve por tipo.
  select pr.precio into v_regular
  from public.precio_regular pr
  where pr.tenant_id = p_tenant and pr.sku_id = p_sku and pr.cadena_id = p_cadena
    and pr.vigente_desde <= p_fecha
  order by pr.tipo_tienda nulls first, pr.vigente_desde desc
  limit 1;

  if v_regular is null then return 'sin_precio_vigente'; end if;

  select coalesce(m.tolerancia_precio_pct, 0) into v_tol
  from public.marca m where m.id = p_marca;
  v_tol := coalesce(v_tol, 0);

  if p_precio > v_regular * (1 + v_tol / 100) then
    return 'sobreprecio';
  end if;

  if p_precio >= v_regular * (1 - v_tol / 100) then
    return 'correcto';
  end if;

  -- Por debajo del regular: solo una promo vigente y comunicada lo justifica.
  select p.comunicada into v_promo_comunicada
  from public.promocion p
  where p.tenant_id = p_tenant and p.sku_id = p_sku
    and p_fecha between p.fecha_inicio and p.fecha_fin
  order by p.fecha_inicio desc
  limit 1;

  if v_promo_comunicada is true then return 'correcto'; end if;
  if coalesce(p_hay_promo, false) and not coalesce(p_promo_comunicada, false) then
    return 'promo_no_comunicada';
  end if;
  return 'subvaluado_sin_promo';
end;
$$;

revoke execute on function app.evaluar_precio_sku(
  uuid, uuid, uuid, uuid, numeric, boolean, boolean, date) from public;
grant execute on function app.evaluar_precio_sku(
  uuid, uuid, uuid, uuid, numeric, boolean, boolean, date)
  to authenticated, service_role;

comment on function app.evaluar_precio_sku(uuid, uuid, uuid, uuid, numeric, boolean, boolean, date) is
  'El árbol de precio y promoción de un SKU levantado, en la fecha de la visita. Único dueño de la regla: lo usan el motor de alertas y el puntaje de Perfect Store.';

-- ---------------------------------------------------------------------------
-- El trigger de alertas pasa a apoyarse en la función.
--
-- Se recrea entero porque una función es su cuerpo. Lo único que cambia es el
-- bloque de precios: ahora traduce el veredicto a su alerta en vez de decidirlo.
-- El comportamiento observable es el mismo, y los tests de alertas lo fijan.
-- ---------------------------------------------------------------------------
create or replace function app.alertas_levantamiento_sku()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  lev       record;
  v_cadena  uuid;
  v_fecha   date;
  v_regular numeric;
  v_veredicto public.evaluacion_precio;
begin
  select l.marca_id, l.visita_id into lev
  from public.levantamiento l where l.id = new.levantamiento_id;

  if new.quiebre then
    perform app.crear_alerta(new.tenant_id, 'quiebre', lev.marca_id, lev.visita_id, 'alta',
      jsonb_build_object('sku_id', new.sku_id,
        'stock_sistema', new.stock_sistema, 'stock_piso', new.stock_piso));
  end if;
  if new.diferencia then
    perform app.crear_alerta(new.tenant_id, 'diferencia_stock', lev.marca_id, lev.visita_id, 'info',
      jsonb_build_object('sku_id', new.sku_id,
        'stock_sistema', new.stock_sistema, 'stock_piso', new.stock_piso,
        'delta', new.stock_piso - new.stock_sistema));
  end if;

  if new.precio_registrado is not null then
    -- El día del negocio es el de Lima, no el de UTC: entre las 19:00 y
    -- medianoche, `current_date` ya rodó al día siguiente y la promo de ayer
    -- dejaría de encontrarse.
    select t.cadena_id, (v.check_in_recibido_at at time zone 'America/Lima')::date
      into v_cadena, v_fecha
    from public.visita v join public.tienda t on t.id = v.tienda_id
    where v.id = lev.visita_id;

    v_veredicto := app.evaluar_precio_sku(
      new.tenant_id, new.sku_id, lev.marca_id, v_cadena, new.precio_registrado,
      new.hay_promo, new.promo_comunicada, v_fecha);

    if v_veredicto <> 'correcto' and v_veredicto <> 'sin_precio_vigente' then
      -- El precio regular solo se relee para el payload: la decisión ya está
      -- tomada arriba, y esta consulta no puede cambiarla.
      select pr.precio into v_regular
      from public.precio_regular pr
      where pr.tenant_id = new.tenant_id and pr.sku_id = new.sku_id
        and pr.cadena_id = v_cadena and pr.vigente_desde <= v_fecha
      order by pr.tipo_tienda nulls first, pr.vigente_desde desc
      limit 1;
    end if;

    if v_veredicto = 'sobreprecio' then
      perform app.crear_alerta(new.tenant_id, 'desviacion_precio', lev.marca_id, lev.visita_id, 'alta',
        jsonb_build_object('sku_id', new.sku_id, 'precio_registrado', new.precio_registrado,
          'precio_regular', v_regular, 'motivo', 'sobreprecio'));
    elsif v_veredicto = 'promo_no_comunicada' then
      perform app.crear_alerta(new.tenant_id, 'promo_no_activa', lev.marca_id, lev.visita_id, 'alta',
        jsonb_build_object('sku_id', new.sku_id, 'precio_registrado', new.precio_registrado,
          'precio_regular', v_regular));
    elsif v_veredicto = 'subvaluado_sin_promo' then
      perform app.crear_alerta(new.tenant_id, 'desviacion_precio', lev.marca_id, lev.visita_id, 'alta',
        jsonb_build_object('sku_id', new.sku_id, 'precio_registrado', new.precio_registrado,
          'precio_regular', v_regular, 'motivo', 'subvaluado_sin_promo'));
    end if;
  end if;

  return null;
end;
$$;

revoke execute on function app.alertas_levantamiento_sku() from public;
