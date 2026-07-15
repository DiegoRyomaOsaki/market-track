-- Motor de alertas. Las alertas las produce el SERVIDOR al sincronizar, no las
-- apps: `authenticated` no tiene INSERT en `alerta` a propósito. Estas funciones
-- son SECURITY DEFINER (corren como el dueño) para poder escribirlas.
--
-- Se disparan en el INSERT de las tablas de campo (no en UPDATE): el dato se
-- captura una vez cuando el mercaderista completa el paso. Disparar también en
-- UPDATE duplicaría la alerta en cada corrección.

-- Helper único de inserción. SECURITY DEFINER + search_path vacío.
create function app.crear_alerta(
  p_tenant    uuid,
  p_tipo      public.tipo_alerta,
  p_marca     uuid,
  p_visita    uuid,
  p_severidad public.severidad_alerta,
  p_payload   jsonb
) returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.alerta (tenant_id, tipo, marca_id, visita_id, severidad, payload)
  values (p_tenant, p_tipo, p_marca, p_visita, p_severidad, p_payload);
$$;

-- CRÍTICO: sin este revoke, cualquier usuario podría llamar crear_alerta (es
-- SECURITY DEFINER y salta RLS) e inyectar alertas en cualquier tenant. Por
-- defecto Postgres concede EXECUTE a PUBLIC al crear una función.
revoke execute on function
  app.crear_alerta(uuid, public.tipo_alerta, uuid, uuid, public.severidad_alerta, jsonb)
  from public;

-- ---------------------------------------------------------------------------
-- Levantamiento por SKU: quiebre, diferencia y el árbol de decisión de precios.
-- ---------------------------------------------------------------------------
create function app.alertas_levantamiento_sku()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  lev     record;   -- marca_id, visita_id del levantamiento padre
  cadena  uuid;
  regular numeric;
  tol     numeric;
  promo   record;
begin
  select l.marca_id, l.visita_id into lev
  from public.levantamiento l where l.id = new.levantamiento_id;

  -- Quiebre y diferencia: los flags ya vienen calculados (columnas generadas).
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

  -- Árbol de precios: solo si el mercaderista digitó un precio.
  if new.precio_registrado is not null then
    select t.cadena_id into cadena
    from public.visita v join public.tienda t on t.id = v.tienda_id
    where v.id = lev.visita_id;

    -- Precio regular vigente: el general de la cadena (tipo_tienda nulo) primero,
    -- el más reciente. La tienda no lleva tipo_tienda, así que no se resuelve por tipo.
    select pr.precio into regular
    from public.precio_regular pr
    where pr.tenant_id = new.tenant_id and pr.sku_id = new.sku_id and pr.cadena_id = cadena
    order by pr.tipo_tienda nulls first, pr.vigente_desde desc
    limit 1;

    select coalesce(m.tolerancia_precio_pct, 0) into tol
    from public.marca m where m.id = lev.marca_id;

    if regular is not null then
      if new.precio_registrado > regular * (1 + tol / 100) then
        -- Sobreprecio: por encima del regular más allá de la tolerancia.
        perform app.crear_alerta(new.tenant_id, 'desviacion_precio', lev.marca_id, lev.visita_id, 'alta',
          jsonb_build_object('sku_id', new.sku_id, 'precio_registrado', new.precio_registrado,
            'precio_regular', regular, 'motivo', 'sobreprecio'));
      elsif new.precio_registrado < regular * (1 - tol / 100) then
        -- Por debajo del regular: debería haber una promo activa comunicada.
        select p.comunicada into promo
        from public.promocion p
        where p.tenant_id = new.tenant_id and p.sku_id = new.sku_id
          and current_date between p.fecha_inicio and p.fecha_fin
        order by p.fecha_inicio desc limit 1;

        if promo.comunicada is true then
          null; -- Promo legítima y comunicada: sin alerta.
        elsif new.hay_promo and not coalesce(new.promo_comunicada, false) then
          -- El mercaderista vio una promo NO comunicada en tienda.
          perform app.crear_alerta(new.tenant_id, 'promo_no_activa', lev.marca_id, lev.visita_id, 'alta',
            jsonb_build_object('sku_id', new.sku_id, 'precio_registrado', new.precio_registrado,
              'precio_regular', regular));
        else
          -- Precio por debajo del regular sin promo que lo justifique.
          perform app.crear_alerta(new.tenant_id, 'desviacion_precio', lev.marca_id, lev.visita_id, 'alta',
            jsonb_build_object('sku_id', new.sku_id, 'precio_registrado', new.precio_registrado,
              'precio_regular', regular, 'motivo', 'subvaluado_sin_promo'));
        end if;
      end if;
    end if;
  end if;

  return null;
end;
$$;
revoke execute on function app.alertas_levantamiento_sku() from public;

create trigger alertas_levantamiento_sku
  after insert on public.levantamiento_sku
  for each row execute function app.alertas_levantamiento_sku();

-- ---------------------------------------------------------------------------
-- Contingencia (bypass): alerta al supervisor en tiempo real.
-- ---------------------------------------------------------------------------
create function app.alertas_contingencia()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  marca uuid;
begin
  if new.levantamiento_id is not null then
    select l.marca_id into marca from public.levantamiento l where l.id = new.levantamiento_id;
  end if;
  perform app.crear_alerta(new.tenant_id, 'contingencia', marca, new.visita_id, 'alta',
    jsonb_build_object('paso', new.paso, 'motivo', new.motivo));
  return null;
end;
$$;
revoke execute on function app.alertas_contingencia() from public;

create trigger alertas_contingencia
  after insert on public.contingencia
  for each row execute function app.alertas_contingencia();

-- ---------------------------------------------------------------------------
-- Exhibición: instalada pero incompleta.
-- ---------------------------------------------------------------------------
create function app.alertas_exhibicion()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  lev record;
begin
  if new.instalada is true and new.completa is false then
    select l.marca_id, l.visita_id into lev
    from public.levantamiento l where l.id = new.levantamiento_id;
    perform app.crear_alerta(new.tenant_id, 'exhibicion_incompleta', lev.marca_id, lev.visita_id, 'info',
      jsonb_build_object('exhibicion_id', new.id, 'unidades', new.unidades));
  end if;
  return null;
end;
$$;
revoke execute on function app.alertas_exhibicion() from public;

create trigger alertas_exhibicion
  after insert on public.exhibicion
  for each row execute function app.alertas_exhibicion();
