-- La cuarta variable de Perfect Store: material POP y activación en el punto de
-- venta.
--
-- El modelo ya cubría la mitad: `exhibicion_negociada` es lo que la marca
-- COMPROMETE y `exhibicion` lo que el mercaderista AUDITA en tienda. Lo que
-- faltaba es lo que el cliente añadió el 3 ago 2026 —jalavista, glorificador y
-- la activación con promotora— y que el motor leyera la política que MAR-92 ya
-- había dejado configurada.
--
-- LA DECISIÓN QUE EL CLIENTE DEJÓ ABIERTA la resuelve la configuración, por
-- marca: si el POP suma dentro del tope de 100 o por encima ("igual podrías
-- tener 100 puntos de perfect store y esto te suma y te lleva a 110"). El enum
-- `politica_pop` y `peso_pop` existen desde MAR-92; aquí empiezan a usarse.
--
-- ⚠️ ORDEN DE DESPLIEGUE: esta migración va ANTES que cualquier build del móvil
-- que escriba los tipos nuevos. Si un teléfono escribe `'jalavista'` sin que el
-- enum exista, PostgREST responde 22P02, el conector lo clasifica como rechazo
-- permanente y la fila se DESCARTA en silencio. Misma advertencia que dejaron
-- `20260812180000` y `20260819130000`, y el motivo de que la captura vaya en un
-- despliegue posterior.

-- ---------------------------------------------------------------------------
-- 1. Los tipos que faltaban
--
-- Se AMPLÍA el enum en vez de crear una tabla o columnas nuevas: de un jalavista
-- no se pregunta nada que no se pregunte ya de una cabecera —si está
-- (`instalada`), en qué estado (`completa`), cuántas unidades y con qué foto—, y
-- una tabla aparte obligaría a duplicar RLS, grants, stream de sync, trigger de
-- recálculo y el bloque de `detalle_visita`.
--
-- Que un enum llamado `tipo_exhibicion` contenga `'activacion'` es una licencia
-- deliberada: `docs/04` agrupa las tres cosas en el mismo paso del wizard y en la
-- misma variable, y `exhibicion_negociada` modela el mismo hecho comercial — una
-- marca negocia algo con una tienda desde una fecha.
--
-- `'pop'`, que ya existía, se queda como "otro material POP no tipificado". No se
-- migra ninguna fila histórica: no hay datos de producción.
--
-- Los tres van arriba del todo y NADA en este archivo usa sus literales —el motor
-- no se ramifica por tipo—, que es lo que permite que quepan en la misma
-- migración. Si la review pide un índice parcial o un CHECK sobre ellos, esto se
-- parte en dos archivos.
-- ---------------------------------------------------------------------------
alter type public.tipo_exhibicion add value 'jalavista';
alter type public.tipo_exhibicion add value 'glorificador';
alter type public.tipo_exhibicion add value 'activacion';

comment on type public.tipo_exhibicion is
  'Qué se negocia o se consigue en la tienda: los espacios (cabecera, isla, ruma), el material POP (jalavista, glorificador, y `pop` para el que no encaje en ninguno) y la activación con promotora. Los tres últimos llegaron con la variable 4 de Perfect Store.';

-- ---------------------------------------------------------------------------
-- 2. La variable en el puntaje
-- ---------------------------------------------------------------------------
alter table public.puntaje_perfect_store
  add column pop_pct numeric(5, 2) check (pop_pct between 0 and 100);

comment on column public.puntaje_perfect_store.pop_pct is
  'Cumplimiento del material comprometido: presencia y estado de lo negociado, más lo que el mercaderista consiguió por su cuenta. NULL = no evaluada (la marca no comprometió nada), y su peso se renormaliza — un cero penalizaría a quien no negoció material.';

-- ---------------------------------------------------------------------------
-- 3. El total puede pasar de 100
--
-- Con `bonus_sobre_100` el techo real es `100 + peso_pop`, y `peso_pop` tiene su
-- propio CHECK de 0-100: un rango hasta 110 rompería a la primera marca que
-- configure `peso_pop = 25`. `numeric(5,2)` llega a 999,99, así que 200 cabe sin
-- tocar el tipo.
--
-- La restricción pasa a tener NOMBRE PROPIO: la anterior nació de un
-- `add column ... check` y su nombre lo eligió Postgres, así que la siguiente
-- persona que necesite tocarla tendría que adivinarlo.
--
-- Lo que NO se relaja: `pop_pct` y las otras cuatro variables siguen en 0-100
-- (son porcentajes de cumplimiento, no totales), y el desglose por categoría
-- también, porque el POP no entra ahí.
-- ---------------------------------------------------------------------------
alter table public.puntaje_perfect_store
  drop constraint puntaje_perfect_store_total_pct_check;

alter table public.puntaje_perfect_store
  add constraint puntaje_ps_total_pct_rango check (total_pct between 0 and 200);

comment on column public.puntaje_perfect_store.total_pct is
  'El ponderado de Perfect Store. Con la política `dentro_del_tope` no pasa de 100; con `bonus_sobre_100` el material POP se suma POR ENCIMA del promedio y el techo es 100 + peso_pop. El rango 0-200 cubre cualquier peso configurable.';

-- ---------------------------------------------------------------------------
-- 4. La evidencia se ata a SU levantamiento
--
-- `exh_foto_fk` solo llevaba `(foto_id, tenant_id)`, así que apuntar la foto de
-- un jalavista a la selfie del check-in era legal. Es la misma verja que MAR-96
-- puso para la calificación de orden, y reutiliza la unique que aquella creó.
--
-- `no action` y no `set null` por el mismo motivo que allí: al borrar una visita,
-- la cascada se lleva el levantamiento y sus fotos a la vez, y un set-null sobre
-- una fila que ya no existe tropieza. `no action` se comprueba al final de la
-- sentencia.
--
-- Migración segura: hoy no hay una sola fila de `exhibicion` con `foto_id`
-- poblado, así que no hace falta backfill.
--
-- Lo que NO se añade es un CHECK "instalada exige foto". Es la diferencia con
-- MAR-96: allí la columna era nueva y su CHECK no podía romper ninguna escritura
-- existente; `exhibicion` la escriben teléfonos YA desplegados, y un 23514 ahí
-- hace que el conector descarte el paso de exhibiciones del mercaderista en
-- silencio. La obligatoriedad la pone la UI cuando llegue la captura.
-- ---------------------------------------------------------------------------
alter table public.exhibicion drop constraint exh_foto_fk;

alter table public.exhibicion
  add constraint exh_foto_fk
    foreign key (foto_id, levantamiento_id, tenant_id)
    references public.foto (id, levantamiento_id, tenant_id) on delete no action;

-- ---------------------------------------------------------------------------
-- 5. Quién convierte las cinco variables en el número final
--
-- Una función nueva y no un `case` dentro del calculador: tiene DOS consumidores
-- desde el primer día —el motor y la vista previa del panel— y sin ella la
-- aritmética del bonus viviría duplicada en los dos. Con una copia en cada sitio,
-- el admin de una marca `bonus_sobre_100` vería una previa hasta `peso_pop`
-- puntos por debajo del total que el motor produce después: exactamente el bug
-- que MAR-96 tuvo que arreglar para la variable de orden.
--
-- `app.ponderar_perfect_store` se queda intacta y sigue siendo lo que su nombre
-- dice: un promedio ponderado que renormaliza. Meter el bonus ahí la haría
-- devolver 110 y convertiría sus tests en pruebas de dos conceptos a la vez.
-- ---------------------------------------------------------------------------
create function app.total_perfect_store(
  p_config       public.config_perfect_store,
  p_distribucion numeric,
  p_visibilidad  numeric,
  p_precio       numeric,
  p_pop          numeric,
  p_orden        numeric
)
returns numeric
language sql
immutable
set search_path = ''
as $$
  -- El coalesce solo muerde en la fila EFÍMERA que arma `jsonb_populate_record`
  -- en la vista previa del panel: en la tabla la columna es `not null`. Sin él,
  -- la previa de cualquier marca caería al `case` sin rama y devolvería NULL.
  select case coalesce(p_config.politica_pop, 'dentro_del_tope')
    -- El POP es una variable más del promedio: puede BAJAR el total, y el techo
    -- sigue siendo 100.
    when 'dentro_del_tope' then
      app.ponderar_perfect_store(p_config, p_distribucion, p_visibilidad,
                                 p_precio, p_pop, p_orden)
    -- El POP sale del promedio —su peso se renormaliza entre las otras cuatro— y
    -- su cumplimiento se suma POR ENCIMA. Un promedio ponderado no pasa de 100
    -- nunca: el 110 que pidió el cliente solo puede salir de esta suma. Y un POP
    -- malo aquí no resta: deja de sumar, que es lo que significa un bonus.
    when 'bonus_sobre_100' then
      case
        -- Sin ninguna otra variable evaluada no hay nada sobre lo que sumar, y un
        -- total de "10" se leería como una tienda pésima en vez de como "aquí
        -- solo se midió el POP".
        when app.ponderar_perfect_store(p_config, p_distribucion, p_visibilidad,
                                        p_precio, null, p_orden) is null then null
        else app.ponderar_perfect_store(p_config, p_distribucion, p_visibilidad,
                                        p_precio, null, p_orden)
             + coalesce(round(p_config.peso_pop * p_pop / 100, 2), 0)
      end
  end;
$$;

-- Sin `else` a propósito, igual que el `case` de `orden_nivel`: una política
-- nueva sin traducir devuelve NULL —una ausencia visible— en vez de un número
-- plausible pero falso del que salen juicios sobre una tienda. La exhaustividad
-- se pincha en `test:db` recorriendo `enum_range`.
comment on function app.total_perfect_store(
  public.config_perfect_store, numeric, numeric, numeric, numeric, numeric) is
  'El total de Perfect Store aplicando la política de material POP de la marca: `dentro_del_tope` lo pondera como una variable más (techo 100), `bonus_sobre_100` lo saca del promedio y lo suma por encima (techo 100 + peso_pop). Único dueño de la regla: lo usan el motor y la vista previa del panel.';

revoke execute on function app.total_perfect_store(
  public.config_perfect_store, numeric, numeric, numeric, numeric, numeric) from public;
grant execute on function app.total_perfect_store(
  public.config_perfect_store, numeric, numeric, numeric, numeric, numeric)
  to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 6. El calculador
--
-- Se recrea desde el cuerpo que dejó `20260819130000` (la variable de orden),
-- NO desde el de `20260811100000`: copiar el viejo borraría orden y limpieza sin
-- que ninguna migración fallara.
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
  pop         record;
  v_pop_pct   numeric(5, 2);
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

  -- --- 5. Material POP y activación ---------------------------------------
  --
  -- Se puntúa por FILA AUDITADA de `exhibicion`, no por negociación vigente: es
  -- el mismo criterio que distribución ("sin dato" no es "ausente") y no depende
  -- de las fechas de `exhibicion_negociada`, que el wizard del móvil hoy ni
  -- siquiera filtra.
  --
  -- Cada fila vale 0, 50 o 100:
  --   · no instalada, o no vigente          →   0  (no está)
  --   · instalada pero incompleta           →  50  (está, pero a medias)
  --   · instalada y completa                → 100
  --
  -- Los dos `coalesce` son decisiones de DESPLIEGUE, no descuidos:
  --
  --   `completa`: hoy no la escribe nadie —el móvil manda `instalada`,
  --   `unidades` y `vigente`— así que es null en el 100 % de las filas. Sin el
  --   coalesce, el día que esto se despliegue TODA exhibición instalada caería de
  --   100 a 50 sin que nada hubiera cambiado en la tienda. Null significa "el
  --   estado no se midió", no "estaba incompleta". La escritura llega con la
  --   captura del móvil, en un despliegue posterior.
  --
  --   `instalada` en una CONSEGUIDA: el móvil tampoco la escribe hoy. Una
  --   exhibición conseguida existe PORQUE el mercaderista la consiguió; sin el
  --   coalesce valdría 0 y el premio se volvería castigo.
  --
  -- El denominador es SOLO lo comprometido, y las conseguidas suman al numerador
  -- sin entrar en él: así "lo conseguido en tienda" compensa de verdad una
  -- comprometida que la tienda no montó. El `least(100, ...)` es lo que impide
  -- que esa compensación se salga del contrato 0-100 de la columna.
  --
  -- Y el denominador cuenta TODO lo comprometido, no solo los tipos de material:
  -- ninguna otra variable de Perfect Store cubre una cabecera pagada y no
  -- montada, así que dejarla fuera abriría un agujero. El nombre de la variable
  -- se queda corto respecto a lo que mide, y es a propósito.
  select
    count(*) filter (where e.exhibicion_negociada_id is not null) as comprometidas,
    coalesce(sum(
      case
        when not coalesce(e.vigente, true) then 0
        when not coalesce(e.instalada, e.exhibicion_negociada_id is null) then 0
        when coalesce(e.completa, true) then 100
        else 50
      end
    ), 0) as puntos
    into pop
  from public.exhibicion e
  where e.levantamiento_id = p_levantamiento_id;

  -- Sin nada COMPROMETIDO no hay nada que cumplir: la variable no se evalúa y su
  -- peso se renormaliza. Nunca cero — un cero aquí penalizaría a la marca que no
  -- negoció material, que es exactamente lo que el ticket prohíbe. Vale también
  -- cuando el mercaderista consiguió exhibiciones por su cuenta: su trabajo
  -- compensa lo comprometido, pero no inventa un compromiso que no existía.
  v_pop_pct := case
    when pop.comprometidas = 0 then null
    else least(100, round(pop.puntos::numeric / pop.comprometidas, 2))
  end;

  insert into public.puntaje_perfect_store (
    levantamiento_id, tenant_id, config_id,
    distribucion_pct, visibilidad_pct, precio_pct, pop_pct, orden_pct, total_pct,
    skus_codificados, skus_evaluados, skus_presentes,
    skus_precio_evaluados, skus_precio_correctos, sos_real_pct, calculado_at)
  values (
    p_levantamiento_id, ctx.tenant_id, cfg.id,
    v_dist_pct, v_vis_pct, v_pre_pct, v_pop_pct, v_orden_pct,
    -- El total pasa por `app.total_perfect_store` y no por el ponderador a secas:
    -- con `bonus_sobre_100` el POP sale del promedio y se suma por encima, y un
    -- promedio ponderado no pasa de 100 jamás.
    app.total_perfect_store(cfg, v_dist_pct, v_vis_pct, v_pre_pct, v_pop_pct, v_orden_pct),
    dist.codificados, dist.evaluados, dist.presentes,
    pre.evaluados, pre.correctos, v_sos_real, now())
  on conflict (levantamiento_id) do update set
    config_id = excluded.config_id,
    distribucion_pct = excluded.distribucion_pct,
    visibilidad_pct = excluded.visibilidad_pct,
    precio_pct = excluded.precio_pct,
    pop_pct = excluded.pop_pct,
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
    -- La visibilidad va NULA a propósito: su peso se renormaliza. El orden y el
    -- material POP TAMPOCO entran aquí, por el mismo motivo: hay una sola
    -- medición por levantamiento —una góndola, un conjunto de exhibiciones— y
    -- repartirla entre categorías sería inventar una medición que nadie hizo.
    --
    -- Se llama al PONDERADOR y no a `total_perfect_store`: sin POP no hay bonus
    -- que aplicar, y el desglose por categoría se queda topado en 100.
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
-- 7. Una exhibición que llega tarde recalcula el puntaje
--
-- Mismo agujero que MAR-96 cerró para `orden_nivel` y que ya existía para
-- `levantamiento_sku`: una fila reintentada tras el cierre —o el UPDATE que el
-- propio wizard hace al reentrar al paso— dejaría el `pop_pct` corto para
-- siempre, en silencio.
--
-- `app.repuntuar_si_ya_estaba_cerrado()` ya es genérica: lee
-- `new.levantamiento_id`, que `exhibicion` tiene. Cero código nuevo.
-- ---------------------------------------------------------------------------
create trigger exhibicion_repuntua
  after insert or update on public.exhibicion
  for each row execute function app.repuntuar_si_ya_estaba_cerrado();

-- ---------------------------------------------------------------------------
-- 8. La vista previa del panel usa el mismo dueño del total
--
-- Sin esto, el admin de una marca `bonus_sobre_100` vería un previsto sin el
-- bonus —hasta `peso_pop` puntos por debajo— mientras decide qué pesos publicar.
-- También se recrea desde el cuerpo de `20260819130000`.
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
    app.total_perfect_store(
      -- `jsonb_populate_record` arma la fila de configuración a partir de los
      -- pesos sin guardar. Los campos que no vienen quedan nulos y el ponderador
      -- no los mira: solo usa los cinco pesos.
      --
      -- Ojo: la fila es EFÍMERA, nunca se inserta, así que los CHECK de la tabla
      -- (que los pesos sumen 100) NO se evalúan aquí. Una previa con pesos que
      -- no suman 100 devuelve un número fuera del contrato 0-100. Quien llama
      -- valida en su frontera; esto es de solo lectura y no persiste nada.
      jsonb_populate_record(null::public.config_perfect_store, p_pesos),
      p.distribucion_pct, p.visibilidad_pct, p.precio_pct, p.pop_pct, p.orden_pct
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
  'El efecto de unos pesos sin guardar sobre el puntaje de Perfect Store más reciente de una marca. RE-PONDERA lo ya calculado —no recalcula las variables— y aplica la política de material POP que venga en los pesos.';
