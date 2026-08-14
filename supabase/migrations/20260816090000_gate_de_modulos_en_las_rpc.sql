-- El gate de módulos del portal llega a las RPC.
--
-- Los módulos del portal se apagan por cliente desde el panel, pero el candado
-- vivía solo en la página (`requerirModulo` => 404). Ninguna RPC de sección
-- comprobaba el módulo: un cliente-marca con una sección apagada podía llamarla
-- directamente por PostgREST (anon key + su JWT) y recibir los datos igual. No
-- es un fallo de aislamiento —la RLS acota por tenant pase lo que pase—, es un
-- salto del *entitlement*: se accede a un módulo que no se contrató.
--
-- UN solo mecanismo para las seis secciones: `app.modulo_habilitado(modulo)`
-- —hermana de `app.perfil_efectivo()`, con el mismo dueño único— y una condición
-- al principio de cada RPC de sección. Módulo apagado => RESULTADO VACÍO, no una
-- excepción:
--
--   * 7 de las 9 RPC son `language sql`, donde no hay `raise`; una excepción
--     obligaría a un mecanismo por forma de función, que es justo lo que se
--     quiere evitar.
--   * `detalle_alerta` ya devuelve null indistinguible ("no existe o no es
--     tuyo") a propósito; una excepción rompería esa convención y confirmaría
--     "la alerta existe, pero no contrataste el módulo".
--   * El vacío es un estado de primera clase en todas las pantallas del portal
--     ("Sin levantamientos…", bandeja vacía, galería vacía).
--
-- Mapa módulo => RPC: cada RPC se ata al módulo con el que la UI ya gatea lo que
-- esa RPC alimenta. Por eso `dashboard_pines` => `mapa` (la página solo pinta el
-- mapa con `mapa` habilitado) y `dashboard_alertas` => `dashboard` (el feed se
-- pinta como parte del dashboard, incondicionalmente). `reportes` no tiene RPC
-- todavía (la sección es un placeholder); cuando exista, lleva esta misma verja.
--
-- El gate de UX (`requerirModulo` => 404) se queda: esto es la verja de DATOS
-- debajo de él. Y queda un residual conocido: las lecturas directas de tabla
-- (`/rest/v1/alerta`, `/rest/v1/foto`, …) siguen abiertas al tenant vía las
-- políticas `*_usuario_lee_su_tenant` — cerrar eso es meter el módulo en la RLS
-- de cada tabla, un cambio aparte con su propio ticket.

-- --- La verja -------------------------------------------------------------------
--
-- `security definer` y no invoker: es la opción que FALLA CERRADO. Con invoker,
-- una fila de override que el llamador no pudiera ver haría `coalesce` a
-- "habilitado". El scope lo ponen los claims del que llama (`app.tenant_actual()`),
-- no el owner — igual que `public.portal_modulos()`.
--
-- Un llamador sin tenant efectivo (staff, o un usuario revocado => tenant_actual()
-- NULL) recibe `true`: el staff no compra secciones, y al revocado la RLS de cada
-- tabla ya no le enseña nada. Es la misma regla que `portal_modulos()` documenta.
--
-- El subquery filtra por (tenant_id, modulo), que es UNIQUE: una fila como mucho.
create function app.modulo_habilitado(p_modulo public.modulo_portal)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (select pmh.habilitado
     from public.portal_modulo_habilitado pmh
     where pmh.tenant_id = (select app.tenant_actual())
       and pmh.modulo = p_modulo),
    true);
$$;

comment on function app.modulo_habilitado(public.modulo_portal) is
  'ÚNICO dueño de la regla "esta sección está contratada": el override del cliente actual o, sin fila, habilitado. Un llamador sin tenant efectivo (staff, o un revocado) recibe true — el staff no compra secciones y al revocado la RLS ya no le enseña nada.';

-- `app` no tiene los default privileges de `public`: basta revocar de PUBLIC.
-- Sin el grant, las nueve RPC de abajo morirían con 42501 para TODOS los roles
-- (son security invoker: el EXECUTE se comprueba contra quien llama).
revoke execute on function app.modulo_habilitado(public.modulo_portal) from public;
grant execute on function app.modulo_habilitado(public.modulo_portal)
  to authenticated, service_role;

-- --- `portal_modulos()` se re-expresa sobre la verja ----------------------------
--
-- Mismo contrato y mismo resultado (la lista completa del enum × el override),
-- pero el `coalesce(..., true)` deja de estar duplicado: la regla tiene un solo
-- dueño. `security definer` + `search_path = ''` se re-declaran porque un
-- `create or replace` sin ellos los perdería.
create or replace function public.portal_modulos()
returns table (modulo public.modulo_portal, habilitado boolean)
language sql
stable
security definer
set search_path = ''
as $$
  select m.modulo, app.modulo_habilitado(m.modulo)
  from unnest(enum_range(null::public.modulo_portal)) as m(modulo);
$$;

comment on function public.portal_modulos() is
  'Fuente de verdad de qué secciones del portal ve el cliente actual: la lista de módulos × app.modulo_habilitado. Un tenant sin filas => todo habilitado.';

-- --- Las RPC del dashboard ------------------------------------------------------
--
-- Cuerpos idénticos a los vigentes salvo la línea de la verja (las ventanas de
-- fecha NO se tocan aquí). Ojo: `create or replace` borra el `set search_path`
-- que `20260804190000` les bolteó con `alter function`, así que las tres lo
-- llevan ahora en su propio texto. El grant sobrevive al replace; no se repite.

create or replace function public.dashboard_kpis(
  p_desde date,
  p_hasta date,
  p_cadena uuid default null,
  p_tienda uuid default null
)
returns table (
  cumplimiento_pct numeric,
  cumplimiento_pct_prev numeric,
  quiebres bigint,
  quiebres_prev bigint,
  diferencias bigint,
  diferencias_prev bigint,
  sos_pct numeric,
  sos_pct_prev numeric,
  exhib_cumplidas bigint,
  exhib_negociadas bigint,
  exhib_cumplidas_prev bigint,
  exhib_negociadas_prev bigint,
  desviaciones_precio bigint,
  desviaciones_precio_prev bigint
)
language sql
stable
set search_path = ''
as $$
  with rango as (
    select
      p_desde as d1,
      p_hasta as d2,
      (p_desde - 1 - (p_hasta - p_desde)) as p1,
      (p_desde - 1) as p2
  ),
  cumplimiento as (
    select
      round(100.0 * count(*) filter (where rp.estado = 'completada' and r.fecha between rg.d1 and rg.d2)
            / nullif(count(*) filter (where r.fecha between rg.d1 and rg.d2), 0), 1) as actual,
      round(100.0 * count(*) filter (where rp.estado = 'completada' and r.fecha between rg.p1 and rg.p2)
            / nullif(count(*) filter (where r.fecha between rg.p1 and rg.p2), 0), 1) as prev
    from public.rutero_parada rp
    join public.rutero r on r.id = rp.rutero_id
    join public.tienda t on t.id = rp.tienda_id
    cross join rango rg
    where r.fecha between rg.p1 and rg.d2
      and (p_cadena is null or t.cadena_id = p_cadena)
      and (p_tienda is null or t.id = p_tienda)
  ),
  sku as (
    select
      count(*) filter (where ls.quiebre and v.check_in_at >= rg.d1 and v.check_in_at < rg.d2 + 1) as quiebres,
      count(*) filter (where ls.quiebre and v.check_in_at >= rg.p1 and v.check_in_at < rg.p2 + 1) as quiebres_prev,
      count(*) filter (where ls.diferencia and v.check_in_at >= rg.d1 and v.check_in_at < rg.d2 + 1) as diferencias,
      count(*) filter (where ls.diferencia and v.check_in_at >= rg.p1 and v.check_in_at < rg.p2 + 1) as diferencias_prev
    from public.levantamiento_sku ls
    join public.levantamiento l on l.id = ls.levantamiento_id
    join public.visita v on v.id = l.visita_id
    join public.tienda t on t.id = v.tienda_id
    cross join rango rg
    where v.check_in_at >= rg.p1 and v.check_in_at < rg.d2 + 1
      and (p_cadena is null or t.cadena_id = p_cadena)
      and (p_tienda is null or t.id = p_tienda)
  ),
  -- Share of Shelf = frentes propios / totales (propios + competencia). La
  -- competencia es un jsonb array [{competidor, frentes}]; se suma su `frentes`.
  sos as (
    select
      round(100.0 * sum(l.sos_frentes_propios) filter (where v.check_in_at >= rg.d1 and v.check_in_at < rg.d2 + 1)
            / nullif(sum(l.sos_frentes_propios + coalesce(comp.total, 0)) filter (where v.check_in_at >= rg.d1 and v.check_in_at < rg.d2 + 1), 0), 1) as actual,
      round(100.0 * sum(l.sos_frentes_propios) filter (where v.check_in_at >= rg.p1 and v.check_in_at < rg.p2 + 1)
            / nullif(sum(l.sos_frentes_propios + coalesce(comp.total, 0)) filter (where v.check_in_at >= rg.p1 and v.check_in_at < rg.p2 + 1), 0), 1) as prev
    from public.levantamiento l
    join public.visita v on v.id = l.visita_id
    join public.tienda t on t.id = v.tienda_id
    cross join rango rg
    cross join lateral (
      select sum((e->>'frentes')::numeric) as total
      from jsonb_array_elements(l.sos_frentes_competencia) e
    ) comp
    where v.check_in_at >= rg.p1 and v.check_in_at < rg.d2 + 1
      and l.sos_frentes_propios is not null
      and (p_cadena is null or t.cadena_id = p_cadena)
      and (p_tienda is null or t.id = p_tienda)
  ),
  -- Exhibiciones negociadas VIGENTES en el período (solapan) vs las CUMPLIDAS. Las
  -- cumplidas cuentan DEALS DISTINTOS hallados instalados y completos en una visita
  -- del período: `count(distinct exhibicion_negociada_id)`, no eventos de visita —
  -- así una misma exhibición hallada en varias visitas no infla la cuenta por
  -- encima de las negociadas (evita "4 / 1").
  exhib_neg as (
    select
      count(*) filter (where en.fecha_inicio <= rg.d2 and (en.fecha_fin is null or en.fecha_fin >= rg.d1)) as actual,
      count(*) filter (where en.fecha_inicio <= rg.p2 and (en.fecha_fin is null or en.fecha_fin >= rg.p1)) as prev
    from public.exhibicion_negociada en
    join public.tienda t on t.id = en.tienda_id
    cross join rango rg
    where (p_cadena is null or t.cadena_id = p_cadena)
      and (p_tienda is null or t.id = p_tienda)
  ),
  exhib_cum as (
    select
      count(distinct e.exhibicion_negociada_id) filter (where e.instalada and e.completa and e.exhibicion_negociada_id is not null and v.check_in_at >= rg.d1 and v.check_in_at < rg.d2 + 1) as actual,
      count(distinct e.exhibicion_negociada_id) filter (where e.instalada and e.completa and e.exhibicion_negociada_id is not null and v.check_in_at >= rg.p1 and v.check_in_at < rg.p2 + 1) as prev
    from public.exhibicion e
    join public.levantamiento l on l.id = e.levantamiento_id
    join public.visita v on v.id = l.visita_id
    join public.tienda t on t.id = v.tienda_id
    cross join rango rg
    where v.check_in_at >= rg.p1 and v.check_in_at < rg.d2 + 1
      and (p_cadena is null or t.cadena_id = p_cadena)
      and (p_tienda is null or t.id = p_tienda)
  ),
  -- Desviaciones de precio detectadas: alertas de precio en el período. La alerta
  -- llega a la tienda por su visita; se acota por cadena/tienda igual.
  precio as (
    select
      count(*) filter (where a.creado_at >= rg.d1 and a.creado_at < rg.d2 + 1) as actual,
      count(*) filter (where a.creado_at >= rg.p1 and a.creado_at < rg.p2 + 1) as prev
    from public.alerta a
    join public.visita v on v.id = a.visita_id
    join public.tienda t on t.id = v.tienda_id
    cross join rango rg
    where a.tipo in ('desviacion_precio', 'promo_no_activa')
      and a.creado_at >= rg.p1 and a.creado_at < rg.d2 + 1
      and (p_cadena is null or t.cadena_id = p_cadena)
      and (p_tienda is null or t.id = p_tienda)
  )
  select
    cumplimiento.actual, cumplimiento.prev,
    coalesce(sku.quiebres, 0), coalesce(sku.quiebres_prev, 0),
    coalesce(sku.diferencias, 0), coalesce(sku.diferencias_prev, 0),
    sos.actual, sos.prev,
    coalesce(exhib_cum.actual, 0), coalesce(exhib_neg.actual, 0),
    coalesce(exhib_cum.prev, 0), coalesce(exhib_neg.prev, 0),
    coalesce(precio.actual, 0), coalesce(precio.prev, 0)
  from cumplimiento, sku, sos, exhib_neg, exhib_cum, precio
  -- La verja de entitlement: módulo apagado => cero filas. `(select ...)` para
  -- que se evalúe una vez por consulta, no por fila.
  where (select app.modulo_habilitado('dashboard'));
$$;

comment on function public.dashboard_kpis(date, date, uuid, uuid) is
  'KPIs del dashboard del portal (período filtrado + período anterior), derivados en la base y acotados por RLS al tenant del cliente. Con el módulo dashboard apagado devuelve cero filas.';

create or replace function public.dashboard_pines(
  p_desde date,
  p_hasta date,
  p_cadena uuid default null,
  p_tienda uuid default null
)
returns table (
  id uuid,
  nombre text,
  lat double precision,
  lon double precision,
  ultima_visita_estado text,
  tiene_alerta boolean,
  visitada boolean
)
language sql
stable
set search_path = ''
as $$
  select
    t.id,
    t.nombre,
    t.lat,
    t.lon,
    (
      select v.estado::text
      from public.visita v
      where v.tienda_id = t.id and v.check_in_at >= p_desde and v.check_in_at < p_hasta + 1
      order by v.check_in_at desc
      limit 1
    ) as ultima_visita_estado,
    exists (
      select 1 from public.alerta a
      join public.visita v on v.id = a.visita_id
      where v.tienda_id = t.id and a.creado_at >= p_desde and a.creado_at < p_hasta + 1
    ) as tiene_alerta,
    exists (
      select 1 from public.visita v
      where v.tienda_id = t.id and v.check_in_at >= p_desde and v.check_in_at < p_hasta + 1
    ) as visitada
  from public.tienda t
  where t.activo = true
    and t.lat is not null and t.lon is not null
    and (p_cadena is null or t.cadena_id = p_cadena)
    and (p_tienda is null or t.id = p_tienda)
    -- La verja: los pines son del módulo `mapa` (la página solo pinta el mapa
    -- con `mapa` habilitado), no del `dashboard` que los pide.
    and (select app.modulo_habilitado('mapa'))
  order by t.nombre;
$$;

comment on function public.dashboard_pines(date, date, uuid, uuid) is
  'Tiendas con coordenadas y las señales para el color del pin del mapa del dashboard. RLS acota al tenant. Con el módulo mapa apagado devuelve cero filas.';

create or replace function public.dashboard_alertas(
  p_desde date,
  p_hasta date,
  p_cadena uuid default null,
  p_tienda uuid default null
)
returns table (
  id uuid,
  tipo public.tipo_alerta,
  severidad public.severidad_alerta,
  tienda_nombre text,
  creado_at timestamptz
)
language sql
stable
set search_path = ''
as $$
  select a.id, a.tipo, a.severidad, t.nombre, a.creado_at
  from public.alerta a
  join public.visita v on v.id = a.visita_id
  join public.tienda t on t.id = v.tienda_id
  where a.creado_at >= p_desde and a.creado_at < p_hasta + 1
    and (p_cadena is null or t.cadena_id = p_cadena)
    and (p_tienda is null or t.id = p_tienda)
    -- La verja: el feed se pinta como parte del DASHBOARD (incondicionalmente),
    -- así que su módulo es `dashboard`; atarlo a `alertas` cambiaría lo que un
    -- cliente solo-dashboard ve hoy.
    and (select app.modulo_habilitado('dashboard'))
  order by a.creado_at desc
  limit 20;
$$;

comment on function public.dashboard_alertas(date, date, uuid, uuid) is
  'Feed de alertas recientes del dashboard del portal, acotado por los filtros globales. RLS acota al tenant. Con el módulo dashboard apagado devuelve cero filas.';

-- --- La bandeja y el detalle de alertas -----------------------------------------

create or replace function public.bandeja_alertas(
  p_desde date,
  p_hasta date,
  p_cadena uuid default null,
  p_tienda uuid default null,
  p_tipo public.tipo_alerta default null,
  p_severidad public.severidad_alerta default null,
  p_estado public.estado_alerta default null,
  p_pagina integer default 1,
  p_por_pagina integer default 50
)
returns table (
  id uuid,
  tipo public.tipo_alerta,
  severidad public.severidad_alerta,
  estado public.estado_alerta,
  creado_at timestamptz,
  tienda_nombre text,
  cadena_nombre text,
  marca_nombre text,
  sku_codigo text,
  sku_nombre text,
  total bigint
)
language plpgsql
stable
set search_path = ''
as $$
declare
  -- Acotado en el servidor: la RPC es alcanzable directamente, no solo desde la
  -- UI, y un `p_por_pagina` enorme convierte una bandeja en una descarga.
  v_por_pagina integer := least(greatest(coalesce(p_por_pagina, 50), 1), 100);
  v_pagina     integer := greatest(coalesce(p_pagina, 1), 1);
begin
  -- La verja de entitlement como guard clause: módulo apagado => bandeja vacía.
  -- En plpgsql la condición se evalúa una sola vez; no necesita el `(select ...)`.
  if not app.modulo_habilitado('alertas') then
    return;
  end if;

  return query
  select
    a.id, a.tipo, a.severidad, a.estado, a.creado_at,
    t.nombre, ca.nombre, ma.nombre, sk.codigo, sk.nombre,
    count(*) over () as total
  from public.alerta a
  -- LEFT y no INNER: `visita_id` y `marca_id` son nullable, y la contingencia de
  -- una VISITA (check-in/check-out) no cuelga de ninguna marca — es frecuente, no
  -- teórico. Con INNER, esas alertas desaparecerían en silencio de la bandeja.
  left join public.visita v on v.id = a.visita_id
  left join public.tienda t on t.id = v.tienda_id
  left join public.cadena ca on ca.id = t.cadena_id
  left join public.marca ma on ma.id = a.marca_id
  left join public.sku sk on sk.id = app.uuid_del_payload(a.payload, 'sku_id')
  -- La ventana es el día de calendario en LIMA, y sobre la columna cruda: un
  -- `creado_at::date between` anularía el índice.
  where a.creado_at >= (p_desde::timestamp at time zone 'America/Lima')
    and a.creado_at < ((p_hasta + 1)::timestamp at time zone 'America/Lima')
    and (p_cadena is null or t.cadena_id = p_cadena)
    and (p_tienda is null or v.tienda_id = p_tienda)
    and (p_tipo is null or a.tipo = p_tipo)
    and (p_severidad is null or a.severidad = p_severidad)
    and (p_estado is null or a.estado = p_estado)
  order by a.creado_at desc, a.id desc
  limit v_por_pagina offset (v_pagina - 1) * v_por_pagina;
end;
$$;

comment on function public.bandeja_alertas(date, date, uuid, uuid, public.tipo_alerta, public.severidad_alerta, public.estado_alerta, integer, integer) is
  'La bandeja de alertas del portal, paginada. `total` es el conteo de la ventana entera, no el de la página. La ventana se resuelve en America/Lima. La RLS acota al tenant de quien llama. Con el módulo alertas apagado devuelve cero filas.';

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
    'foto', app.foto_de_la_alerta(a.visita_id, a.marca_id, a.tipo, a.payload)
  )
  from public.alerta a
  left join public.visita v on v.id = a.visita_id
  left join public.tienda t on t.id = v.tienda_id
  left join public.cadena ca on ca.id = t.cadena_id
  left join public.marca ma on ma.id = a.marca_id
  left join public.sku sk on sk.id = app.uuid_del_payload(a.payload, 'sku_id')
  where a.id = p_alerta_id
    -- La verja: con el módulo apagado, el mismo null indistinguible de "no
    -- existe o no es del tenant" — no se confirma la existencia de la alerta.
    and (select app.modulo_habilitado('alertas'));
$$;

comment on function public.detalle_alerta(uuid) is
  'El detalle de una alerta con su evidencia resuelta, o null si no existe, no es del tenant de quien llama o el módulo alertas está apagado (indistinguibles a propósito). El payload va crudo: darle forma es cosa de la app.';

-- --- La galería -----------------------------------------------------------------
--
-- La verja va en las DOS CTE que tocan datos (`visitas_ventana` y `total`): el
-- resultado con el módulo apagado es el árbol vacío bien formado
-- {visitas_totales: 0, truncado: false, tiendas: []} — la misma forma que "no
-- hubo visitas", que el schema del portal ya parsea.
create or replace function public.galeria_evidencia(
  p_desde        date,
  p_hasta        date,
  p_cadena       uuid             default null,
  p_tienda       uuid             default null,
  p_tipo         public.tipo_foto default null,
  p_tope_visitas integer          default 24
)
returns jsonb
language sql
stable
set search_path = ''
as $$
  with visitas_ventana as (
    select v.id, v.tienda_id, v.check_in_at, v.check_out_at
    from public.visita v
    join public.tienda t on t.id = v.tienda_id
    where
      -- Ventana anclada en Lima y sargable: nunca `col::date between`, que
      -- castea por fila y tira el índice `(tenant_id, check_in_at desc)`.
      --
      -- Ancla en `check_in_at` y no en `foto.capturada_at`: una foto tomada sin
      -- señal y sincronizada tres días después caería en una ventana distinta
      -- que su propia visita, y el cliente vería evidencia sin su contexto.
      v.check_in_at >= (p_desde::timestamp at time zone 'America/Lima')
      and v.check_in_at < ((p_hasta + 1)::timestamp at time zone 'America/Lima')
      and (p_cadena is null or t.cadena_id = p_cadena)
      and (p_tienda is null or v.tienda_id = p_tienda)
      and (select app.modulo_habilitado('galeria'))
    order by v.check_in_at desc
    -- Acotado donde nace. Sin tope, treinta días con cincuenta mercaderistas son
    -- miles de visitas en un solo jsonb y decenas de miles de URLs que firmar.
    -- Esto es un navegador de evidencia, no un almacén.
    limit p_tope_visitas
  ),
  total as (
    select count(*) as n
    from public.visita v
    join public.tienda t on t.id = v.tienda_id
    where v.check_in_at >= (p_desde::timestamp at time zone 'America/Lima')
      and v.check_in_at < ((p_hasta + 1)::timestamp at time zone 'America/Lima')
      and (p_cadena is null or t.cadena_id = p_cadena)
      and (p_tienda is null or v.tienda_id = p_tienda)
      and (select app.modulo_habilitado('galeria'))
  )
  -- Cada nivel ordena por su COLUMNA, nunca por el jsonb recién construido:
  -- `order by x->>'campo'` hace que Postgres re-evalúe el `jsonb_build_object`
  -- entero —subconsultas de quiebres y fotos incluidas— solo para sacar la
  -- clave de orden. Medido: duplica el subplan por nivel, y aquí hay tres
  -- anidados.
  select jsonb_build_object(
    'visitas_totales', (select n from total),
    'truncado', (select n from total) > p_tope_visitas,
    'tiendas', coalesce((
      select jsonb_agg(x order by orden)
      from (
        select jsonb_build_object(
          'id', t.id,
          'nombre', t.nombre,
          'direccion', t.direccion,
          'cadena_nombre', ca.nombre,
          'visitas', (
            select jsonb_agg(y order by orden desc)
            from (
              select jsonb_build_object(
                'id', vv.id,
                'check_in_at', vv.check_in_at,
                'check_out_at', vv.check_out_at,
                'levantamientos', coalesce((
                  select jsonb_agg(z order by orden)
                  from (
                    select jsonb_build_object(
                      'id', le.id,
                      'marca_nombre', ma.nombre,
                      'estado', le.estado,
                      'sos_frentes_propios', le.sos_frentes_propios,
                      'quiebres', (
                        select count(*) from public.levantamiento_sku ls
                        where ls.levantamiento_id = le.id and ls.quiebre
                      ),
                      'antes', public.foto_del_levantamiento(vv.id, le.id, 'antes', p_tipo),
                      'despues', public.foto_del_levantamiento(vv.id, le.id, 'despues', p_tipo),
                      'otras', coalesce((
                        select jsonb_agg(jsonb_build_object(
                          'id', fo.id, 'tipo', fo.tipo,
                          'capturada_at', fo.capturada_at, 'subida_at', fo.subida_at
                        ) order by fo.capturada_at)
                        from public.foto fo
                        where fo.visita_id = vv.id
                          and fo.levantamiento_id = le.id
                          and fo.tipo not in ('selfie', 'antes', 'despues')
                          and (p_tipo is null or fo.tipo = p_tipo)
                      ), '[]'::jsonb)
                    ) as z, ma.nombre as orden
                    from public.levantamiento le
                    join public.marca ma on ma.id = le.marca_id
                    where le.visita_id = vv.id
                  ) niveles
                ), '[]'::jsonb),
                -- Las que no cuelgan de una marca: contingencias de la visita.
                -- La SELFIE nunca sale: es la cara de un empleado de la
                -- outsourcing, no evidencia de tienda. El guardián es este SQL,
                -- no el desplegable de la UI — por eso se excluye aquí aunque
                -- alguien pida `p_tipo := 'selfie'`.
                'fotos_visita', coalesce((
                  select jsonb_agg(jsonb_build_object(
                    'id', fo.id, 'tipo', fo.tipo,
                    'capturada_at', fo.capturada_at, 'subida_at', fo.subida_at
                  ) order by fo.capturada_at)
                  from public.foto fo
                  where fo.visita_id = vv.id
                    and fo.levantamiento_id is null
                    and fo.tipo <> 'selfie'
                    and (p_tipo is null or fo.tipo = p_tipo)
                ), '[]'::jsonb)
              ) as y, vv.check_in_at as orden
              from visitas_ventana vv
              where vv.tienda_id = t.id
            ) porVisita
          )
        ) as x, t.nombre as orden
        from public.tienda t
        join public.cadena ca on ca.id = t.cadena_id
        where exists (select 1 from visitas_ventana vv where vv.tienda_id = t.id)
      ) porTienda
    ), '[]'::jsonb)
  );
$$;

comment on function public.galeria_evidencia(date, date, uuid, uuid, public.tipo_foto, integer) is
  'La evidencia fotográfica de un periodo, agrupada por tienda → visita → marca. La selfie de check-in nunca sale. Acotada a `p_tope_visitas` visitas más recientes; `truncado` lo dice. La RLS decide qué ve quien llama. Con el módulo galeria apagado devuelve el árbol vacío.';

-- --- Perfect Store --------------------------------------------------------------

create or replace function public.perfect_store_agregado(
  p_desde        date,
  p_hasta        date,
  p_marca        uuid default null,
  p_categoria    uuid default null,
  p_tipo_tienda  public.tipo_tienda default null,
  p_tienda       uuid default null,
  p_mercaderista uuid default null,
  p_cadena       uuid default null
)
returns table (
  levantamientos   bigint,
  total_pct        numeric,
  distribucion_pct numeric,
  visibilidad_pct  numeric,
  precio_pct       numeric
)
language sql
stable
set search_path = ''
as $$
  with ventana as (
    select (p_desde::timestamp at time zone 'America/Lima') as inicio,
           ((p_hasta + 1)::timestamp at time zone 'America/Lima') as fin
  ),
  filas as (
    select p.total_pct, p.distribucion_pct,
           null::numeric as visibilidad_pct, p.precio_pct
    from public.puntaje_perfect_store_categoria p
    join public.levantamiento l on l.id = p.levantamiento_id
    join public.visita v on v.id = l.visita_id
    join public.tienda t on t.id = v.tienda_id
    join public.cadena c on c.id = t.cadena_id
    cross join ventana w
    where p_categoria is not null
      and p.categoria_id = p_categoria
      and v.check_in_recibido_at >= w.inicio
      and v.check_in_recibido_at < w.fin
      and (p_marca is null or l.marca_id = p_marca)
      and (p_tipo_tienda is null or c.tipo_tienda = p_tipo_tienda)
      and (p_cadena is null or t.cadena_id = p_cadena)
      and (p_tienda is null or v.tienda_id = p_tienda)
      and (p_mercaderista is null or v.mercaderista_id = p_mercaderista)

    union all

    select p.total_pct, p.distribucion_pct, p.visibilidad_pct, p.precio_pct
    from public.puntaje_perfect_store p
    join public.levantamiento l on l.id = p.levantamiento_id
    join public.visita v on v.id = l.visita_id
    join public.tienda t on t.id = v.tienda_id
    join public.cadena c on c.id = t.cadena_id
    cross join ventana w
    where p_categoria is null
      and v.check_in_recibido_at >= w.inicio
      and v.check_in_recibido_at < w.fin
      and (p_marca is null or l.marca_id = p_marca)
      and (p_tipo_tienda is null or c.tipo_tienda = p_tipo_tienda)
      and (p_cadena is null or t.cadena_id = p_cadena)
      and (p_tienda is null or v.tienda_id = p_tienda)
      and (p_mercaderista is null or v.mercaderista_id = p_mercaderista)
  )
  select count(*),
         round(avg(total_pct), 2),
         round(avg(distribucion_pct), 2),
         round(avg(visibilidad_pct), 2),
         round(avg(precio_pct), 2)
  from filas
  -- La verja va en HAVING y no en WHERE: un agregado sin GROUP BY siempre
  -- devuelve una fila (count=0, nulos); con HAVING falso no devuelve ninguna.
  having (select app.modulo_habilitado('perfect_store'));
$$;

comment on function public.perfect_store_agregado(
  date, date, uuid, uuid, public.tipo_tienda, uuid, uuid, uuid) is
  'Perfect Store agregado en una ventana de días de Lima, filtrable por marca, categoría, tipo de tienda, tienda, mercaderista y cadena. Con categoría devuelve el desglose (sin visibilidad); sin ella, el puntaje del levantamiento. Con el módulo perfect_store apagado devuelve cero filas.';

create or replace function public.perfect_store_serie(
  p_desde        date,
  p_hasta        date,
  p_granularidad public.granularidad_serie default 'semana',
  p_marca        uuid default null,
  p_categoria    uuid default null,
  p_tipo_tienda  public.tipo_tienda default null,
  p_tienda       uuid default null,
  p_cadena       uuid default null
)
returns table (
  periodo        date,
  levantamientos bigint,
  total_pct      numeric
)
language sql
stable
set search_path = ''
as $$
  with unidad as (
    select case p_granularidad
             when 'dia' then 'day'
             when 'semana' then 'week'
             else 'month'
           end as u
  ),
  ventana as (
    select (p_desde::timestamp at time zone 'America/Lima') as inicio,
           ((p_hasta + 1)::timestamp at time zone 'America/Lima') as fin
  ),
  -- Todos los buckets del rango, haya o no visitas.
  buckets as (
    select generate_series(
             date_trunc(u.u, p_desde::timestamp),
             date_trunc(u.u, p_hasta::timestamp),
             ('1 ' || u.u)::interval
           )::date as periodo
    from unidad u
  ),
  puntajes as (
    select date_trunc(
             u.u,
             (v.check_in_recibido_at at time zone 'America/Lima')
           )::date as periodo,
           p.total_pct
    from public.puntaje_perfect_store_categoria p
    join public.levantamiento l on l.id = p.levantamiento_id
    join public.visita v on v.id = l.visita_id
    join public.tienda t on t.id = v.tienda_id
    join public.cadena c on c.id = t.cadena_id
    cross join ventana w
    cross join unidad u
    where p_categoria is not null
      and p.categoria_id = p_categoria
      and v.check_in_recibido_at >= w.inicio
      and v.check_in_recibido_at < w.fin
      and (p_marca is null or l.marca_id = p_marca)
      and (p_tipo_tienda is null or c.tipo_tienda = p_tipo_tienda)
      and (p_cadena is null or t.cadena_id = p_cadena)
      and (p_tienda is null or v.tienda_id = p_tienda)

    union all

    select date_trunc(
             u.u,
             (v.check_in_recibido_at at time zone 'America/Lima')
           )::date as periodo,
           p.total_pct
    from public.puntaje_perfect_store p
    join public.levantamiento l on l.id = p.levantamiento_id
    join public.visita v on v.id = l.visita_id
    join public.tienda t on t.id = v.tienda_id
    join public.cadena c on c.id = t.cadena_id
    cross join ventana w
    cross join unidad u
    where p_categoria is null
      and v.check_in_recibido_at >= w.inicio
      and v.check_in_recibido_at < w.fin
      and (p_marca is null or l.marca_id = p_marca)
      and (p_tipo_tienda is null or c.tipo_tienda = p_tipo_tienda)
      and (p_cadena is null or t.cadena_id = p_cadena)
      and (p_tienda is null or v.tienda_id = p_tienda)
  )
  select b.periodo,
         count(pz.periodo),
         round(avg(pz.total_pct), 2)
  from buckets b
  left join puntajes pz on pz.periodo = b.periodo
  -- La verja: con el módulo apagado no salen NI los buckets vacíos — cero filas,
  -- no una serie de huecos.
  where (select app.modulo_habilitado('perfect_store'))
  group by b.periodo
  order by b.periodo;
$$;

comment on function public.perfect_store_serie(date, date, public.granularidad_serie, uuid, uuid, public.tipo_tienda, uuid, uuid) is
  'La evolución de Perfect Store por bucket. Devuelve TODOS los buckets del rango: uno sin visitas sale con 0 levantamientos y puntaje nulo, no se omite — un hueco tiene que verse como un hueco. Con el módulo perfect_store apagado devuelve cero filas.';

create or replace function public.perfect_store_desglose(
  p_desde       date,
  p_hasta       date,
  p_nivel       public.nivel_perfect_store,
  p_marca       uuid default null,
  p_categoria   uuid default null,
  p_tipo_tienda public.tipo_tienda default null,
  p_tienda      uuid default null,
  p_cadena      uuid default null
)
returns table (
  clave            text,
  etiqueta         text,
  levantamientos   bigint,
  total_pct        numeric,
  distribucion_pct numeric,
  visibilidad_pct  numeric,
  precio_pct       numeric
)
language sql
stable
set search_path = ''
as $$
  with ventana as (
    select (p_desde::timestamp at time zone 'America/Lima') as inicio,
           ((p_hasta + 1)::timestamp at time zone 'America/Lima') as fin
  ),
  filas as (
    -- El desglose por categoría, que es también la única fuente cuando hay una
    -- categoría filtrada. Su visibilidad va nula por lo mismo que en el
    -- agregado: hay una sola medición de share of shelf por visita y no se
    -- puede repartir entre categorías sin inventarla.
    select
      case p_nivel
        when 'categoria'   then p.categoria_id::text
        when 'tipo_tienda' then c.tipo_tienda::text
        when 'cadena'      then t.cadena_id::text
        else                    v.tienda_id::text
      end as clave,
      case p_nivel
        when 'categoria'   then cat.nombre
        when 'tipo_tienda' then coalesce(c.tipo_tienda::text, 'Sin clasificar')
        when 'cadena'      then c.nombre
        else                    t.nombre
      end as etiqueta,
      p.total_pct, p.distribucion_pct,
      null::numeric as visibilidad_pct, p.precio_pct
    from public.puntaje_perfect_store_categoria p
    join public.categoria cat on cat.id = p.categoria_id
    join public.levantamiento l on l.id = p.levantamiento_id
    join public.visita v on v.id = l.visita_id
    join public.tienda t on t.id = v.tienda_id
    join public.cadena c on c.id = t.cadena_id
    cross join ventana w
    where (p_nivel = 'categoria' or p_categoria is not null)
      and (p_categoria is null or p.categoria_id = p_categoria)
      and v.check_in_recibido_at >= w.inicio
      and v.check_in_recibido_at < w.fin
      and (p_marca is null or l.marca_id = p_marca)
      and (p_tipo_tienda is null or c.tipo_tienda = p_tipo_tienda)
      and (p_cadena is null or t.cadena_id = p_cadena)
      and (p_tienda is null or v.tienda_id = p_tienda)

    union all

    select
      case p_nivel
        when 'tipo_tienda' then c.tipo_tienda::text
        when 'cadena'      then t.cadena_id::text
        else                    v.tienda_id::text
      end,
      case p_nivel
        when 'tipo_tienda' then coalesce(c.tipo_tienda::text, 'Sin clasificar')
        when 'cadena'      then c.nombre
        else                    t.nombre
      end,
      p.total_pct, p.distribucion_pct, p.visibilidad_pct, p.precio_pct
    from public.puntaje_perfect_store p
    join public.levantamiento l on l.id = p.levantamiento_id
    join public.visita v on v.id = l.visita_id
    join public.tienda t on t.id = v.tienda_id
    join public.cadena c on c.id = t.cadena_id
    cross join ventana w
    where p_nivel <> 'categoria'
      and p_categoria is null
      and v.check_in_recibido_at >= w.inicio
      and v.check_in_recibido_at < w.fin
      and (p_marca is null or l.marca_id = p_marca)
      and (p_tipo_tienda is null or c.tipo_tienda = p_tipo_tienda)
      and (p_cadena is null or t.cadena_id = p_cadena)
      and (p_tienda is null or v.tienda_id = p_tienda)
  )
  select clave, etiqueta, count(*),
         round(avg(total_pct), 2),
         round(avg(distribucion_pct), 2),
         round(avg(visibilidad_pct), 2),
         round(avg(precio_pct), 2)
  from filas
  -- La verja de entitlement: módulo apagado => cero grupos.
  where (select app.modulo_habilitado('perfect_store'))
  group by clave, etiqueta
  -- Por puntaje ascendente: lo primero que se busca en un tablero de ejecución
  -- es dónde se está fallando. Los nulos al final — un grupo sin puntaje no es
  -- el peor, es uno del que todavía no se sabe nada.
  order by round(avg(total_pct), 2) asc nulls last, etiqueta;
$$;

comment on function public.perfect_store_desglose(
  date, date, public.nivel_perfect_store, uuid, uuid, public.tipo_tienda, uuid, uuid) is
  'Perfect Store agrupado por un nivel del drill-down (categoría, tipo de tienda, cadena o tienda) dentro de la selección. Ordenado por puntaje ascendente: el tablero se abre por donde se está fallando. Con el módulo perfect_store apagado devuelve cero filas.';
