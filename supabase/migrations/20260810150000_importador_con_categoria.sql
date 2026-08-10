-- El importador aprende la categoría de producto.
--
-- Reemplaza `aplicar_importacion` para añadir la entidad `categoria` y resolver
-- `sku.categoria_id`. Se recrea entera y no se parchea: una función es su cuerpo,
-- y un `create or replace` parcial no existe.
--
-- Lo único que cambia respecto de `20260808100000_importador_maestro.sql` es el
-- bloque de `categoria` (nuevo, antes de `sku`) y el `sku` (resolución de la
-- categoría). El resto es idéntico y se reproduce tal cual.

create or replace function public.aplicar_importacion(
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
    raise exception 'solo un administrador aplica una importación'
      using errcode = 'insufficient_privilege';
  end if;

  perform pg_advisory_xact_lock(
    hashtext('aplicar_importacion'), hashtext(p_importacion_id::text));

  select i.tenant_id, i.estado into strict v_tenant, v_estado
  from public.importacion i
  where i.id = p_importacion_id
  for update;

  if v_estado <> 'previsualizada' then
    raise exception 'la importación está en estado % y solo se aplica una previsualizada', v_estado
      using errcode = 'check_violation';
  end if;

  select t.activo into v_activo from public.tenant t where t.id = v_tenant;
  if not coalesce(v_activo, false) then
    raise exception 'el cliente está dado de baja'
      using errcode = 'check_violation';
  end if;

  -- --- Las ocho entidades, en orden de dependencia --------------------------
  --
  -- NINGÚN `on conflict do update` toca `activo`: una fila que desaparece del
  -- Excel nuevo SIGUE ACTIVA, y una que el admin desactivó a mano no se reactiva
  -- sola por seguir apareciendo en el archivo.

  insert into public.marca (tenant_id, codigo_externo, nombre, tolerancia_precio_pct)
  select v_tenant, f.codigo_externo, f.nombre,
         coalesce(f.tolerancia_precio_pct, m0.tolerancia_precio_pct, 0)
  from jsonb_to_recordset(coalesce(p_lote->'marca', '[]'::jsonb))
    as f(codigo_externo text, nombre text, tolerancia_precio_pct numeric)
  left join public.marca m0
    on m0.tenant_id = v_tenant and m0.codigo_externo = f.codigo_externo
  on conflict (tenant_id, codigo_externo) do update
    set nombre = excluded.nombre,
        tolerancia_precio_pct = excluded.tolerancia_precio_pct;
  get diagnostics v_n = row_count;
  v_resumen := v_resumen || jsonb_build_object('marca', v_n);

  -- La categoría va ANTES que el sku: el sku la referencia, y el join de abajo
  -- tiene que encontrarla ya escrita si viene en el mismo archivo.
  insert into public.categoria (tenant_id, codigo_externo, nombre)
  select v_tenant, f.codigo_externo, f.nombre
  from jsonb_to_recordset(coalesce(p_lote->'categoria', '[]'::jsonb))
    as f(codigo_externo text, nombre text)
  on conflict (tenant_id, codigo_externo) do update
    set nombre = excluded.nombre;
  get diagnostics v_n = row_count;
  v_resumen := v_resumen || jsonb_build_object('categoria', v_n);

  insert into public.cadena (tenant_id, codigo_externo, nombre, tipo_tienda)
  select v_tenant, f.codigo_externo, f.nombre, f.tipo_tienda
  from jsonb_to_recordset(coalesce(p_lote->'cadena', '[]'::jsonb))
    as f(codigo_externo text, nombre text, tipo_tienda public.tipo_tienda)
  on conflict (tenant_id, codigo_externo) do update
    set nombre = excluded.nombre,
        tipo_tienda = coalesce(excluded.tipo_tienda, public.cadena.tipo_tienda);
  get diagnostics v_n = row_count;
  v_resumen := v_resumen || jsonb_build_object('cadena', v_n);

  -- La categoría entra por LEFT join, así que una que no resuelve no descarta la
  -- fila: la deja con `categoria_id` nulo. Eso es lo que se quiere de una celda
  -- VACÍA, pero no de un código con una errata — ahí el SKU se guardaría sin
  -- categoría y el import diría "aplicado". `marca` no tiene ese agujero porque
  -- entra por join normal y el contador de filas lo caza. Esta guarda le da a la
  -- categoría la misma red, distinguiendo las dos cosas que el LEFT join junta.
  select count(*) into v_n
  from jsonb_to_recordset(coalesce(p_lote->'sku', '[]'::jsonb))
    as f(categoria_codigo_externo text)
  left join public.categoria c
    on c.tenant_id = v_tenant and c.codigo_externo = f.categoria_codigo_externo
  where f.categoria_codigo_externo is not null and c.id is null;
  if v_n > 0 then
    raise exception 'sku: % filas traen una categoría que no existe',
      v_n using errcode = 'data_exception';
  end if;

  insert into public.sku (tenant_id, codigo_externo, marca_id, categoria_id,
                          codigo, nombre, presentacion, codigo_barras)
  -- La categoría se resuelve con LEFT join: sin categoría el SKU entra igual, que
  -- es lo que hace aditivo el despliegue. Con un join normal, un SKU sin
  -- categoría desaparecería en silencio y el contador de abajo lo cazaría como
  -- "una marca sin resolver" — un error que apunta al sitio equivocado.
  select v_tenant, f.codigo_externo, m.id, c.id, f.codigo, f.nombre,
         f.presentacion, f.codigo_barras
  from jsonb_to_recordset(coalesce(p_lote->'sku', '[]'::jsonb))
    as f(codigo_externo text, marca_codigo_externo text, codigo text,
         nombre text, presentacion text, codigo_barras text,
         categoria_codigo_externo text)
  join public.marca m
    on m.tenant_id = v_tenant and m.codigo_externo = f.marca_codigo_externo
  left join public.categoria c
    on c.tenant_id = v_tenant and c.codigo_externo = f.categoria_codigo_externo
  on conflict (tenant_id, codigo_externo) do update
    set marca_id = excluded.marca_id,
        -- `coalesce` contra la fila que ya está: una celda vacía NO borra la
        -- categoría que el panel le hubiera puesto. Por el importador se puede
        -- cambiar un campo opcional, no vaciarlo.
        categoria_id = coalesce(excluded.categoria_id, public.sku.categoria_id),
        codigo = excluded.codigo,
        nombre = excluded.nombre,
        presentacion = coalesce(excluded.presentacion, public.sku.presentacion),
        codigo_barras = coalesce(excluded.codigo_barras, public.sku.codigo_barras);
  get diagnostics v_n = row_count;
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
         coalesce(f.radio_geocerca_m, t0.radio_geocerca_m, 100),
         f.cluster
  from jsonb_to_recordset(coalesce(p_lote->'tienda', '[]'::jsonb))
    as f(codigo_externo text, cadena_codigo_externo text, nombre text,
         direccion text, lat double precision, lon double precision,
         radio_geocerca_m integer, cluster text)
  join public.cadena c
    on c.tenant_id = v_tenant and c.codigo_externo = f.cadena_codigo_externo
  left join public.tienda t0
    on t0.tenant_id = v_tenant and t0.codigo_externo = f.codigo_externo
  on conflict (tenant_id, codigo_externo) do update
    set cadena_id = excluded.cadena_id,
        nombre = excluded.nombre,
        direccion = coalesce(excluded.direccion, public.tienda.direccion),
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
         coalesce(f.comunicada, p0.comunicada, false)
  from jsonb_to_recordset(coalesce(p_lote->'promocion', '[]'::jsonb))
    as f(sku_codigo_externo text, precio_promo numeric, fecha_inicio date,
         fecha_fin date, comunicada boolean)
  join public.sku s
    on s.tenant_id = v_tenant and s.codigo_externo = f.sku_codigo_externo
  left join public.promocion p0
    on p0.tenant_id = v_tenant and p0.sku_id = s.id
       and p0.fecha_inicio = f.fecha_inicio
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
    raise exception 'no se pudo marcar la importación como aplicada'
      using errcode = 'insufficient_privilege';
  end if;

  raise log 'importacion aplicada: % tenant % resumen %',
    p_importacion_id, v_tenant, v_resumen;

  return v_resumen;
end;
$$;

comment on function public.aplicar_importacion(uuid, jsonb) is
  'Aplica un lote YA VALIDADO del maestro comercial en una sola transacción: todo o nada. El tenant sale de la fila `importacion`, nunca de un parámetro. NO toca `activo` ni desactiva por ausencia. La categoría del SKU es opcional y una celda vacía la CONSERVA.';

-- Los permisos se repiten aunque `create or replace` conserve las ACL de la
-- función que ya existía. Sin ellos, esta migración depende de que su predecesora
-- siga en el historial y de que nadie la convierta en un `drop` + `create` — que
-- sí perdería los grants, y en silencio: la función quedaría ejecutable por
-- `public`. Repetirlos es barato y la hace autocontenida.
revoke execute on function public.aplicar_importacion(uuid, jsonb) from public;
revoke execute on function public.aplicar_importacion(uuid, jsonb) from anon;
grant execute on function public.aplicar_importacion(uuid, jsonb)
  to authenticated, service_role;
