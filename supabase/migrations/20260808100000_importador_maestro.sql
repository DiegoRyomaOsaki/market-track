-- La aplicación del maestro comercial que el cliente manda en un Excel.
--
-- Vive en una función porque una función es una transacción implícita: si algo
-- revienta a mitad, Postgres revierte TODO. Es el único modo de tener "todo o
-- nada" sobre siete tablas desde el cliente — PostgREST no da transacciones
-- multi-sentencia.
--
-- `security invoker`: las políticas `*_admin_escribe` de las siete tablas son las
-- que autorizan. No hace falta `service_role`: el admin ya puede escribir el
-- maestro, y saltarse la RLS crearía un segundo dueño de una regla que ya existe.
--
-- El LOTE LLEGA YA VALIDADO. La validación fila por fila ocurre en la frontera,
-- en TypeScript, antes de llamar aquí — es un criterio de aceptación. Esta función
-- no valida datos: comprueba invariantes que solo la base puede ver.

create function public.aplicar_importacion(
  p_importacion_id uuid,
  p_lote jsonb
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_tenant  uuid;
  v_estado  public.estado_importacion;
  v_activo  boolean;
  v_resumen jsonb := '{}'::jsonb;
  v_n       integer;
  v_esperadas integer;
begin
  if (select app.rol_actual()) <> 'admin' then
    -- Sin esta guarda el operador vería un 42501 de la primera tabla que toque,
    -- que parece un fallo del sistema. La RLS sigue siendo el portero real.
    raise exception 'solo un administrador aplica una importación'
      using errcode = 'insufficient_privilege';
  end if;

  -- Dos admins aplicando a la vez al mismo cliente se darían un deadlock en los
  -- mismos `on conflict`. Con el lock, el segundo espera su turno.
  perform pg_advisory_xact_lock(
    hashtext('aplicar_importacion'), hashtext(p_importacion_id::text));

  -- El tenant sale de la FILA, nunca de un parámetro: un lote no puede elegir en
  -- qué cliente escribe. Si quien llama no puede leer la fila —un cliente con un
  -- id ajeno—, esto lanza NO_DATA_FOUND y falla cerrado.
  select i.tenant_id, i.estado into strict v_tenant, v_estado
  from public.importacion i
  where i.id = p_importacion_id
  for update;

  if v_estado <> 'previsualizada' then
    -- La guarda anti-doble-aplicación: una importación ya aplicada no se repite.
    raise exception 'la importación está en estado % y solo se aplica una previsualizada', v_estado
      using errcode = 'check_violation';
  end if;

  select t.activo into v_activo from public.tenant t where t.id = v_tenant;
  if not coalesce(v_activo, false) then
    raise exception 'el cliente está dado de baja'
      using errcode = 'check_violation';
  end if;

  -- --- Las siete entidades, en orden de dependencia --------------------------
  --
  -- marca y cadena no dependen de nada; sku cuelga de marca; tienda de cadena;
  -- tienda_sku de las dos; precio de sku y cadena; promoción de sku.
  --
  -- NINGÚN `on conflict do update` toca `activo`. Dos consecuencias, las dos
  -- deliberadas: una fila que desaparece del Excel nuevo SIGUE ACTIVA (es un
  -- criterio de aceptación), y una que el admin desactivó a mano no se reactiva
  -- sola por seguir apareciendo en el archivo. `activo` tiene un solo dueño: el
  -- panel.

  insert into public.marca (tenant_id, codigo_externo, nombre, tolerancia_precio_pct)
  select v_tenant, f.codigo_externo, f.nombre,
         coalesce(f.tolerancia_precio_pct, 0)
  from jsonb_to_recordset(coalesce(p_lote->'marca', '[]'::jsonb))
    as f(codigo_externo text, nombre text, tolerancia_precio_pct numeric)
  on conflict (tenant_id, codigo_externo) do update
    set nombre = excluded.nombre,
        tolerancia_precio_pct = excluded.tolerancia_precio_pct;
  get diagnostics v_n = row_count;
  v_resumen := v_resumen || jsonb_build_object('marca', v_n);

  insert into public.cadena (tenant_id, codigo_externo, nombre, tipo_tienda)
  select v_tenant, f.codigo_externo, f.nombre, f.tipo_tienda
  from jsonb_to_recordset(coalesce(p_lote->'cadena', '[]'::jsonb))
    as f(codigo_externo text, nombre text, tipo_tienda public.tipo_tienda)
  on conflict (tenant_id, codigo_externo) do update
    set nombre = excluded.nombre,
        -- `coalesce`: una celda vacía no borra lo que ya había. Por el importador
        -- se puede cambiar un campo opcional, no vaciarlo.
        tipo_tienda = coalesce(excluded.tipo_tienda, public.cadena.tipo_tienda);
  get diagnostics v_n = row_count;
  v_resumen := v_resumen || jsonb_build_object('cadena', v_n);

  insert into public.sku (tenant_id, codigo_externo, marca_id, codigo, nombre,
                          presentacion, codigo_barras)
  select v_tenant, f.codigo_externo, m.id, f.codigo, f.nombre,
         f.presentacion, f.codigo_barras
  from jsonb_to_recordset(coalesce(p_lote->'sku', '[]'::jsonb))
    as f(codigo_externo text, marca_codigo_externo text, codigo text,
         nombre text, presentacion text, codigo_barras text)
  join public.marca m
    on m.tenant_id = v_tenant and m.codigo_externo = f.marca_codigo_externo
  on conflict (tenant_id, codigo_externo) do update
    set marca_id = excluded.marca_id,
        codigo = excluded.codigo,
        nombre = excluded.nombre,
        presentacion = coalesce(excluded.presentacion, public.sku.presentacion),
        codigo_barras = coalesce(excluded.codigo_barras, public.sku.codigo_barras);
  get diagnostics v_n = row_count;
  -- El `join` de arriba DESCARTA en silencio una fila cuya marca no exista, y el
  -- import diría "aplicado" con SKUs faltando. La validación en TypeScript ya lo
  -- impide; esto es la segunda red, dentro de la transacción.
  v_esperadas := jsonb_array_length(coalesce(p_lote->'sku', '[]'::jsonb));
  if v_n <> v_esperadas then
    raise exception 'sku: llegaron % filas y se escribieron % — hay una marca sin resolver',
      v_esperadas, v_n using errcode = 'data_exception';
  end if;
  v_resumen := v_resumen || jsonb_build_object('sku', v_n);

  insert into public.tienda (tenant_id, codigo_externo, cadena_id, nombre,
                             direccion, ubicacion, radio_geocerca_m, cluster)
  select v_tenant, f.codigo_externo, c.id, f.nombre, f.direccion,
         case when f.lat is null or f.lon is null then null
              else extensions.ST_SetSRID(
                     extensions.ST_MakePoint(f.lon, f.lat), 4326)::extensions.geography
         end,
         coalesce(f.radio_geocerca_m, 100),
         f.cluster
  from jsonb_to_recordset(coalesce(p_lote->'tienda', '[]'::jsonb))
    as f(codigo_externo text, cadena_codigo_externo text, nombre text,
         direccion text, lat double precision, lon double precision,
         radio_geocerca_m integer, cluster text)
  join public.cadena c
    on c.tenant_id = v_tenant and c.codigo_externo = f.cadena_codigo_externo
  on conflict (tenant_id, codigo_externo) do update
    set cadena_id = excluded.cadena_id,
        nombre = excluded.nombre,
        direccion = coalesce(excluded.direccion, public.tienda.direccion),
        -- Una tienda sin coordenadas en el Excel conserva la geocerca que el
        -- panel le puso: borrarla dejaría a los mercaderistas sin poder fichar.
        ubicacion = coalesce(excluded.ubicacion, public.tienda.ubicacion),
        radio_geocerca_m = excluded.radio_geocerca_m,
        cluster = coalesce(excluded.cluster, public.tienda.cluster);
  get diagnostics v_n = row_count;
  v_esperadas := jsonb_array_length(coalesce(p_lote->'tienda', '[]'::jsonb));
  if v_n <> v_esperadas then
    raise exception 'tienda: llegaron % filas y se escribieron % — hay una cadena sin resolver',
      v_esperadas, v_n using errcode = 'data_exception';
  end if;
  v_resumen := v_resumen || jsonb_build_object('tienda', v_n);

  insert into public.tienda_sku (tenant_id, tienda_id, sku_id)
  select v_tenant, t.id, s.id
  from jsonb_to_recordset(coalesce(p_lote->'tienda_sku', '[]'::jsonb))
    as f(tienda_codigo_externo text, sku_codigo_externo text)
  join public.tienda t
    on t.tenant_id = v_tenant and t.codigo_externo = f.tienda_codigo_externo
  join public.sku s
    on s.tenant_id = v_tenant and s.codigo_externo = f.sku_codigo_externo
  -- Sin `do update` no habría nada que actualizar —la fila es solo el vínculo—,
  -- pero `do nothing` haría que el contador de abajo no distinguiera "ya estaba"
  -- de "no se resolvió". Se toca `tenant_id`, que es el mismo valor.
  on conflict (tienda_id, sku_id) do update set tenant_id = excluded.tenant_id;
  get diagnostics v_n = row_count;
  v_esperadas := jsonb_array_length(coalesce(p_lote->'tienda_sku', '[]'::jsonb));
  if v_n <> v_esperadas then
    raise exception 'tienda_sku: llegaron % filas y se escribieron % — hay una tienda o un sku sin resolver',
      v_esperadas, v_n using errcode = 'data_exception';
  end if;
  v_resumen := v_resumen || jsonb_build_object('tienda_sku', v_n);

  insert into public.precio_regular (tenant_id, sku_id, cadena_id, tipo_tienda,
                                     precio, vigente_desde)
  select v_tenant, s.id, c.id, f.tipo_tienda, f.precio, f.vigente_desde
  from jsonb_to_recordset(coalesce(p_lote->'precio_regular', '[]'::jsonb))
    as f(sku_codigo_externo text, cadena_codigo_externo text,
         tipo_tienda public.tipo_tienda, precio numeric, vigente_desde date)
  join public.sku s
    on s.tenant_id = v_tenant and s.codigo_externo = f.sku_codigo_externo
  join public.cadena c
    on c.tenant_id = v_tenant and c.codigo_externo = f.cadena_codigo_externo
  -- La clave lleva `nulls not distinct`, así que dos precios sin tipo de tienda
  -- colisionan en vez de duplicarse. Sin eso, cada import crearía uno nuevo.
  on conflict (tenant_id, sku_id, cadena_id, tipo_tienda, vigente_desde) do update
    set precio = excluded.precio;
  get diagnostics v_n = row_count;
  v_esperadas := jsonb_array_length(coalesce(p_lote->'precio_regular', '[]'::jsonb));
  if v_n <> v_esperadas then
    raise exception 'precio_regular: llegaron % filas y se escribieron % — hay un sku o una cadena sin resolver',
      v_esperadas, v_n using errcode = 'data_exception';
  end if;
  v_resumen := v_resumen || jsonb_build_object('precio_regular', v_n);

  insert into public.promocion (tenant_id, sku_id, precio_promo, fecha_inicio,
                                fecha_fin, comunicada)
  select v_tenant, s.id, f.precio_promo, f.fecha_inicio, f.fecha_fin,
         coalesce(f.comunicada, false)
  from jsonb_to_recordset(coalesce(p_lote->'promocion', '[]'::jsonb))
    as f(sku_codigo_externo text, precio_promo numeric, fecha_inicio date,
         fecha_fin date, comunicada boolean)
  join public.sku s
    on s.tenant_id = v_tenant and s.codigo_externo = f.sku_codigo_externo
  on conflict (tenant_id, sku_id, fecha_inicio) do update
    set precio_promo = excluded.precio_promo,
        fecha_fin = excluded.fecha_fin,
        comunicada = excluded.comunicada;
  get diagnostics v_n = row_count;
  v_esperadas := jsonb_array_length(coalesce(p_lote->'promocion', '[]'::jsonb));
  if v_n <> v_esperadas then
    raise exception 'promocion: llegaron % filas y se escribieron % — hay un sku sin resolver',
      v_esperadas, v_n using errcode = 'data_exception';
  end if;
  v_resumen := v_resumen || jsonb_build_object('promocion', v_n);

  update public.importacion
  set estado = 'aplicada', aplicada_at = now(), resumen = v_resumen
  where id = p_importacion_id;
  get diagnostics v_n = row_count;
  if v_n <> 1 then
    -- Un UPDATE que la RLS bloquea no da error: afecta a 0 filas y sigue. Sin
    -- esto, el maestro se aplicaría y la importación se quedaría en
    -- "previsualizada" para siempre — y alguien la reaplicaría.
    raise exception 'no se pudo marcar la importación como aplicada'
      using errcode = 'insufficient_privilege';
  end if;

  raise log 'importacion aplicada: % tenant % resumen %',
    p_importacion_id, v_tenant, v_resumen;

  return v_resumen;
end;
$$;

comment on function public.aplicar_importacion(uuid, jsonb) is
  'Aplica un lote YA VALIDADO del maestro comercial en una sola transacción: todo o nada. El tenant sale de la fila `importacion`, nunca de un parámetro. NO toca `activo` ni desactiva por ausencia: una fila que desaparece del Excel sigue viva.';

revoke execute on function public.aplicar_importacion(uuid, jsonb) from public;
revoke execute on function public.aplicar_importacion(uuid, jsonb) from anon;
grant execute on function public.aplicar_importacion(uuid, jsonb)
  to authenticated, service_role;
