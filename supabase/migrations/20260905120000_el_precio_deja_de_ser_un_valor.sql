-- El precio deja de ser un valor y pasa a ser un periodo.
--
-- Pedido en la 4ª revisión con el cliente. Sabino: "si ahorita está 20 soles y el
-- próximo año deciden que va a costar 25, yo entro y cambio a 25 y ya perdí
-- trazabilidad de cuánto estaba antes y en qué tiempo estuvo con ese precio".
-- Martin remató el porqué: "el precio promedio de 2025 y el de 2026 — si yo lo
-- modifico y después me bajo el reporte, me va a salir como si no hubiese
-- variado".
--
-- `precio_regular` YA acumulaba (`vigente_desde` está en su clave natural) y
-- `app.evaluar_precio_sku` YA resolvía por la fecha de la visita. Lo que faltaba
-- eran tres cosas: un cierre explícito de periodo, que el resolvedor lo respete,
-- y cerrar las DOS puertas que pisan historia — el panel y el importador.

create extension if not exists btree_gist with schema extensions;

-- ---------------------------------------------------------------------------
-- 1. La columna
--
-- INCLUSIVA y nullable. `promocion.fecha_fin` ya es inclusiva (el árbol de
-- precio la usa con `between`), y dos convenciones de fin en la misma pantalla
-- es cómo se escribe un error de un día que nadie ve hasta el cierre de mes.

alter table public.precio_regular add column vigente_hasta date;

comment on column public.precio_regular.vigente_hasta is
  'Último día en que el precio rige (INCLUSIVO). Nulo = sigue vigente. Un periodo cerrado no se reabre: se abre uno nuevo.';

alter table public.precio_regular
  add constraint precio_regular_vigencia_coherente
  check (vigente_hasta is null or vigente_hasta >= vigente_desde);

-- ---------------------------------------------------------------------------
-- 2. El único dueño de "cerrar el anterior"
--
-- Lo usan los tres caminos que abren un periodo: el backfill de esta migración,
-- el importador y la RPC del panel. Que sea uno solo es lo que impide que el
-- lote y el formulario cierren con criterios distintos.
--
-- `least(coalesce(vigente_hasta, 'infinity'), lead - 1)` SOLO ENCOGE: un periodo
-- que un admin cerró a propósito —dejando un hueco deliberado— no se reabre.
-- `least` ignora los nulos, así que la última fila de cada cadena conserva el
-- cierre que tuviera, y si no tenía ninguno se queda abierta.

create function app.cerrar_periodos_precio(
  p_tenant uuid default null,
  p_skus   uuid[] default null
)
returns void
language sql
security invoker
set search_path = ''
as $$
  update public.precio_regular pr
  set vigente_hasta = cadena.hasta
  from (
    select id,
           least(
             coalesce(vigente_hasta, 'infinity'::date),
             lead(vigente_desde) over (
               partition by tenant_id, sku_id, cadena_id, tipo_tienda
               order by vigente_desde) - 1
           ) as hasta
    from public.precio_regular
    where (p_tenant is null or tenant_id = p_tenant)
      and (p_skus is null or sku_id = any (p_skus))
  ) cadena
  where pr.id = cadena.id
    and cadena.hasta <> 'infinity'::date
    and pr.vigente_hasta is distinct from cadena.hasta;
$$;

-- La ejecutan `aplicar_importacion` y `abrir_periodo_precio`, que son
-- `security invoker`: corren como quien llama, así que sin este grant mueren con
-- un 42501 antes de que ninguna política se evalúe. No abre superficie: `app` no
-- lo publica PostgREST, y la función es invoker, o sea que la RLS sigue mandando
-- sobre qué filas toca.
revoke execute on function app.cerrar_periodos_precio(uuid, uuid[])
  from public, anon;
grant execute on function app.cerrar_periodos_precio(uuid, uuid[])
  to authenticated, service_role;

comment on function app.cerrar_periodos_precio(uuid, uuid[]) is
  'Cierra cada periodo de precio contra el inicio del siguiente. Único dueño de esa regla: la comparten el importador, la RPC del panel y el backfill. Solo encoge, nunca reabre.';

-- ---------------------------------------------------------------------------
-- 3. Backfill — NO es opcional
--
-- Hoy todas las filas están abiertas. Si se dejaran así, el `add constraint` de
-- abajo valida los datos existentes y MUERE en cuanto un SKU tenga dos precios
-- en la misma cadena. Dejar los periodos abiertos no es una opción de diseño: es
-- un fallo de despliegue.
--
-- Y no cambia ninguna evaluación pasada: para una fecha dada, el periodo que la
-- contiene tras el cierre es exactamente el que el `order by vigente_desde desc
-- limit 1` elegía antes.

select app.cerrar_periodos_precio();

-- ---------------------------------------------------------------------------
-- 4. Dos restricciones de solapamiento, no una
--
-- Una sola con `tipo_tienda with =` NO atrapa el solapamiento cuando
-- `tipo_tienda` es nulo —medido: dos periodos abiertos con tipo nulo se
-- aceptan— y ese es justo el bucket que llena el importador, que manda el tipo
-- vacío. Es la misma razón por la que la clave natural eligió
-- `nulls not distinct`.
--
-- Y respetan la convivencia legítima: el precio general de la cadena y el de un
-- `tipo_tienda` concreto SE SOLAPAN a propósito —el resolvedor desempata entre
-- ellos—, así que prohibirlo rompería el modelo.
--
-- `deferrable initially immediate`: las escrituras del panel siguen fallando al
-- instante, con el mensaje pegado a la fila que lo causó. Solo el importador
-- difiere, porque construye una cadena entera de periodos que se solapan entre
-- sí mientras se insertan.

alter table public.precio_regular
  add constraint precio_regular_sin_solape_tipo
  exclude using gist (
    tenant_id with =, sku_id with =, cadena_id with =, tipo_tienda with =,
    daterange(vigente_desde, vigente_hasta, '[]') with &&
  ) where (tipo_tienda is not null)
  deferrable initially immediate;

alter table public.precio_regular
  add constraint precio_regular_sin_solape_general
  exclude using gist (
    tenant_id with =, sku_id with =, cadena_id with =,
    daterange(vigente_desde, vigente_hasta, '[]') with &&
  ) where (tipo_tienda is null)
  deferrable initially immediate;

-- `precio_regular_natural_uq` se CONSERVA. Con la exclusión es redundante como
-- invariante (dos filas de la misma `vigente_desde` en el mismo bucket siempre
-- se solapan), pero un `on conflict` necesita un índice único como árbitro y una
-- restricción de exclusión no puede serlo. El importador depende de él.

-- ---------------------------------------------------------------------------
-- 5. El resolvedor único
--
-- ESTA FUNCIÓN NO SE INLINEA, y el coste es deliberado.
--
-- Medido con EXPLAIN: el planificador la deja como `Function Scan` opaco, así
-- que el motor de puntaje paga una llamada por fila de `levantamiento_sku`.
-- Sobre 100.000 filas de precio y 20.000 de levantamiento son ~196 ms frente a
-- los ~117 ms que costaba la subconsulta suelta que vivía dentro de
-- `evaluar_precio_sku`.
--
-- La causa NO es el tipo de retorno ni la forma de la llamada: es
-- `set search_path = ''`. Comprobado quitándoselo a una copia — sin él la misma
-- función se inlinea (`Limit → Sort → Index Scan` en vez de `Function Scan`);
-- con él, nunca. Postgres no puede inlinear un cuerpo que exige aplicar una
-- configuración durante su ejecución.
--
-- Y el `search_path` vacío no se negocia: es la verja contra el secuestro de
-- resolución de nombres, y la lleva cada función del proyecto. Se paga la
-- llamada por fila a cambio de que la regla de "qué precio regía" tenga UN dueño,
-- que es justamente lo que pide el ticket.
--
-- `returns setof` se conserva porque es la forma honesta: sin filas devuelve
-- cero filas, no una fila de nulos, y eso hace que el `left join lateral` de
-- `detalle_alerta` signifique lo que aparenta.
--
-- Devuelve la fila entera y no el precio: el portal necesita también las fechas
-- de vigencia, y dos funciones para eso serían dos dueños de la misma regla.
--
-- El desempate vive AQUÍ y solo aquí. Se conserva bit a bit el que ya había
-- (`tipo_tienda nulls first`, o sea el general de la cadena gana al específico):
-- cambiar qué precio gana alteraría evaluaciones históricas, que es exactamente
-- lo contrario de lo que esta migración promete.

create function app.precio_regular_vigente(
  p_tenant uuid,
  p_sku    uuid,
  p_cadena uuid,
  p_fecha  date default app.hoy_lima()
)
returns setof public.precio_regular
language sql
stable
security invoker
set search_path = ''
as $$
  select pr.*
  from public.precio_regular pr
  where pr.tenant_id = p_tenant and pr.sku_id = p_sku and pr.cadena_id = p_cadena
    and pr.vigente_desde <= p_fecha
    and (pr.vigente_hasta is null or pr.vigente_hasta >= p_fecha)
  order by pr.tipo_tienda nulls first, pr.vigente_desde desc
  limit 1;
$$;

revoke execute on function app.precio_regular_vigente(uuid, uuid, uuid, date)
  from public, anon;
grant execute on function app.precio_regular_vigente(uuid, uuid, uuid, date)
  to authenticated, service_role;

comment on function app.precio_regular_vigente(uuid, uuid, uuid, date) is
  'El precio regular que regía en una fecha, con su ventana de vigencia. Único dueño de "vigente a la fecha X": ningún consumidor reimplementa el desempate.';

-- ---------------------------------------------------------------------------
-- 6. El árbol de precio pasa por el resolvedor
--
-- Se recrea entero porque una función es su cuerpo. Lo ÚNICO que cambia es el
-- `select` que buscaba el precio: ahora lo pide al resolvedor, que además
-- respeta `vigente_hasta`. Sin ese cambio, un periodo ya cerrado seguiría
-- ganando y las alertas de precio se dispararían contra un precio derogado.
--
-- La firma no cambia, así que los ocho consumidores de esta función —motor de
-- alertas, puntaje de Perfect Store, ponderado, POP, incidencias— no se tocan.

create or replace function app.evaluar_precio_sku(
  p_tenant           uuid,
  p_sku              uuid,
  p_marca            uuid,
  p_cadena           uuid,
  p_precio           numeric,
  p_hay_promo        boolean,
  p_promo_comunicada boolean,
  p_fecha            date,
  -- El precio contra el que se comparó, como salida: el motor de alertas lo pone
  -- en el payload y releerlo sería una segunda consulta idéntica en el camino
  -- caliente de la sincronización.
  out veredicto      public.evaluacion_precio,
  out precio_regular numeric
)
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_tol     numeric;
  v_promo_comunicada boolean;
begin
  veredicto := 'sin_precio_vigente';
  if p_precio is null then return; end if;

  -- El desempate y la ventana de vigencia viven en el resolvedor, no aquí: es el
  -- único dueño de "qué precio regía en la fecha X".
  --
  -- Se llama desde el `FROM` y no como `(f(...)).precio`: es la forma que el
  -- inliner mira. Sin filas, el `into` deja `precio_regular` en null y el
  -- veredicto sigue siendo `sin_precio_vigente`.
  select pr.precio into precio_regular
  from app.precio_regular_vigente(p_tenant, p_sku, p_cadena, p_fecha) pr;

  if precio_regular is null then return; end if;

  select coalesce(m.tolerancia_precio_pct, 0) into v_tol
  from public.marca m where m.id = p_marca;
  v_tol := coalesce(v_tol, 0);

  if p_precio > precio_regular * (1 + v_tol / 100) then
    veredicto := 'sobreprecio';
    return;
  end if;

  if p_precio >= precio_regular * (1 - v_tol / 100) then
    veredicto := 'correcto';
    return;
  end if;

  -- Por debajo del regular: solo una promo vigente y comunicada lo justifica.
  select p.comunicada into v_promo_comunicada
  from public.promocion p
  where p.tenant_id = p_tenant and p.sku_id = p_sku
    and p_fecha between p.fecha_inicio and p.fecha_fin
  order by p.fecha_inicio desc
  limit 1;

  if v_promo_comunicada is true then
    veredicto := 'correcto';
  elsif coalesce(p_hay_promo, false) and not coalesce(p_promo_comunicada, false) then
    veredicto := 'promo_no_comunicada';
  else
    veredicto := 'subvaluado_sin_promo';
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- 10. El importador deja de pisar el precio
--
-- Es la puerta que más duele, porque corre en lote. Se recrea entera —una
-- función es su cuerpo— y lo único que cambia son los bloques de
-- `precio_regular` y `promocion`.

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
  v_detalle text;
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

  -- El lote resuelto una vez: lo miran el pre-chequeo, el insert y el cierre.
  -- El `drop` no sobra: dos importaciones pueden aplicarse en la misma
  -- transacción, y `on commit drop` no libera el nombre hasta el commit.
  drop table if exists lote_precio;
  create temporary table lote_precio on commit drop as
  select v_tenant as tenant_id, s.id as sku_id, c.id as cadena_id,
         f.tipo_tienda, f.precio, f.vigente_desde
  from jsonb_to_recordset(coalesce(p_lote->'precio_regular', '[]'::jsonb))
    as f(sku_codigo_externo text, cadena_codigo_externo text,
         tipo_tienda public.tipo_tienda, precio numeric, vigente_desde date)
  join public.sku s
    on s.tenant_id = v_tenant and s.codigo_externo = f.sku_codigo_externo
  join public.cadena c
    on c.tenant_id = v_tenant and c.codigo_externo = f.cadena_codigo_externo;

  -- Reimportar la MISMA fecha con otro precio borra el valor que rigió ese
  -- periodo sin dejar rastro, y el importador corre en lote: es la puerta por la
  -- que más fácil se pierde la trazabilidad. Se rechaza el lote entero.
  --
  -- No cabe "cerrar y abrir" el mismo día: con vigencias inclusivas el cierre
  -- sería `vigente_desde - 1`, anterior al propio inicio. Cambiar un precio se
  -- hace poniendo una fecha nueva, que es el gesto que el cliente describió.
  select string_agg(format('%s/%s el %s: %s -> %s', s.codigo_externo,
                           c.codigo_externo, l.vigente_desde, pr.precio, l.precio),
                    '; ' order by s.codigo_externo)
    into v_detalle
  from lote_precio l
  join public.precio_regular pr
    on pr.tenant_id = l.tenant_id and pr.sku_id = l.sku_id
       and pr.cadena_id = l.cadena_id and pr.vigente_desde = l.vigente_desde
       and pr.tipo_tienda is not distinct from l.tipo_tienda
  join public.sku s on s.id = l.sku_id
  join public.cadena c on c.id = l.cadena_id
  where pr.precio <> l.precio;

  if v_detalle is not null then
    raise exception 'precio_regular: ese precio ya rigió con otro valor y sobrescribirlo perdería el histórico (%). Abre un periodo nuevo con otra fecha de vigencia.',
      left(v_detalle, 500) using errcode = 'data_exception';
  end if;

  -- Un lote puede traer varias fechas del mismo SKU: mientras se insertan, esos
  -- periodos se solapan entre sí. Se difiere la exclusión al commit y se cierra
  -- la cadena entera después, con el único dueño de "cerrar el anterior". Las
  -- escrituras del panel NO difieren: fallan al instante y con mensaje propio.
  set constraints public.precio_regular_sin_solape_tipo,
                  public.precio_regular_sin_solape_general deferred;

  insert into public.precio_regular (tenant_id, sku_id, cadena_id, tipo_tienda,
                                     precio, vigente_desde)
  select l.tenant_id, l.sku_id, l.cadena_id, l.tipo_tienda, l.precio, l.vigente_desde
  from lote_precio l
  -- Auto-escritura: reimportar el archivo idéntico tiene que seguir siendo
  -- idempotente Y contable. Un `do nothing` no cuenta la fila y el contador de
  -- abajo abortaría un reimport limpio. El pre-chequeo ya garantizó que el
  -- precio entrante es el mismo, así que esto no pisa ningún valor.
  on conflict (tenant_id, sku_id, cadena_id, tipo_tienda, vigente_desde) do update
    set precio = public.precio_regular.precio;
  get diagnostics v_n = row_count;
  v_esperadas := jsonb_array_length(coalesce(p_lote->'precio_regular', '[]'::jsonb));
  if v_n <> v_esperadas then
    raise exception 'precio_regular: llegaron % filas y se escribieron % — hay un sku o una cadena sin resolver',
      v_esperadas, v_n using errcode = 'data_exception';
  end if;
  v_resumen := v_resumen || jsonb_build_object('precio_regular', v_n);

  perform app.cerrar_periodos_precio(
    v_tenant, array(select distinct sku_id from lote_precio));

  drop table if exists lote_promo;
  create temporary table lote_promo on commit drop as
  select v_tenant as tenant_id, s.id as sku_id, f.precio_promo, f.fecha_inicio,
         f.fecha_fin,
         -- Una casilla en blanco no es un «no»: se conserva lo que hubiera.
         coalesce(f.comunicada, p0.comunicada, false) as comunicada
  from jsonb_to_recordset(coalesce(p_lote->'promocion', '[]'::jsonb))
    as f(sku_codigo_externo text, precio_promo numeric, fecha_inicio date,
         fecha_fin date, comunicada boolean)
  join public.sku s
    on s.tenant_id = v_tenant and s.codigo_externo = f.sku_codigo_externo
  left join public.promocion p0
    on p0.tenant_id = v_tenant and p0.sku_id = s.id
       and p0.fecha_inicio = f.fecha_inicio;

  -- La misma verja que en precio, por el mismo motivo: cambiar `comunicada` de
  -- una promo de julio en septiembre cambia el veredicto de una visita de julio.
  select string_agg(format('%s desde %s', s.codigo_externo, l.fecha_inicio),
                    '; ' order by s.codigo_externo)
    into v_detalle
  from lote_promo l
  join public.promocion p
    on p.tenant_id = l.tenant_id and p.sku_id = l.sku_id
       and p.fecha_inicio = l.fecha_inicio
  join public.sku s on s.id = l.sku_id
  where (p.precio_promo, p.fecha_fin, p.comunicada)
        is distinct from (l.precio_promo, l.fecha_fin, l.comunicada);

  if v_detalle is not null then
    raise exception 'promocion: esa promoción ya existe con otros datos y sobrescribirla perdería el histórico (%). Abre una promoción nueva con otra fecha de inicio.',
      left(v_detalle, 500) using errcode = 'data_exception';
  end if;

  insert into public.promocion (tenant_id, sku_id, precio_promo, fecha_inicio,
                                fecha_fin, comunicada)
  select l.tenant_id, l.sku_id, l.precio_promo, l.fecha_inicio, l.fecha_fin,
         l.comunicada
  from lote_promo l
  on conflict (tenant_id, sku_id, fecha_inicio) do update
    set precio_promo = public.promocion.precio_promo;
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

-- ---------------------------------------------------------------------------
-- 7. Un periodo que ya empezó no se pisa — y lo dice la BASE
--
-- La verja no puede vivir solo en la Server Action: `authenticated` tiene
-- `update` sobre la tabla y un PATCH directo a PostgREST se la salta entera. Es
-- el mismo fallo que ya se corrigió en la alerta anulada.
--
-- Va como trigger y no como política porque una política no puede expresar QUÉ
-- COLUMNAS pueden cambiar, y esa distinción es justo la regla: cerrar el periodo
-- (tocar `vigente_hasta`) es legítimo; cambiarle el precio, no.
--
-- Corregir sigue siendo posible mientras el periodo no haya empezado. Un precio
-- mal cargado en el pasado no se arregla hacia atrás: se cierra y se abre el
-- correcto, y la ventana errónea queda a la vista. Es el precio de que ninguna
-- evaluación pasada pueda cambiar de resultado nunca.

create function app.precio_iniciado_no_se_pisa()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- El importador reescribe la fila consigo misma para que su contador de filas
  -- cuadre en un reimport idéntico. Eso no cambia nada y no es una sobrescritura.
  if new is not distinct from old then return new; end if;

  if old.vigente_desde > app.hoy_lima() then return new; end if;

  if (new.tenant_id, new.sku_id, new.cadena_id, new.tipo_tienda,
      new.precio, new.vigente_desde)
     is distinct from
     (old.tenant_id, old.sku_id, old.cadena_id, old.tipo_tienda,
      old.precio, old.vigente_desde) then
    raise exception 'ese precio ya rigió desde el % y no se puede reescribir: abre un periodo nuevo',
      old.vigente_desde using errcode = 'check_violation';
  end if;

  -- `vigente_hasta` queda fuera de la tupla de arriba porque CERRAR es la
  -- operación legítima. Pero fuera de la tupla no puede significar sin cota: son
  -- las dos formas que quedaban de reescribir el pasado por un PATCH directo.

  -- Un periodo ya cerrado cuyo fin pasó está congelado. Reabrirlo —poner
  -- `vigente_hasta` a null— o moverlo cambiaría lo que ese tramo dice hoy, y el
  -- portal recalcula la ventana de una alerta vieja cada vez que se abre.
  if old.vigente_hasta is not null
     and old.vigente_hasta <= app.hoy_lima()
     and new.vigente_hasta is distinct from old.vigente_hasta then
    raise exception 'ese periodo se cerró el % y ya no se reabre ni se mueve: abre uno nuevo',
      old.vigente_hasta using errcode = 'check_violation';
  end if;

  -- Y uno abierto no se corta hacia atrás dejando un hueco: ese tramo se
  -- quedaría SIN precio vigente, y eso no da error en ninguna pantalla — saca al
  -- SKU del denominador de Perfect Store en silencio, con forma de dato que
  -- falta. Se admite cortar de hoy en adelante, o justo antes de que arranque el
  -- periodo siguiente, que es lo que hace `cerrar_periodos_precio` al encadenar.
  if new.vigente_hasta is not null
     and new.vigente_hasta < app.hoy_lima()
     and not exists (
       select 1 from public.precio_regular pr
       where pr.tenant_id = new.tenant_id and pr.sku_id = new.sku_id
         and pr.cadena_id = new.cadena_id
         and pr.tipo_tienda is not distinct from new.tipo_tienda
         and pr.vigente_desde = new.vigente_hasta + 1
     ) then
    raise exception 'cerrar ese precio el % dejaría ese tramo sin precio vigente: ciérralo de hoy en adelante, o justo antes de que arranque el siguiente',
      new.vigente_hasta using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

revoke execute on function app.precio_iniciado_no_se_pisa()
  from public, anon, authenticated, service_role;

create trigger precio_iniciado_no_se_pisa
  before update on public.precio_regular
  for each row execute function app.precio_iniciado_no_se_pisa();

-- La misma regla para la promoción, por el mismo motivo: cambiar `comunicada` de
-- una promo de julio en septiembre cambia el veredicto de una visita de julio.
-- `promocion` no necesita `vigente_hasta` —su intervalo ya está cerrado— pero sí
-- necesita que nadie lo reescriba hacia atrás.
--
-- `fecha_fin` sí se puede mover, y solo hacia hoy o el futuro: cortar una promo
-- que está corriendo es una operación real; acortarla al pasado reescribiría
-- veredictos ya emitidos.

create function app.promocion_iniciada_no_se_pisa()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new is not distinct from old then return new; end if;
  if old.fecha_inicio > app.hoy_lima() then return new; end if;

  if (new.tenant_id, new.sku_id, new.precio_promo, new.fecha_inicio,
      new.comunicada, new.clusters)
     is distinct from
     (old.tenant_id, old.sku_id, old.precio_promo, old.fecha_inicio,
      old.comunicada, old.clusters) then
    raise exception 'esa promoción ya arrancó el % y no se puede reescribir: crea una nueva',
      old.fecha_inicio using errcode = 'check_violation';
  end if;

  if old.fecha_fin < app.hoy_lima() then
    -- Ya terminó. Estirar su fin cubriría con la promo días que ya pasaron y que
    -- se evaluaron sin ella: el mismo veredicto reescrito por otra puerta.
    if new.fecha_fin is distinct from old.fecha_fin then
      raise exception 'esa promoción terminó el % y su vigencia ya no se mueve: crea una nueva',
        old.fecha_fin using errcode = 'check_violation';
    end if;
  elsif new.fecha_fin < app.hoy_lima() then
    raise exception 'una promoción que ya arrancó se puede cortar desde hoy, no en el pasado'
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

revoke execute on function app.promocion_iniciada_no_se_pisa()
  from public, anon, authenticated, service_role;

create trigger promocion_iniciada_no_se_pisa
  before update on public.promocion
  for each row execute function app.promocion_iniciada_no_se_pisa();

-- ---------------------------------------------------------------------------
-- 8. Abrir un periodo: cerrar y abrir, en una sola transacción
--
-- No son dos escrituras desde la Server Action porque PostgREST no da
-- transacción multi-sentencia: un fallo entre el cierre y la apertura dejaría al
-- SKU SIN NINGÚN precio vigente — y eso no da error en ninguna pantalla, da
-- `sin_precio_vigente`, o sea que el SKU sale del denominador de Perfect Store
-- en silencio.
--
-- `security invoker`: quien autoriza es `precio_admin_escribe`, no esta función.
-- El tenant sale de la fila del SKU, nunca de un parámetro: un formulario no
-- elige en qué cliente escribe.

-- `p_tipo_tienda` va al final y con default: vacío significa "toda la cadena",
-- que es el caso mayoritario, y así el argumento sale OPCIONAL en los tipos
-- generados en vez de exigir un null explícito que el tipo no admite.
create function public.abrir_periodo_precio(
  p_sku           uuid,
  p_cadena        uuid,
  p_precio        numeric,
  p_vigente_desde date,
  p_tipo_tienda   public.tipo_tienda default null
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_tenant  uuid;
  v_vigente date;
  v_id      uuid;
begin
  if (select app.rol_actual()) <> 'admin' then
    raise exception 'solo un administrador abre un periodo de precio'
      using errcode = 'insufficient_privilege';
  end if;

  -- Si quien llama no puede leer el SKU, la RLS no devuelve fila y esto falla
  -- cerrado en vez de escribir en el cliente equivocado.
  select s.tenant_id into strict v_tenant
  from public.sku s where s.id = p_sku;

  select max(pr.vigente_desde) into v_vigente
  from public.precio_regular pr
  where pr.tenant_id = v_tenant and pr.sku_id = p_sku
    and pr.cadena_id = p_cadena
    and pr.tipo_tienda is not distinct from p_tipo_tienda;

  -- Un periodo que arranca en el pasado CIERRA al anterior antes de esa fecha, y
  -- con eso reescribe el veredicto de todas las visitas del tramo. Es la misma
  -- pérdida de trazabilidad que esta migración existe para impedir, entrando por
  -- la puerta de al lado.
  if p_vigente_desde <= app.hoy_lima() then
    raise exception 'un precio nuevo entra en vigor a partir de mañana: cambiarlo desde hoy o antes reescribiría lo que ya se evaluó'
      using errcode = 'check_violation';
  end if;

  -- Sin esta guarda el operador recibiría el 23514 crudo del check de coherencia
  -- y no sabría qué hizo mal.
  if v_vigente is not null and p_vigente_desde <= v_vigente then
    raise exception 'ya hay un precio para ese SKU y esa cadena desde el % o posterior: el periodo nuevo tiene que empezar después',
      v_vigente using errcode = 'check_violation';
  end if;

  -- El periodo nuevo nace abierto y por un instante pisa al que todavía lo está:
  -- cerrar y abrir es UNA operación, no dos. Se difiere la exclusión al commit y
  -- se cierra con el único dueño de esa regla, en vez de repetir aquí la
  -- expresión del cierre.
  set constraints public.precio_regular_sin_solape_tipo,
                  public.precio_regular_sin_solape_general deferred;

  insert into public.precio_regular (tenant_id, sku_id, cadena_id, tipo_tienda,
                                     precio, vigente_desde)
  values (v_tenant, p_sku, p_cadena, p_tipo_tienda, p_precio, p_vigente_desde)
  returning id into v_id;

  perform app.cerrar_periodos_precio(v_tenant, array[p_sku]);

  -- Es una mutación de un hecho que se paga y se puntúa: sin log no hay forma de
  -- reconstruir quién movió qué.
  raise log 'periodo de precio abierto por %: sku % cadena % desde % precio %',
    (select auth.uid()), p_sku, p_cadena, p_vigente_desde, p_precio;

  return v_id;
end;
$$;

revoke execute on function public.abrir_periodo_precio(
  uuid, uuid, numeric, date, public.tipo_tienda) from public, anon;
grant execute on function public.abrir_periodo_precio(
  uuid, uuid, numeric, date, public.tipo_tienda) to authenticated, service_role;

comment on function public.abrir_periodo_precio(uuid, uuid, numeric, date, public.tipo_tienda) is
  'Cierra el periodo de precio vigente y abre uno nuevo, en una sola transacción. Nunca pisa el anterior: el histórico es lo que da la trazabilidad que pidió el cliente.';
