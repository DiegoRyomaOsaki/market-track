-- La quinta variable de Perfect Store: orden y limpieza de la exhibición
-- (limpieza, rotación, empaques sin daño).
--
-- Es la más subjetiva de las cinco, y la reunión del 3 ago 2026 cerró CÓMO
-- medirla para que lo sea menos:
--
--   · Nada de que el mercaderista se ponga una nota a sí mismo — "es juez y
--     parte". Una escala CUALITATIVA de tres niveles, y cuánto vale cada nivel
--     lo dice la configuración, no este archivo.
--   · SIEMPRE con foto, para que el supervisor pueda auditar la calificación en
--     vez de creérsela.
--   · Descartada para el piloto la calificación automática por imagen: exige un
--     set de fotos modelo por tipo de tienda que hoy no existe. Lo que se hace
--     ahora es ACUMULAR la evidencia para poder entrenarla después.
--
-- La configuración ya existía (MAR-92): `orden_bien_pts`, `orden_regular_pts` y
-- `orden_mal_pts`, con el CHECK de monotonía. Y el ponderador ya aceptaba la
-- variable (MAR-99): hasta hoy todos sus llamantes pasaban tres argumentos y el
-- peso de orden se renormalizaba en silencio. Este archivo cierra el hueco.
--
-- ⚠️ ORDEN DE DESPLIEGUE: esta migración va ANTES que cualquier build del móvil
-- que escriba `tipo_foto='orden'` o `paso_levantamiento='orden_limpieza'`. Si un
-- teléfono los escribe sin que el enum exista, PostgREST responde 22P02, el
-- conector lo clasifica como rechazo permanente y la fila se DESCARTA en
-- silencio. Es la misma advertencia que dejó `20260812180000` para `campo_extra`,
-- y por eso la captura en el móvil va en un despliegue posterior.

-- ---------------------------------------------------------------------------
-- 1. Los dos valores de enum que el móvil escribirá
--
-- Van al principio y NADA en este archivo los usa como literal: Postgres prohíbe
-- usar un valor de enum nuevo en la misma transacción que lo añade, y el CLI de
-- Supabase envuelve cada migración en una. Si algún día hay que escribir
-- 'orden'::tipo_foto aquí (un índice parcial, un default, un seed en línea), esto
-- se parte en dos archivos — no se negocia.
-- ---------------------------------------------------------------------------
alter type public.paso_levantamiento add value 'orden_limpieza';
alter type public.tipo_foto add value 'orden';

-- ---------------------------------------------------------------------------
-- 2. La escala
--
-- Un enum de tres valores y no un entero 0-10: es el acuerdo de la reunión, y un
-- rango libre invitaría exactamente a la nota numérica que se descartó. Que sean
-- tres lo garantiza el tipo; cuánto vale cada uno lo decide la configuración.
--
-- Un tipo NUEVO sí puede crearse y usarse en la misma migración: la restricción
-- de arriba solo aplica a los valores AÑADIDOS a un enum que ya existía.
-- ---------------------------------------------------------------------------
create type public.nivel_orden as enum ('bien', 'regular', 'mal');

comment on type public.nivel_orden is
  'La escala cualitativa de orden y limpieza. Tres niveles y no una nota numérica: el mercaderista se calificaría a sí mismo. El valor en puntos de cada nivel vive en config_perfect_store.';

-- ---------------------------------------------------------------------------
-- 3. La calificación, en `levantamiento`
--
-- Columnas de la tabla y no campos del formulario configurable: es un paso con
-- lógica de negocio —alimenta el puntaje—, y de esos ya dice la definición del
-- formulario que "los pone la base". Es además lo único que convierte las dos
-- promesas del ticket en garantías: los tres niveles los impone el enum y la
-- foto la impone el CHECK. Un campo libre las dejaría en manos de que el admin
-- configure bien el formulario.
--
-- Es el patrón de `sos_frentes_propios`: el paso hermano que también mide algo
-- del mundo y también alimenta una variable.
-- ---------------------------------------------------------------------------
alter table public.levantamiento
  add column orden_nivel   public.nivel_orden,
  add column orden_foto_id uuid;

-- La foto se enlaza a SU levantamiento, no a cualquiera del mismo cliente.
--
-- Con una FK que solo llevara `tenant_id` —como las tres columnas muertas
-- `foto_antes_id`/`sos_foto_id`/`foto_despues_id`— apuntar la calificación a la
-- selfie del check-in sería perfectamente legal. Esta unique es lo que permite
-- que la FK de abajo exija las tres columnas a la vez.
--
-- Lo que NO puede exigir una FK es `tipo = 'orden'`: no se puede referenciar un
-- índice parcial. Ese lado lo sostienen la app y el trigger de MAR-118, que
-- congela `foto.tipo` y `foto.levantamiento_id` después del insert — así que
-- nadie puede recolocar la evidencia en otro slot una vez sellada.
alter table public.foto
  add constraint foto_id_lev_tenant_uq unique (id, levantamiento_id, tenant_id);

-- ⚠️ `no action`, NO `on delete set null` como las tres columnas hermanas.
--
-- Con el CHECK de abajo encima, `set null` convierte cualquier borrado de la foto
-- en una violación 23514. Y peor: al borrar una `visita`, la cascada dispara a la
-- vez el borrado del `levantamiento` y un set-null SOBRE ESE MISMO levantamiento,
-- que ya no debería existir. `no action` se comprueba al FINAL de la sentencia,
-- cuando la cascada ya se llevó la fila y no queda nada que verificar; `restrict`
-- es inmediato y sí fallaría.
--
-- Un `delete from foto` suelto sigue dando 23503, que es lo correcto: no se
-- retira la evidencia que sostiene una calificación.
alter table public.levantamiento
  add constraint lev_orden_foto_fk
    foreign key (orden_foto_id, id, tenant_id)
    references public.foto (id, levantamiento_id, tenant_id) on delete no action;

-- "La foto acompaña SIEMPRE a la calificación".
--
-- Lo que garantiza es que no existe una calificación sin una FILA de evidencia
-- declarada en el mismo instante: la fila `foto` la escribe el móvil al capturar,
-- en su réplica local, sin señal. El BINARIO llega a R2 horas después (`subida_at`
-- sigue null hasta entonces, y `verificada_at` hasta que el barrido lo comprueba).
-- Exigir aquí la imagen subida rompería el offline-first, que es el diferenciador
-- del producto; exigir la evidencia declarada es lo auditable.
alter table public.levantamiento
  add constraint lev_orden_exige_foto check (
    orden_nivel is null or orden_foto_id is not null
  );

comment on column public.levantamiento.orden_nivel is
  'La calificación cualitativa de orden y limpieza de la góndola. NULL = no evaluada (el paso se omitió por contingencia), que NUNCA es lo mismo que "mal": su peso se renormaliza entre las demás variables.';
comment on column public.levantamiento.orden_foto_id is
  'La foto que sostiene la calificación. Obligatoria si hay nivel (CHECK): sin evidencia, la nota dependería del criterio del mercaderista. Apunta a una foto DE ESTE levantamiento, por FK de tres columnas.';

-- ---------------------------------------------------------------------------
-- 4. La variable en el puntaje
-- ---------------------------------------------------------------------------
alter table public.puntaje_perfect_store
  add column orden_pct numeric(5, 2) check (orden_pct between 0 and 100);

comment on column public.puntaje_perfect_store.orden_pct is
  'La quinta variable: los puntos que la configuración le da al nivel calificado. NULL = no evaluada, y su peso se renormaliza — un cero aquí convertiría un paso omitido en una góndola sucia.';

-- ---------------------------------------------------------------------------
-- 5. El calculador
--
-- Se recrea entero porque una función es su cuerpo. Cambia SOLO lo de orden: se
-- lee `l.orden_nivel`, se traduce a puntos con la configuración y se pasa como
-- sexto argumento del ponderador.
-- ---------------------------------------------------------------------------
create or replace function app.calcular_puntaje_perfect_store(p_levantamiento_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  ctx         record;
  cfg         public.config_perfect_store;
  dist        record;
  sos         record;
  pre         record;
  v_dist_pct  numeric(5, 2);
  v_vis_pct   numeric(5, 2);
  v_sos_real  numeric(5, 2);
  v_pre_pct   numeric(5, 2);
  v_orden_pct numeric(5, 2);
begin
  select l.tenant_id, l.marca_id, l.estado, l.sos_frentes_propios,
         l.sos_frentes_competencia, l.orden_nivel,
         v.tienda_id, t.cadena_id, c.tipo_tienda,
         (v.check_in_recibido_at at time zone 'America/Lima')::date as fecha
    into ctx
  from public.levantamiento l
  join public.visita v on v.id = l.visita_id
  join public.tienda t on t.id = v.tienda_id
  join public.cadena c on c.id = t.cadena_id
  where l.id = p_levantamiento_id;

  if not found then return; end if;

  if ctx.estado <> 'completado' then
    delete from public.puntaje_perfect_store where levantamiento_id = p_levantamiento_id;
    return;
  end if;

  cfg := app.config_perfect_store_aplicable(
    ctx.tenant_id, ctx.marca_id, null, ctx.tipo_tienda, ctx.fecha);
  if cfg.id is null then
    delete from public.puntaje_perfect_store where levantamiento_id = p_levantamiento_id;
    return;
  end if;

  select count(*)                                              as codificados,
         count(ls.id)                                          as evaluados,
         count(ls.id) filter (where coalesce(ls.quiebre, false) = false) as presentes
    into dist
  from public.tienda_sku ts
  join public.sku s
    on s.id = ts.sku_id and s.tenant_id = ts.tenant_id
  left join public.levantamiento_sku ls
    on ls.levantamiento_id = p_levantamiento_id and ls.sku_id = ts.sku_id
  where ts.tenant_id = ctx.tenant_id
    and ts.tienda_id = ctx.tienda_id
    and ts.activo
    and s.marca_id = ctx.marca_id
    and s.activo;

  v_dist_pct := round(100.0 * dist.presentes / nullif(dist.evaluados, 0), 2);

  select ctx.sos_frentes_propios as propios,
         coalesce(comp.total, 0) as competencia
    into sos
  from (select sum((e->>'frentes')::numeric) as total
        from jsonb_array_elements(ctx.sos_frentes_competencia) e) comp;

  if sos.propios is not null and (sos.propios + sos.competencia) > 0 then
    v_sos_real := round(100.0 * sos.propios / (sos.propios + sos.competencia), 2);
    v_vis_pct := least(100, round(100.0 * v_sos_real / cfg.sos_objetivo_pct, 2));
  end if;

  select count(*) filter (
           where v.veredicto <> 'sin_precio_vigente') as evaluados,
         count(*) filter (where v.veredicto = 'correcto') as correctos
    into pre
  from public.levantamiento_sku ls
  cross join lateral app.evaluar_precio_sku(
    ls.tenant_id, ls.sku_id, ctx.marca_id, ctx.cadena_id, ls.precio_registrado,
    ls.hay_promo, ls.promo_comunicada, ctx.fecha) v
  where ls.levantamiento_id = p_levantamiento_id
    and ls.precio_registrado is not null;

  v_pre_pct := round(100.0 * pre.correctos / nullif(pre.evaluados, 0), 2);

  -- --- 4. Orden y limpieza -------------------------------------------------
  --
  -- El nivel se traduce a puntos con la configuración VIGENTE para esta visita,
  -- que es la misma que produce el resto del puntaje. Los `orden_*_pts` ya son
  -- 0-100, así que no hay aritmética: el valor entra tal cual.
  --
  -- Sin `else` a propósito: un nivel que este `case` no reconozca sale NULL, o
  -- sea "no evaluado", y su peso se renormaliza. Un `raise` sería peor de lo que
  -- parece — esta función corre dentro del trigger que dispara el `update` que
  -- sube el teléfono, y un SQLSTATE ahí hace que el conector clasifique la
  -- operación como rechazo permanente y DESCARTE el levantamiento del
  -- mercaderista. La exhaustividad se pincha en `test:db`, que es donde un valor
  -- nuevo sin traducir tiene que ponerse rojo.
  v_orden_pct := case ctx.orden_nivel
    when 'bien'    then cfg.orden_bien_pts
    when 'regular' then cfg.orden_regular_pts
    when 'mal'     then cfg.orden_mal_pts
  end;

  insert into public.puntaje_perfect_store (
    levantamiento_id, tenant_id, config_id,
    distribucion_pct, visibilidad_pct, precio_pct, orden_pct, total_pct,
    skus_codificados, skus_evaluados, skus_presentes,
    skus_precio_evaluados, skus_precio_correctos, sos_real_pct, calculado_at)
  values (
    p_levantamiento_id, ctx.tenant_id, cfg.id,
    v_dist_pct, v_vis_pct, v_pre_pct, v_orden_pct,
    -- El `null` de material POP va EXPLÍCITO: los argumentos son posicionales y
    -- el de orden es el sexto. Esa variable llega en su propio ticket; hasta
    -- entonces su peso se renormaliza igual que hasta ahora.
    app.ponderar_perfect_store(cfg, v_dist_pct, v_vis_pct, v_pre_pct, null, v_orden_pct),
    dist.codificados, dist.evaluados, dist.presentes,
    pre.evaluados, pre.correctos, v_sos_real, now())
  on conflict (levantamiento_id) do update set
    config_id = excluded.config_id,
    distribucion_pct = excluded.distribucion_pct,
    visibilidad_pct = excluded.visibilidad_pct,
    precio_pct = excluded.precio_pct,
    orden_pct = excluded.orden_pct,
    total_pct = excluded.total_pct,
    skus_codificados = excluded.skus_codificados,
    skus_evaluados = excluded.skus_evaluados,
    skus_presentes = excluded.skus_presentes,
    skus_precio_evaluados = excluded.skus_precio_evaluados,
    skus_precio_correctos = excluded.skus_precio_correctos,
    sos_real_pct = excluded.sos_real_pct,
    calculado_at = excluded.calculado_at;

  delete from public.puntaje_perfect_store_categoria
  where levantamiento_id = p_levantamiento_id;

  insert into public.puntaje_perfect_store_categoria (
    levantamiento_id, categoria_id, tenant_id, config_id,
    distribucion_pct, precio_pct, total_pct,
    skus_codificados, skus_evaluados, skus_presentes,
    skus_precio_evaluados, skus_precio_correctos)
  select
    p_levantamiento_id, x.categoria_id, ctx.tenant_id, cfg.id,
    x.dist_pct, x.pre_pct,
    -- La visibilidad va NULA a propósito: su peso se renormaliza. Y el orden
    -- TAMPOCO entra aquí, por el mismo motivo: hay una sola calificación por
    -- levantamiento —la góndola es una— y repartirla entre categorías sería
    -- inventar una medición que nadie hizo.
    app.ponderar_perfect_store(cfg, x.dist_pct, null, x.pre_pct),
    x.codificados, x.evaluados, x.presentes,
    x.precio_evaluados, x.precio_correctos
  from (
    select
      s.categoria_id,
      count(*) as codificados,
      count(ls.id) as evaluados,
      count(ls.id) filter (where coalesce(ls.quiebre, false) = false) as presentes,
      round(100.0 * count(ls.id) filter (where coalesce(ls.quiebre, false) = false)
            / nullif(count(ls.id), 0), 2) as dist_pct,
      count(v.veredicto) filter (
        where v.veredicto <> 'sin_precio_vigente') as precio_evaluados,
      count(v.veredicto) filter (where v.veredicto = 'correcto') as precio_correctos,
      round(100.0 * count(v.veredicto) filter (where v.veredicto = 'correcto')
            / nullif(count(v.veredicto) filter (
                where v.veredicto <> 'sin_precio_vigente'), 0), 2) as pre_pct
    from public.tienda_sku ts
    join public.sku s
      on s.id = ts.sku_id and s.tenant_id = ts.tenant_id
    left join public.levantamiento_sku ls
      on ls.levantamiento_id = p_levantamiento_id and ls.sku_id = ts.sku_id
    left join lateral app.evaluar_precio_sku(
      ctx.tenant_id, ts.sku_id, ctx.marca_id, ctx.cadena_id, ls.precio_registrado,
      ls.hay_promo, ls.promo_comunicada, ctx.fecha) v
      on ls.precio_registrado is not null
    where ts.tenant_id = ctx.tenant_id
      and ts.tienda_id = ctx.tienda_id
      and ts.activo
      and s.marca_id = ctx.marca_id
      and s.activo
      and s.categoria_id is not null
    group by s.categoria_id
  ) x;
end;
$$;

-- ---------------------------------------------------------------------------
-- 6. El puntaje no se queda rancio cuando la calificación llega tarde
--
-- El trigger escuchaba solo `estado`, y por eso ya existe el de
-- `levantamiento_sku`: "un SKU puede llegar DESPUÉS de que el levantamiento ya
-- se cerró". `orden_nivel` vive en la propia tabla `levantamiento` y sufre
-- exactamente lo mismo — una operación reintentada más tarde, o una corrección
-- de la calificación, dejaría el puntaje calculado sin ella y nadie lo
-- recalcularía nunca. Un puntaje que se queda corto en silencio es peor que uno
-- que falta.
--
-- No hay `alter trigger` para la lista de columnas: se recrea.
-- `app.puntuar_al_completar` ya sale limpio si el estado no es `completado`, y
-- el recálculo es idempotente por el `on conflict`. No hay bucle: escribe
-- `puntaje_perfect_store`, no `levantamiento`.
-- ---------------------------------------------------------------------------
drop trigger levantamiento_puntua_al_completar on public.levantamiento;

create trigger levantamiento_puntua_al_completar
  after update of estado, orden_nivel on public.levantamiento
  for each row
  when (new.estado is distinct from old.estado
        or new.orden_nivel is distinct from old.orden_nivel)
  execute function app.puntuar_al_completar();

-- ---------------------------------------------------------------------------
-- 7. La vista previa del panel tiene que ver la misma variable
--
-- Sin esto, `total_actual` incluiría el orden (lo calcula el motor) y
-- `total_previsto` no: el admin vería una previsualización que MIENTE sobre el
-- efecto de los pesos que está a punto de publicar.
-- ---------------------------------------------------------------------------
create or replace function public.previsualizar_perfect_store(
  p_marca_id uuid,
  p_pesos    jsonb
)
returns table (
  levantamiento_id uuid,
  tienda_nombre    text,
  calculado_at     timestamptz,
  total_actual     numeric,
  total_previsto   numeric
)
language sql
stable
security invoker
set search_path = ''
as $$
  select
    p.levantamiento_id,
    t.nombre,
    p.calculado_at,
    p.total_pct,
    app.ponderar_perfect_store(
      -- `jsonb_populate_record` arma la fila de configuración a partir de los
      -- pesos sin guardar. Los campos que no vienen quedan nulos y el ponderador
      -- no los mira: solo usa los cinco pesos.
      --
      -- Ojo: la fila es EFÍMERA, nunca se inserta, así que los CHECK de la tabla
      -- (que los pesos sumen 100) NO se evalúan aquí. Una previa con pesos que
      -- no suman 100 devuelve un número fuera del contrato 0-100. Quien llama
      -- valida en su frontera; esto es de solo lectura y no persiste nada.
      jsonb_populate_record(null::public.config_perfect_store, p_pesos),
      -- El `null` de material POP va EXPLÍCITO: los argumentos son posicionales
      -- y el de orden es el sexto.
      p.distribucion_pct, p.visibilidad_pct, p.precio_pct, null, p.orden_pct
    )
  from public.puntaje_perfect_store p
  join public.levantamiento l on l.id = p.levantamiento_id
  join public.visita v on v.id = l.visita_id
  join public.tienda t on t.id = v.tienda_id
  where l.marca_id = p_marca_id
  order by p.calculado_at desc
  limit 1;
$$;

comment on function public.previsualizar_perfect_store(uuid, jsonb) is
  'El efecto de unos pesos sin guardar sobre el puntaje de Perfect Store más reciente de una marca. RE-PONDERA lo ya calculado: no recalcula las variables, así que un objetivo de share of shelf distinto no se refleja.';

-- ---------------------------------------------------------------------------
-- 8. El supervisor ve la calificación junto a su foto
--
-- La foto YA llegaba: `detalle_visita` devuelve todas las de la visita con su
-- `levantamiento_id` y su `tipo`, y la pantalla las agrupa. Lo que faltaba era la
-- nota al lado — sin ella, la foto de la góndola no dice qué calificó el
-- mercaderista.
--
-- "Revisable" es el flujo que ya existe: el supervisor aprueba o rechaza el
-- reporte completo con `revisar_visita`. No se añade una revisión por variable,
-- que sería un segundo dueño de la decisión de calidad.
-- ---------------------------------------------------------------------------
create or replace function public.detalle_visita(p_visita_id uuid)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_build_object(
    'visita', jsonb_build_object(
      'id', v.id,
      'tienda_nombre', t.nombre,
      'cadena_nombre', ca.nombre,
      'mercaderista_nombre', p.nombre,
      'check_in_at', v.check_in_at,
      'check_out_at', v.check_out_at,
      'duracion_min', (extract(epoch from (v.check_out_at - v.check_in_at)) / 60)::integer,
      'check_in_geocerca_ok', v.check_in_geocerca_ok,
      'check_out_geocerca_ok', v.check_out_geocerca_ok,
      'bitacora', v.bitacora,
      'tiempo_traslado_min', v.tiempo_traslado_min,
      'bateria_inicio_pct', v.bateria_inicio_pct
    ),
    'revision', case when r.id is null then null else jsonb_build_object(
      'decision', r.decision,
      'motivo', r.motivo,
      'revisor_nombre', rev.nombre,
      'revisado_at', r.revisado_at
    ) end,
    'levantamientos', coalesce((
      -- Se ordena por la columna CRUDA, no por el jsonb recién construido:
      -- ordenar por `lev->>'marca_nombre'` obliga a Postgres a re-evaluar el
      -- `jsonb_build_object` entero —subconsultas incluidas— solo para sacar la
      -- clave de orden. `galeria_evidencia` ya lo corrigió; esta se quedó atrás
      -- y hay que recrearla de todos modos.
      select jsonb_agg(lev order by orden_marca)
      from (
        select jsonb_build_object(
          'id', le.id,
          'marca_nombre', ma.nombre,
          'estado', le.estado,
          'sos_frentes_propios', le.sos_frentes_propios,
          'sos_frentes_competencia', le.sos_frentes_competencia,
          -- La calificación de orden y limpieza viaja con su foto: el supervisor
          -- la audita mirando la evidencia, no creyéndose la nota.
          'orden_nivel', le.orden_nivel,
          'orden_foto_id', le.orden_foto_id,
          'skus', coalesce((
            select jsonb_agg(jsonb_build_object(
              'codigo', s.codigo,
              'nombre', s.nombre,
              'stock_sistema', ls.stock_sistema,
              'stock_piso', ls.stock_piso,
              -- Columnas generadas: el quiebre y la diferencia tienen un solo
              -- calculador y no es este.
              'quiebre', ls.quiebre,
              'diferencia', ls.diferencia,
              'precio_registrado', ls.precio_registrado,
              'hay_promo', ls.hay_promo,
              'promo_comunicada', ls.promo_comunicada
            ) order by s.nombre)
            from public.levantamiento_sku ls
            join public.sku s on s.id = ls.sku_id
            where ls.levantamiento_id = le.id
          ), '[]'::jsonb),
          'exhibiciones', coalesce((
            select jsonb_agg(jsonb_build_object(
              'tipo', coalesce(ex.tipo_adicional::text, en.tipo::text),
              'negociada', ex.exhibicion_negociada_id is not null,
              'instalada', ex.instalada,
              'unidades', ex.unidades,
              'completa', ex.completa,
              'vigente', ex.vigente
            ))
            from public.exhibicion ex
            left join public.exhibicion_negociada en
              on en.id = ex.exhibicion_negociada_id
            where ex.levantamiento_id = le.id
          ), '[]'::jsonb),
          'respuestas', coalesce((
            select jsonb_agg(jsonb_build_object(
              'campo_id', re.campo_id,
              'valor', re.valor
            ) order by re.campo_id)
            from public.levantamiento_respuesta re
            where re.levantamiento_id = le.id
          ), '[]'::jsonb)
        ) as lev, ma.nombre as orden_marca
        from public.levantamiento le
        join public.marca ma on ma.id = le.marca_id
        where le.visita_id = v.id
      ) niveles
    ), '[]'::jsonb),
    'contingencias', coalesce((
      select jsonb_agg(jsonb_build_object(
        'paso', c.paso,
        'motivo', c.motivo,
        'comentario', c.comentario,
        'registrada_at', c.registrada_at,
        'levantamiento_id', c.levantamiento_id
      ) order by c.registrada_at)
      from public.contingencia c where c.visita_id = v.id
    ), '[]'::jsonb),
    'fotos', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', fo.id,
        'levantamiento_id', fo.levantamiento_id,
        'tipo', fo.tipo,
        'capturada_at', fo.capturada_at,
        'subida_at', fo.subida_at
      ) order by fo.capturada_at)
      from public.foto fo where fo.visita_id = v.id
    ), '[]'::jsonb)
  )
  from public.visita v
  join public.profile p on p.id = v.mercaderista_id
  join public.tienda t on t.id = v.tienda_id
  join public.cadena ca on ca.id = t.cadena_id
  left join public.revision_visita r on r.visita_id = v.id
  left join public.profile rev on rev.id = r.revisor_id
  where v.id = p_visita_id;
$$;
