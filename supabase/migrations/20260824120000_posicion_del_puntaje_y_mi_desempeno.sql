-- La posición del plan de lealtad se GUARDA, y pasa a tener un solo dueño.
--
-- El teléfono del mercaderista solo recibe SU fila —decisión explícita del
-- cliente: "que tú veas tu puntaje y tu posición, tú solo"— y con una fila no se
-- puede calcular un rango. O la posición viaja guardada, o el móvil no puede
-- enseñarla. Y si el móvil la recalculase por su cuenta, el panel diría "2.º" y
-- el teléfono "3.º" del mismo periodo: de ese número sale un bono.
--
-- Así que la ventana `rank()` que MAR-102 escribió dentro de
-- `ranking_merchandiser` se MUEVE a `app.posicionar_merchandiser`, y el ranking
-- del panel pasa a LEER la columna. Un solo dueño, dos consumidores —el mismo
-- patrón que `app.puntaje_de_parada` con el motor y el detalle.
--
-- Migración ADITIVA en el esquema: no borra ninguna columna ni estrecha ninguna
-- política, así que durante el despliegue el código viejo sigue funcionando.

-- ---------------------------------------------------------------------------
-- 1. Las columnas
--
-- `id` es una columna SUSTITUTA, y no es cosmética: PowerSync identifica cada
-- fila replicada por una columna `id` única por tabla, y esta tabla tiene clave
-- compuesta `(mercaderista_id, tipo, periodo_inicio)`. Aliasar `mercaderista_id
-- AS id` en la sync rule colapsaría TODOS los periodos de una persona en una
-- sola fila local: la evolución del ticket desaparecería sin un solo error.
-- Concatenar la clave está descartado por la regla del proyecto —una clave
-- compuesta no se une con un delimitador.
--
-- `posicion` es nullable a propósito: NULL ⇔ `total_pct` NULL, o sea "no
-- evaluado", que NO es el último puesto. Y no lleva un CHECK que ate las dos
-- columnas porque el motor escribe la fila ANTES de posicionarla: existiría un
-- instante con total y sin posición, y el CHECK rompería el motor.
-- ---------------------------------------------------------------------------
alter table public.puntaje_merchandiser
  add column id uuid not null default gen_random_uuid(),
  add column posicion integer,
  add column mercaderistas_evaluados integer not null default 0,
  add column hay_empate boolean not null default false,
  add constraint pm_posicion_positiva check (posicion is null or posicion > 0),
  add constraint pm_evaluados_no_negativo check (mercaderistas_evaluados >= 0);

create unique index puntaje_pm_id_uq on public.puntaje_merchandiser (id);

-- Y la identidad de réplica pasa a ese índice. Con la DEFAULT, un DELETE emite
-- la clave primaria compuesta y PowerSync no sabría qué fila local borrar: el
-- puntaje de un periodo que ya no existe se quedaría para siempre en el
-- teléfono. El motor SÍ borra (la rama sin configuración de
-- `calcular_puntaje_merchandiser`), así que este caso no es hipotético.
alter table public.puntaje_merchandiser
  replica identity using index puntaje_pm_id_uq;

comment on column public.puntaje_merchandiser.id is
  'Clave sustituta para la réplica del móvil: PowerSync identifica cada fila por `id` y la clave real es compuesta. Estable entre recálculos (el upsert no la toca).';
comment on column public.puntaje_merchandiser.posicion is
  'La posición en el ranking del cliente, por rango de COMPETICIÓN. NULL cuando `total_pct` es NULL: "sin datos" no es el último puesto. La escribe solo `app.posicionar_merchandiser`.';
comment on column public.puntaje_merchandiser.mercaderistas_evaluados is
  'Cuántos mercaderistas del cliente tienen puntaje en este periodo — el "de N". Se guarda porque el teléfono recibe UNA fila y no puede contarlo.';
comment on column public.puntaje_merchandiser.hay_empate is
  'Si esta posición la comparte otro mercaderista. Tampoco es derivable desde una sola fila.';

-- ---------------------------------------------------------------------------
-- 2. El único dueño de la ventana
--
-- `cerrado_at` congela el PUNTAJE, no la POSICIÓN, y esto no es un descuido:
-- el bono sale de un umbral sobre `total_pct` (`app.nivel_bono_aplicable`),
-- nunca de la posición, así que recolocar a alguien de un periodo ya cerrado no
-- mueve un sol. Y la posición es función del CONJUNTO: congelarla dejaría al
-- 2.º de un periodo cerrado marcado como 2.º cuando el compañero cuyo teléfono
-- sincronizó tarde ya lo pasó. El ranking del panel ya se comportaba así —su
-- `rank()` corría sobre todas las filas del periodo sin mirar `cerrado_at`—;
-- esta columna solo hace visible una regla que ya regía.
-- ---------------------------------------------------------------------------
create function app.posicionar_merchandiser(
  p_tenant uuid,
  p_tipo   public.periodo_puntaje,
  p_inicio date
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_movidas integer;
begin
  -- `materialized` no es decoración: sin ella el planificador puede elegir un
  -- nested loop que RE-EJECUTA la ventana una vez por fila candidata. Medido
  -- sobre 500 mercaderistas de un cliente: 203 ms con estadísticas rancias,
  -- 18 ms tras un `analyze`, 1,35 ms materializando. Y las rancias son el caso
  -- NORMAL aquí: esta función corre justo después de una ráfaga de escrituras
  -- sobre las mismas filas, y toca una porción tan pequeña de la tabla que su
  -- propia rotación puede no alcanzar nunca el umbral del autovacuum.
  -- Materializar dice lo que ya debía pasar: la ventana se calcula UNA vez.
  with ventana as materialized (
    select
      pm.mercaderista_id,
      -- Rango de COMPETICIÓN (91/88/88/74 → 1, 2, 2, 4), no denso: de esto sale
      -- dinero, y "somos los dos segundos, y el siguiente es el cuarto" es la
      -- lectura que la gente hace de un ranking con premio. Un total NULL queda
      -- FUERA de la ventana: no tiene posición y no desplaza a nadie.
      case when pm.total_pct is not null then
        (rank() over (order by pm.total_pct desc nulls last))::integer
      end as posicion,
      (pm.total_pct is not null
        and count(*) over (partition by pm.total_pct) > 1) as hay_empate,
      (count(*) filter (where pm.total_pct is not null) over ())::integer
        as evaluados
    from public.puntaje_merchandiser pm
    where pm.tenant_id = p_tenant
      and pm.tipo = p_tipo
      and pm.periodo_inicio = p_inicio
  )
  update public.puntaje_merchandiser pm
     set posicion                = v.posicion,
         hay_empate              = v.hay_empate,
         mercaderistas_evaluados = v.evaluados
    from ventana v
   where pm.mercaderista_id = v.mercaderista_id
     and pm.tenant_id = p_tenant
     and pm.tipo = p_tipo
     and pm.periodo_inicio = p_inicio
     -- Solo lo que de verdad se movió. Cada UPDATE genera WAL y PowerSync
     -- empuja la fila al teléfono de su dueño: sin esta guardia, recolocar un
     -- cliente entero reescribiría las N filas aunque ninguna cambiara de
     -- puesto. Y es lo que hace la función idempotente y auto-sanadora.
     and (pm.posicion is distinct from v.posicion
       or pm.hay_empate is distinct from v.hay_empate
       or pm.mercaderistas_evaluados is distinct from v.evaluados);

  get diagnostics v_movidas = row_count;
  return v_movidas;
end;
$$;

comment on function app.posicionar_merchandiser(uuid, public.periodo_puntaje, date) is
  'Recoloca a TODOS los mercaderistas de un cliente en un periodo y devuelve cuántas filas se movieron. Único dueño de la posición: el ranking del panel la lee, no la recalcula, y el móvil la recibe replicada. Deliberadamente ignora `cerrado_at`: el sello congela el puntaje —de donde sale el bono—, no la posición, que es función del conjunto. `calculado_at` no se toca: recolocar no es recalcular.';

revoke execute on function app.posicionar_merchandiser(uuid, public.periodo_puntaje, date) from public;
grant execute on function app.posicionar_merchandiser(uuid, public.periodo_puntaje, date)
  to service_role;

-- ---------------------------------------------------------------------------
-- 3. El recálculo recoloca, una vez por cliente tocado
--
-- Aquí y no dentro de `app.calcular_puntaje_merchandiser`, por dos razones: el
-- motor calcula UNA persona y la posición es del CONJUNTO —llamarlo desde
-- dentro recolocaría el cliente entero N veces por barrido—, y recrear el motor
-- exigiría copiar sus ~380 líneas, que es justo el riesgo que su propia
-- migración documenta ("copiar el viejo desharía el cambio de lectura sin que
-- ninguna migración fallara").
--
-- Es el ÚNICO llamante del motor en producción, así que la invariante que
-- sostiene es: tras un recálculo no queda ninguna fila con `total_pct` no nulo
-- y `posicion` nula. Hay un test que la fija.
--
-- `create or replace` y no `drop`+`create`: la firma no cambia, así que los
-- grants y el comentario de MAR-102 siguen en pie.
-- ---------------------------------------------------------------------------
create or replace function public.recalcular_puntaje_merchandiser(
  p_tipo         public.periodo_puntaje,
  p_inicio       date,
  p_mercaderista uuid default null,
  p_tenant       uuid default null
)
returns table (procesados integer, bloqueados integer)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ids uuid[] := '{}';
  v_id  uuid;
begin
  if not app.es_staff() then
    raise exception 'solo el staff recalcula el plan de lealtad' using errcode = '42501';
  end if;

  for v_id in
    select p.id
    from public.profile p
    where p.rol = 'mercaderista'
      and p.tenant_id is not null
      and (p_mercaderista is null or p.id = p_mercaderista)
      and (p_tenant is null or p.tenant_id = p_tenant)
  loop
    perform app.calcular_puntaje_merchandiser(v_id, p_tipo, p_inicio);
    v_ids := v_ids || v_id;
  end loop;

  -- La posición se recoloca DESPUÉS del bucle y una sola vez por cliente: es
  -- función del conjunto, y recolocar dentro del bucle sería O(n²) escrituras.
  -- Se recorren los clientes de los PROCESADOS y no `p_tenant`, porque el
  -- barrido del operador (`p_tenant` nulo) toca varios; y recalcular a un solo
  -- mercaderista mueve igualmente a sus compañeros, así que el ámbito de la
  -- recolocación es el cliente aunque venga `p_mercaderista`.
  for v_id in
    select distinct p.tenant_id
    from public.profile p
    where p.id = any(v_ids)
  loop
    perform app.posicionar_merchandiser(v_id, p_tipo, p_inicio);
  end loop;

  -- Se acumulan los ids en vez de repetir el `where` del bucle: un solo dueño de
  -- "a quién se le pasó". Y una sola consulta al final, no una por mercaderista.
  return query
  select
    cardinality(v_ids),
    (select count(*)::integer
     from public.puntaje_merchandiser pm
     where pm.tipo = p_tipo
       and pm.periodo_inicio = p_inicio
       and pm.mercaderista_id = any(v_ids)
       and pm.cierre_bloqueado);
end;
$$;

-- ---------------------------------------------------------------------------
-- 4. El ranking del panel LEE la posición
--
-- Mismo contrato de salida que MAR-102 —misma firma, mismas columnas, mismo
-- orden— para que el panel no se entere. Lo único que desaparece son las dos
-- ventanas `rank()`: la del periodo actual y la del anterior. Sus filas fueron
-- posicionadas por el mismo dueño cuando se calcularon.
--
-- El `coalesce(a.hay_empate, false)` del SELECT final se queda: el `left join`
-- puede no encontrar fila, y eso sigue siendo NULL aunque la columna sea
-- `not null`.
-- ---------------------------------------------------------------------------
create or replace function public.ranking_merchandiser(
  p_tenant uuid,
  p_tipo   public.periodo_puntaje,
  p_inicio date
)
returns table (
  mercaderista_id  uuid,
  nombre           text,
  activo           boolean,
  posicion         integer,
  hay_empate       boolean,
  total_pct        numeric,
  puntualidad_pct  numeric,
  asistencia_pct   numeric,
  calidad_pct      numeric,
  herramientas_pct numeric,
  nivel_bono       text,
  nivel_bono_monto numeric,
  cerrado          boolean,
  cierre_bloqueado boolean,
  total_anterior   numeric,
  posicion_anterior integer,
  -- El periodo anterior se calculó con OTRA configuración: la evolución compara
  -- manzanas con peras y la fila lo dice en vez de callárselo.
  config_distinta  boolean,
  calculado_at     timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not app.es_staff() then
    raise exception 'solo el staff consulta el ranking' using errcode = '42501';
  end if;

  return query
  with actual as (
    select
      pm.mercaderista_id,
      pm.total_pct, pm.puntualidad_pct, pm.asistencia_pct,
      pm.calidad_pct, pm.herramientas_pct,
      pm.nivel_bono_id, pm.config_id, pm.cerrado_at, pm.cierre_bloqueado,
      pm.calculado_at,
      pm.posicion,
      pm.hay_empate
    from public.puntaje_merchandiser pm
    where pm.tenant_id = p_tenant
      and pm.tipo = p_tipo
      and pm.periodo_inicio = p_inicio
  ),
  anterior as (
    select
      pm.mercaderista_id,
      pm.total_pct,
      pm.config_id,
      pm.posicion
    from public.puntaje_merchandiser pm
    where pm.tenant_id = p_tenant
      and pm.tipo = p_tipo
      and pm.periodo_inicio = app.inicio_periodo_anterior(p_tipo, p_inicio)
  )
  select
    m.id,
    m.nombre,
    m.activo,
    a.posicion,
    coalesce(a.hay_empate, false),
    a.total_pct,
    a.puntualidad_pct,
    a.asistencia_pct,
    a.calidad_pct,
    a.herramientas_pct,
    n.nombre,
    n.monto,
    (a.cerrado_at is not null),
    coalesce(a.cierre_bloqueado, false),
    ant.total_pct,
    ant.posicion,
    (ant.mercaderista_id is not null
       and a.mercaderista_id is not null
       and a.config_id is distinct from ant.config_id),
    a.calculado_at
  from public.profile m
  left join actual a on a.mercaderista_id = m.id
  left join anterior ant on ant.mercaderista_id = m.id
  left join public.nivel_bono_merchandiser n on n.id = a.nivel_bono_id
  where m.tenant_id = p_tenant
    and m.rol = 'mercaderista'
    -- El desvinculado que trabajó y cobró en el periodo SIGUE apareciendo; el
    -- desvinculado sin puntaje, no.
    and (m.activo or a.mercaderista_id is not null)
    -- La visibilidad, DESPUÉS de la ventana: el mismo dueño que la política.
    and app.puede_ver_mercaderista(m.id)
  order by a.posicion nulls last, m.nombre;
end;
$$;

comment on function public.ranking_merchandiser(uuid, public.periodo_puntaje, date) is
  'El ranking del plan de lealtad de un cliente en un periodo: posición LEÍDA de `puntaje_merchandiser` (la calcula `app.posicionar_merchandiser` sobre el cliente entero), desglose por variable, nivel de bono guardado (no recalculado) y evolución contra el periodo anterior. Solo staff; el supervisor recibe únicamente a su equipo, con las posiciones del cliente entero. Un total NULL es «sin datos», queda sin posición y no desplaza a nadie. Filas planas y ordenadas: consumibles tal cual por el exportador de reportes.';

-- ---------------------------------------------------------------------------
-- 5. Backfill
--
-- Sin esto el panel enseñaría "Sin datos" en todo el histórico, y los periodos
-- ya CERRADOS no se arreglarían nunca: el motor sale por el guard de congelación
-- antes de tocarlos. `app.posicionar_merchandiser` ignora `cerrado_at` justo
-- para que este backfill los alcance.
-- ---------------------------------------------------------------------------
do $$
declare
  r record;
begin
  for r in
    select distinct tenant_id, tipo, periodo_inicio
    from public.puntaje_merchandiser
  loop
    perform app.posicionar_merchandiser(r.tenant_id, r.tipo, r.periodo_inicio);
  end loop;
end $$;
