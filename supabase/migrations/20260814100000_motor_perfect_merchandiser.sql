-- El plan de lealtad del mercaderista: puntaje por persona y periodo.
--
-- Puntúa SOLO lo que el mercaderista controla. Perfect Store no sirve para
-- evaluarlo — "si el tipo es el encargado de las tiendas de provincia que son
-- más chiquitas, nunca le va a poder competir al que trabaja en la tienda más
-- grande. No por ahí va la cosa" (reunión del 3 ago 2026).
--
-- El cálculo vive en la base y cada puntaje guarda con qué configuración se
-- calculó (ADR-0011). Un periodo cerrado NO se recalcula: de estos números
-- salen bonos que ya se pagaron.
--
-- Migración puramente ADITIVA: no toca ninguna tabla, función ni política
-- existente, así que el código viejo sigue funcionando durante el rollout.

-- ---------------------------------------------------------------------------
-- 1. El periodo
-- ---------------------------------------------------------------------------
create type public.periodo_puntaje as enum ('mensual', 'trimestral', 'anual');

-- El último día del periodo. `p_inicio` es `date` y la aritmética se hace sobre
-- `timestamp` sin zona: `date_trunc` sobre `timestamptz` es STABLE —depende del
-- TimeZone de la sesión— y no serviría dentro de un CHECK.
create function app.fin_periodo(p_tipo public.periodo_puntaje, p_inicio date)
returns date
language sql
immutable
set search_path = ''
as $$
  select (p_inicio + case p_tipo
            when 'mensual'    then interval '1 month'
            when 'trimestral' then interval '3 months'
            when 'anual'      then interval '1 year'
          end)::date - 1;
$$;

comment on function app.fin_periodo(public.periodo_puntaje, date) is
  'El último día (inclusive) del periodo que empieza en `p_inicio`.';

revoke execute on function app.fin_periodo(public.periodo_puntaje, date) from public;
grant execute on function app.fin_periodo(public.periodo_puntaje, date)
  to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 2. La configuración: pesos y políticas, VERSIONADA e INMUTABLE
--
-- Por CLIENTE y sin los ejes de Perfect Store (marca, categoría, tipo de
-- tienda): el mercaderista es exclusivo de un cliente y audita todas sus
-- marcas. Ponderarlo por tipo de tienda volvería a medirlo por el tamaño de su
-- tienda, que es exactamente lo que el cliente rechazó.
-- ---------------------------------------------------------------------------
create table public.config_perfect_merchandiser (
  id        uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenant (id) on delete restrict,

  peso_puntualidad     numeric(5, 2) not null check (peso_puntualidad     between 0 and 100),
  peso_asistencia      numeric(5, 2) not null check (peso_asistencia      between 0 and 100),
  peso_tiempo_efectivo numeric(5, 2) not null default 0
                                     check (peso_tiempo_efectivo between 0 and 100),
  peso_calidad         numeric(5, 2) not null check (peso_calidad         between 0 and 100),
  peso_herramientas    numeric(5, 2) not null check (peso_herramientas    between 0 and 100),

  -- La POLÍTICA de puntualidad vive AQUÍ, no en `tenant.tolerancia_puntualidad_min`:
  -- ese valor se edita en cualquier momento y movería el puntaje de un periodo
  -- todavía abierto. Este queda congelado por `vigente_desde` y por el
  -- `config_id` que el puntaje guarda. El HECHO —los minutos de desvío— sigue
  -- siendo de `puntualidad_paradas`, que ya avisaba de este reparto.
  tolerancia_puntualidad_min integer not null check (tolerancia_puntualidad_min >= 0),
  -- A partir de cuántos minutos de tardanza la parada puntúa 0. Entre la
  -- tolerancia y este valor el puntaje baja en línea recta.
  minutos_tardanza_cero      integer not null default 60 check (minutos_tardanza_cero > 0),
  -- Cuánto se espera tras el fin del periodo antes de congelarlo. El móvil es
  -- offline-first: un teléfono sin señal una semana sincroniza sus visitas
  -- después de que el mes terminó, y cerrar antes le cobraría al mercaderista la
  -- falta de cobertura de su zona.
  dias_gracia_cierre         integer not null default 7 check (dias_gracia_cierre >= 0),

  vigente_desde date not null default app.hoy_lima(),
  creado_at     timestamptz not null default now(),
  creado_por    uuid references public.profile (id) on delete set null,

  -- El contrato del que depende la ponderación: sin él, un puntaje sobre 100
  -- dejaría de significar lo mismo entre dos clientes.
  constraint config_pm_pesos_suman_100 check (
    peso_puntualidad + peso_asistencia + peso_tiempo_efectivo
    + peso_calidad + peso_herramientas = 100
  ),
  -- El tiempo efectivo de atención NO tiene fórmula acordada: "no sé cómo
  -- medirlo realmente y también tengo miedo porque puede ser un incentivo
  -- perverso de que haga todo mal y rápido". Nace apagado, y su peso FIJADO a 0
  -- en vez de libre: con un peso libre la renormalización lo repartiría entre
  -- las otras cuatro EN SILENCIO, y los pesos efectivos no serían los que el
  -- admin ve en pantalla. Encenderla es una migración, no un cambio de config.
  constraint config_pm_tiempo_efectivo_apagado check (peso_tiempo_efectivo = 0),
  -- Sin esto, una rampa invertida haría que una tardanza dentro de la tolerancia
  -- cayera fuera de la recta y la división saliera negativa o por cero.
  constraint config_pm_rampa_valida check (minutos_tardanza_cero > tolerancia_puntualidad_min),
  constraint config_pm_natural_uq unique (tenant_id, vigente_desde)
);

create index config_pm_resolucion_idx
  on public.config_perfect_merchandiser (tenant_id, vigente_desde desc);

comment on table public.config_perfect_merchandiser is
  'Pesos y políticas del plan de lealtad del mercaderista, por cliente. Filas INMUTABLES: cambiar la configuración es insertar otra con una `vigente_desde` nueva (ADR-0011).';
comment on column public.config_perfect_merchandiser.peso_tiempo_efectivo is
  'Fijado a 0 por CHECK: la variable existe pero no tiene fórmula acordada (decisión abierta). Encenderla exige una migración que quite el CHECK y escriba el cálculo.';
comment on column public.config_perfect_merchandiser.dias_gracia_cierre is
  'Días tras el fin del periodo antes de congelar el puntaje. Cubre al teléfono que sincroniza tarde: cerrar antes le cobraría al mercaderista la falta de cobertura.';

create function app.config_perfect_merchandiser_inmutable()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  raise exception 'una configuración de Perfect Merchandiser no se edita: inserta otra con una `vigente_desde` nueva'
    using errcode = 'check_violation';
end;
$$;

revoke execute on function app.config_perfect_merchandiser_inmutable() from public;

create trigger config_pm_inmutable
  before update on public.config_perfect_merchandiser
  for each row execute function app.config_perfect_merchandiser_inmutable();

-- La configuración vigente en una fecha. El motor la resuelve por la fecha de
-- INICIO del periodo: las reglas del juego se anuncian antes de jugar, y
-- resolver por la fecha de fin permitiría cambiar los pesos después de ver los
-- resultados. Es lo mismo que `fijar_hora_parada` ya impide con la hora
-- planificada.
create function app.config_perfect_merchandiser_aplicable(
  p_tenant_id uuid,
  p_fecha     date
)
returns public.config_perfect_merchandiser
language sql
stable
security invoker
set search_path = ''
as $$
  select c.*
  from public.config_perfect_merchandiser c
  where c.tenant_id = p_tenant_id
    and c.vigente_desde <= p_fecha
  -- `id` como último criterio: la clave natural ya impide un empate, pero sin un
  -- orden total el resultado dependería del plan de ejecución.
  order by c.vigente_desde desc, c.id
  limit 1;
$$;

comment on function app.config_perfect_merchandiser_aplicable(uuid, date) is
  'La configuración del plan de lealtad vigente para un cliente en una fecha. El motor la resuelve por el INICIO del periodo: cambiar los pesos a mitad de camino no mueve las reglas de un periodo ya empezado.';

-- ---------------------------------------------------------------------------
-- 3. Los niveles de bono: una ESCALERA de umbrales
--
-- "Todos los que llegan a este nivel reciben tanto de bono". Umbral y no rango
-- (min + max): un rango admite huecos —nadie cobra entre 70 y 75— y solapes
-- —dos niveles compitiendo—, los dos como errores de configuración silenciosos.
--
-- La escalera VIGENTE en una fecha es el conjunto de filas con el mayor
-- `vigente_desde` que no la supere: publicar una escalera nueva REEMPLAZA la
-- anterior entera. Quien la publique debe hacerlo en UNA transacción; media
-- escalera publicada es una escalera vigente.
-- ---------------------------------------------------------------------------
create table public.nivel_bono_merchandiser (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references public.tenant (id) on delete restrict,
  vigente_desde date not null default app.hoy_lima(),
  nombre        text not null check (length(btrim(nombre)) between 1 and 60),
  puntaje_min   numeric(5, 2) not null check (puntaje_min between 0 and 100),
  monto         numeric(12, 2) not null check (monto >= 0),
  creado_at     timestamptz not null default now(),
  creado_por    uuid references public.profile (id) on delete set null,

  constraint nivel_bono_natural_uq unique (tenant_id, vigente_desde, puntaje_min)
);

create index nivel_bono_resolucion_idx
  on public.nivel_bono_merchandiser (tenant_id, vigente_desde desc, puntaje_min desc);

comment on table public.nivel_bono_merchandiser is
  'La escalera de bonos por puntaje, por cliente. Cada fila es un UMBRAL ("desde este puntaje, este monto"). La escalera vigente es el conjunto con el mayor `vigente_desde`: publicar una nueva reemplaza la anterior entera, y debe hacerse en una sola transacción.';

create function app.nivel_bono_merchandiser_inmutable()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  raise exception 'un nivel de bono no se edita: publica una escalera nueva con una `vigente_desde` nueva'
    using errcode = 'check_violation';
end;
$$;

revoke execute on function app.nivel_bono_merchandiser_inmutable() from public;

create trigger nivel_bono_inmutable
  before update on public.nivel_bono_merchandiser
  for each row execute function app.nivel_bono_merchandiser_inmutable();

-- El nivel alcanzado: el umbral más alto que el puntaje supera, dentro de la
-- escalera vigente en la fecha.
create function app.nivel_bono_aplicable(
  p_tenant_id uuid,
  p_puntaje   numeric,
  p_fecha     date
)
returns public.nivel_bono_merchandiser
language sql
stable
security invoker
set search_path = ''
as $$
  select n.*
  from public.nivel_bono_merchandiser n
  where n.tenant_id = p_tenant_id
    and p_puntaje is not null
    and n.puntaje_min <= p_puntaje
    and n.vigente_desde = (
      select max(v.vigente_desde)
      from public.nivel_bono_merchandiser v
      where v.tenant_id = p_tenant_id and v.vigente_desde <= p_fecha
    )
  order by n.puntaje_min desc, n.id
  limit 1;
$$;

comment on function app.nivel_bono_aplicable(uuid, numeric, date) is
  'El nivel de bono que alcanza un puntaje: el umbral más alto que supera, dentro de la escalera vigente en la fecha. Sin puntaje o por debajo del umbral más bajo devuelve nada.';

-- ---------------------------------------------------------------------------
-- 4. El ponderador
--
-- Renormaliza sobre lo EVALUADO: una variable NULL no puntúa cero, su peso se
-- reparte entre las demás. Un cero silencioso convertiría un periodo a medio
-- medir en un mal desempeño — y de estos números salen bonos.
--
-- Copia deliberada de `app.ponderar_perfect_store`: mismo algoritmo, tipo de
-- configuración distinto. Es el SEGUNDO uso, y la regla del proyecto extrae al
-- tercero; un genérico ahora costaría un array de pesos sin nombres y perdería
-- la comprobación de tipos.
-- ---------------------------------------------------------------------------
create function app.ponderar_merchandiser(
  p_config          public.config_perfect_merchandiser,
  p_puntualidad     numeric,
  p_asistencia      numeric,
  p_tiempo_efectivo numeric,
  p_calidad         numeric,
  p_herramientas    numeric
)
returns numeric
language sql
immutable
as $$
  select case
    -- Sin peso evaluado no hay ponderado. Pasa si no se evaluó ninguna variable,
    -- y también si las evaluadas pesan cero: dividir ahí daría un error.
    when coalesce(peso_evaluado, 0) = 0 then null
    else round(suma / peso_evaluado, 2)
  end
  from (
    select
      sum(peso) filter (where valor is not null) as peso_evaluado,
      sum(peso * valor) filter (where valor is not null) as suma
    from (values
      (p_config.peso_puntualidad,     p_puntualidad),
      (p_config.peso_asistencia,      p_asistencia),
      (p_config.peso_tiempo_efectivo, p_tiempo_efectivo),
      (p_config.peso_calidad,         p_calidad),
      (p_config.peso_herramientas,    p_herramientas)
    ) as v(peso, valor)
  ) t;
$$;

comment on function app.ponderar_merchandiser(public.config_perfect_merchandiser, numeric, numeric, numeric, numeric, numeric) is
  'El ponderado del plan de lealtad sobre las variables EVALUADAS. Una variable NULL renormaliza su peso entre las demás, nunca puntúa cero.';

revoke execute on function app.ponderar_merchandiser(
  public.config_perfect_merchandiser, numeric, numeric, numeric, numeric, numeric) from public;
grant execute on function app.ponderar_merchandiser(
  public.config_perfect_merchandiser, numeric, numeric, numeric, numeric, numeric)
  to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 5. El puntaje
-- ---------------------------------------------------------------------------
create table public.puntaje_merchandiser (
  mercaderista_id uuid not null references public.profile (id) on delete cascade,
  tipo            public.periodo_puntaje not null,
  periodo_inicio  date not null,
  tenant_id       uuid not null references public.tenant (id) on delete restrict,
  -- Con QUÉ configuración se calculó. El invariante de ADR-0011: sin esta
  -- referencia, reajustar los pesos reescribiría la historia.
  config_id       uuid not null
    references public.config_perfect_merchandiser (id) on delete restrict,
  nivel_bono_id   uuid
    references public.nivel_bono_merchandiser (id) on delete restrict,

  -- NULL = no evaluada, que NO es cero: su peso se renormaliza.
  puntualidad_pct     numeric(5, 2) check (puntualidad_pct     between 0 and 100),
  asistencia_pct      numeric(5, 2) check (asistencia_pct      between 0 and 100),
  tiempo_efectivo_pct numeric(5, 2) check (tiempo_efectivo_pct between 0 and 100),
  calidad_pct         numeric(5, 2) check (calidad_pct         between 0 and 100),
  herramientas_pct    numeric(5, 2) check (herramientas_pct    between 0 and 100),
  total_pct           numeric(5, 2) check (total_pct           between 0 and 100),

  -- El desglose que EXPLICA el puntaje. Sin él, un 100 sobre dos paradas se lee
  -- igual que un 100 sobre cuarenta, y no valen lo mismo.
  paradas_evaluables  integer not null default 0,
  paradas_asistidas   integer not null default 0,
  paradas_con_hora    integer not null default 0,
  paradas_puntuales   integer not null default 0,
  campos_obligatorios integer not null default 0,
  campos_respondidos  integer not null default 0,
  fotos_esperadas     integer not null default 0,
  fotos_presentes     integer not null default 0,
  items_checklist     integer not null default 0,
  items_cumplidos     integer not null default 0,

  calculado_at timestamptz not null default now(),
  -- Sellado = congelado. Recalcular no lo toca: de aquí salió un bono.
  cerrado_at   timestamptz,

  primary key (mercaderista_id, tipo, periodo_inicio),

  -- El inicio tiene que estar ALINEADO con su tipo: un "mensual" que empiece el
  -- día 7 mediría una ventana que no es un mes. Inline y no llamando a una
  -- función: un CHECK que depende de una función complica el orden del restore.
  constraint pm_periodo_alineado check (
    periodo_inicio = case tipo
      when 'mensual'    then date_trunc('month',   periodo_inicio::timestamp)::date
      when 'trimestral' then date_trunc('quarter', periodo_inicio::timestamp)::date
      when 'anual'      then date_trunc('year',    periodo_inicio::timestamp)::date
    end
  )
);

create index puntaje_pm_tenant_idx on public.puntaje_merchandiser (tenant_id);
create index puntaje_pm_config_idx on public.puntaje_merchandiser (config_id);
-- El ranking del panel: un periodo, todos los mercaderistas, ordenados.
create index puntaje_pm_ranking_idx
  on public.puntaje_merchandiser (tenant_id, tipo, periodo_inicio, total_pct desc);

comment on table public.puntaje_merchandiser is
  'Puntaje del plan de lealtad por mercaderista y periodo, con la configuración que lo produjo. NULL en una variable significa "no evaluada", nunca cero: su peso se renormaliza. `cerrado_at` sellado = congelado.';
comment on column public.puntaje_merchandiser.tiempo_efectivo_pct is
  'Siempre NULL: la variable no tiene fórmula acordada y su peso está fijado a 0 en la configuración.';

-- ---------------------------------------------------------------------------
-- 6. Los campos que una definición EXIGE
--
-- Un solo dueño para las dos variables que la leen (calidad de registro y
-- herramientas): la definición es jsonb y expandirla a mano en cada sitio es
-- copiar la forma del documento en dos lugares que luego divergen.
--
-- Se llama una vez por levantamiento o visita, no una por fila de respuesta. A
-- la escala del piloto (unas decenas de visitas por mercaderista y periodo) eso
-- son unas pocas expansiones de un jsonb pequeño.
-- ---------------------------------------------------------------------------
create function app.campos_obligatorios(p_version_id uuid)
returns table (campo_id text, tipo text)
language sql
stable
set search_path = ''
as $$
  select campo->>'id', campo->>'tipo'
  from public.formulario_version fv
  cross join lateral jsonb_array_elements(
    coalesce(fv.definicion->'pasos', '[]'::jsonb)) as paso
  cross join lateral jsonb_array_elements(
    coalesce(paso->'campos', '[]'::jsonb)) as campo
  where fv.id = p_version_id
    -- Una definición sin `pasos`, o con una forma inesperada, no produce filas:
    -- 0 campos obligatorios, que no penaliza a nadie.
    and coalesce((campo->>'obligatorio')::boolean, false);
$$;

comment on function app.campos_obligatorios(uuid) is
  'Los campos marcados como obligatorios en una versión de formulario, con su tipo. Único dueño de la forma de la `definicion` jsonb para el motor de puntaje.';

revoke execute on function app.campos_obligatorios(uuid) from public;
grant execute on function app.campos_obligatorios(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 7. El calculador
--
-- `security definer` porque escribe una tabla que `authenticated` no puede
-- escribir: el puntaje lo produce el servidor, igual que las alertas y que
-- Perfect Store. Si la app pudiera escribirlo, el número dejaría de ser el
-- mismo para todos — y de él sale un bono.
-- ---------------------------------------------------------------------------
create function app.calcular_puntaje_merchandiser(
  p_mercaderista uuid,
  p_tipo         public.periodo_puntaje,
  p_inicio       date
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_fin     date := app.fin_periodo(p_tipo, p_inicio);
  v_tenant  uuid;
  v_config  public.config_perfect_merchandiser;
  v_nivel   public.nivel_bono_merchandiser;
  v_cerrado boolean;

  -- Cobertura de puntualidad y asistencia.
  v_evaluables integer;
  v_asistidas  integer;
  v_con_hora   integer;
  v_puntuales  integer;

  -- Cobertura de calidad de registro y de herramientas.
  v_obligatorios integer;
  v_respondidos  integer;
  v_fotos_esp    integer;
  v_fotos_pres   integer;
  v_items        integer;
  v_cumplidos    integer;

  -- Las cuatro variables vivas y el ponderado.
  v_punt    numeric;
  v_asis    numeric;
  v_calidad numeric;
  v_herr    numeric;
  v_total   numeric;
begin
  -- Guard de congelación, ANTES de calcular nada: un periodo cerrado no se
  -- vuelve a tocar aunque cambien los pesos o lleguen visitas tardías.
  select (pm.cerrado_at is not null) into v_cerrado
  from public.puntaje_merchandiser pm
  where pm.mercaderista_id = p_mercaderista
    and pm.tipo = p_tipo
    and pm.periodo_inicio = p_inicio;

  if coalesce(v_cerrado, false) then
    return;
  end if;

  select p.tenant_id into v_tenant
  from public.profile p
  where p.id = p_mercaderista;

  if v_tenant is null then
    return;  -- Un usuario sin cliente (staff) no tiene plan de lealtad.
  end if;

  -- La config se resuelve por el INICIO del periodo (ver el comentario de
  -- `config_perfect_merchandiser_aplicable`). Sin configuración no se inventa un
  -- default: se borra la fila abierta y se sale, y el panel dirá "sin configurar".
  v_config := app.config_perfect_merchandiser_aplicable(v_tenant, p_inicio);

  if v_config.id is null then
    delete from public.puntaje_merchandiser
    where mercaderista_id = p_mercaderista
      and tipo = p_tipo
      and periodo_inicio = p_inicio;
    return;
  end if;

  -- -------------------------------------------------------------------------
  -- Variables 1 y 2 — puntualidad y asistencia.
  --
  -- Los HECHOS salen de `puntualidad_paradas` (MAR-89) y no se recalculan aquí.
  -- De ella se usa `minutos_desvio`, NUNCA `dentro_tolerancia`: ese veredicto lo
  -- resuelve con `tenant.tolerancia_puntualidad_min`, que es editable y movería
  -- un periodo abierto. La política la pone la config de arriba.
  -- -------------------------------------------------------------------------
  select
    count(*) filter (where pp.asistencia <> 'pendiente')                    as evaluables,
    count(*) filter (where pp.asistencia = 'asistio')                       as asistidas,
    count(*) filter (where pp.asistencia <> 'pendiente'
                       and pp.hora_planificada is not null)                 as con_hora,
    count(*) filter (where pp.asistencia = 'asistio'
                       and pp.hora_planificada is not null
                       and pp.minutos_desvio <= v_config.tolerancia_puntualidad_min)
                                                                            as puntuales,
    -- El puntaje de puntualidad de cada parada, promediado. Una parada sin hora
    -- planificada queda fuera del denominador: no se le pidió una hora, así que
    -- ni puntúa ni penaliza (lo dice la propia columna en MAR-89).
    avg(
      case
        when pp.hora_planificada is null then null
        when pp.asistencia = 'pendiente' then null
        -- El que no llegó puntúa 0 aquí Y 0 en asistencia. Ese doble golpe es el
        -- "una cosa es que llegues tarde, pero otra que ni siquiera llegues".
        when pp.asistencia = 'falto' then 0
        -- Llegar antes NO suma extra: la velocidad por sí sola nunca sube el
        -- puntaje (el incentivo perverso que el cliente quiso evitar).
        when pp.minutos_desvio <= v_config.tolerancia_puntualidad_min then 100
        when pp.minutos_desvio >= v_config.minutos_tardanza_cero then 0
        else round(
          100 * (1 - (pp.minutos_desvio - v_config.tolerancia_puntualidad_min)::numeric
                   / (v_config.minutos_tardanza_cero - v_config.tolerancia_puntualidad_min)),
          2)
      end
    ) as puntualidad
  into v_evaluables, v_asistidas, v_con_hora, v_puntuales, v_punt
  from public.puntualidad_paradas(p_mercaderista, p_inicio, v_fin) pp;

  v_punt := round(v_punt, 2);
  v_asis := case when v_evaluables = 0 then null
                 else round(100.0 * v_asistidas / v_evaluables, 2) end;

  -- -------------------------------------------------------------------------
  -- Variables 4 y 5 — calidad de registro y herramientas.
  --
  -- El reparto de las definiciones ancladas es estricto para no contar dos veces
  -- lo mismo: los formularios de ámbito `levantamiento` puntúan CALIDAD, los de
  -- ámbito `check_in` puntúan HERRAMIENTAS.
  --
  -- En ningún punto se lee un uuid dentro de `*_respuesta.valor`: esas
  -- referencias no tienen verja de autenticidad y apuntarlas a otra foto es
  -- trivial. Se cuentan FILAS `foto`, y acotadas por lo esperado para que
  -- insertar fotos de más no infle el numerador.
  -- -------------------------------------------------------------------------
  -- Calidad de registro: los levantamientos COMPLETADOS de las visitas del
  -- periodo. Un `omitido` (pasado por contingencia) queda fuera entero — no se
  -- hizo, y penalizarlo sería castigar dos veces el bypass que el propio
  -- producto ofrece.
  select
    coalesce(sum(c.obligatorios), 0),
    coalesce(sum(c.respondidos), 0),
    coalesce(sum(f.esperadas), 0),
    coalesce(sum(f.presentes), 0)
  into v_obligatorios, v_respondidos, v_fotos_esp, v_fotos_pres
  from public.levantamiento l
  join public.visita v on v.id = l.visita_id
  join public.rutero_parada rp on rp.id = v.rutero_parada_id
  join public.rutero r on r.id = rp.rutero_id
  cross join lateral (
    select
      -- Los campos obligatorios de la definición ANCLADA (la que se le mostró),
      -- no de la última publicada.
      count(*) filter (where co.tipo is distinct from 'foto') as obligatorios,
      count(*) filter (where co.tipo = 'foto')                as fotos_campo,
      -- Un booleano `false` SÍ cuenta como respondido: es una respuesta.
      count(*) filter (
        where co.tipo is distinct from 'foto'
          and exists (
            select 1 from public.levantamiento_respuesta lr
            where lr.levantamiento_id = l.id and lr.campo_id = co.campo_id)
      ) as respondidos
    from app.campos_obligatorios(l.formulario_version_id) co
  ) c
  cross join lateral (
    select
      -- Las dos fotos fijas del wizard menos las que se pasaron por
      -- contingencia: una contingencia BAJA la expectativa, no penaliza.
      greatest(2 - (
        select count(*) from public.contingencia ct
        where ct.levantamiento_id = l.id
          and ct.paso in ('foto_antes', 'foto_despues')
      ), 0) + c.fotos_campo as esperadas,
      -- `hash is not null` es el criterio de "no corrupta" que hay hoy: se
      -- calcula al capturar (ADR-0006), así que su ausencia significa que el
      -- pipeline de captura falló. `subida_at` NO puntúa a propósito — la
      -- subida es de la red y del servidor, no del mercaderista.
      --
      -- Se cuentan FILAS `foto`, nunca el uuid guardado en el `valor` de una
      -- respuesta: esa referencia no tiene verja de autenticidad. Y los `least`
      -- impiden inflar el numerador insertando fotos de más.
      least((select count(*) from public.foto ft
             where ft.levantamiento_id = l.id and ft.tipo = 'antes'
               and ft.hash is not null), 1)
      + least((select count(*) from public.foto ft
               where ft.levantamiento_id = l.id and ft.tipo = 'despues'
                 and ft.hash is not null), 1)
      + least((select count(*) from public.foto ft
               where ft.levantamiento_id = l.id and ft.tipo = 'campo_extra'
                 and ft.hash is not null), c.fotos_campo) as presentes
  ) f
  where r.mercaderista_id = p_mercaderista
    and r.fecha between p_inicio and v_fin
    and r.estado <> 'borrador'
    and l.estado = 'completado';

  v_calidad := case
    when v_obligatorios + v_fotos_esp = 0 then null
    else round(100.0 * (v_respondidos + v_fotos_pres)
               / (v_obligatorios + v_fotos_esp), 2)
  end;

  -- Herramientas de trabajo: el checklist del check-in. Una visita sin
  -- `formulario_version_id` queda fuera del denominador (no se le pidió
  -- checklist); ninguna con checklist deja la variable en NULL y su peso se
  -- renormaliza.
  select
    coalesce(sum(c.items), 0),
    coalesce(sum(c.cumplidos_no_foto + f.fotos), 0)
  into v_items, v_cumplidos
  from public.visita v
  join public.rutero_parada rp on rp.id = v.rutero_parada_id
  join public.rutero r on r.id = rp.rutero_id
  cross join lateral (
    select
      count(*)                                 as items,
      count(*) filter (where co.tipo = 'foto') as items_foto,
      -- Un booleano `false` NO cuenta como cumplido: declaró no llevarla. Es la
      -- diferencia con la calidad de registro, donde `false` sí es una respuesta
      -- válida — allí se mide que CONTESTÓ, aquí que LLEVA.
      count(*) filter (
        where co.tipo is distinct from 'foto'
          and exists (
            select 1 from public.visita_respuesta vr
            where vr.visita_id = v.id
              and vr.campo_id = co.campo_id
              and (co.tipo is distinct from 'booleano' or vr.valor = 'true'::jsonb))
      ) as cumplidos_no_foto
    from app.campos_obligatorios(v.formulario_version_id) co
  ) c
  cross join lateral (
    select
      -- "No tomar la foto pesa igual que no llevarlas" (decisión del cliente):
      -- la foto ausente y el booleano `false` valen exactamente 1 punto perdido
      -- cada uno sobre el mismo denominador. Ni penalización extra ni descuento.
      least((select count(*) from public.foto ft
             where ft.visita_id = v.id
               and ft.levantamiento_id is null
               and ft.tipo = 'campo_extra'
               and ft.hash is not null), c.items_foto) as fotos
  ) f
  where r.mercaderista_id = p_mercaderista
    and r.fecha between p_inicio and v_fin
    and r.estado <> 'borrador'
    and v.formulario_version_id is not null;

  v_herr := case when v_items = 0 then null
                 else round(100.0 * v_cumplidos / v_items, 2) end;

  -- El tiempo efectivo de atención va SIEMPRE en NULL: no hay fórmula acordada
  -- y su peso está fijado a 0, así que la renormalización ni lo mira.
  v_total := app.ponderar_merchandiser(v_config, v_punt, v_asis, null, v_calidad, v_herr);
  v_nivel := app.nivel_bono_aplicable(v_tenant, v_total, p_inicio);

  insert into public.puntaje_merchandiser (
    mercaderista_id, tipo, periodo_inicio, tenant_id, config_id, nivel_bono_id,
    puntualidad_pct, asistencia_pct, tiempo_efectivo_pct, calidad_pct,
    herramientas_pct, total_pct,
    paradas_evaluables, paradas_asistidas, paradas_con_hora, paradas_puntuales,
    campos_obligatorios, campos_respondidos, fotos_esperadas, fotos_presentes,
    items_checklist, items_cumplidos,
    calculado_at, cerrado_at
  ) values (
    p_mercaderista, p_tipo, p_inicio, v_tenant, v_config.id, v_nivel.id,
    v_punt, v_asis, null, v_calidad, v_herr, v_total,
    v_evaluables, v_asistidas, v_con_hora, v_puntuales,
    v_obligatorios, v_respondidos, v_fotos_esp, v_fotos_pres,
    v_items, v_cumplidos,
    now(),
    -- Pasada la gracia, el periodo se sella en el mismo cálculo. Sin cron: como
    -- la config se resuelve por el inicio del periodo, calcular tarde da el
    -- mismo número que calcular a tiempo.
    case when v_fin + v_config.dias_gracia_cierre < app.hoy_lima()
         then now() else null end
  )
  on conflict (mercaderista_id, tipo, periodo_inicio) do update set
    tenant_id = excluded.tenant_id,
    config_id = excluded.config_id,
    nivel_bono_id = excluded.nivel_bono_id,
    puntualidad_pct = excluded.puntualidad_pct,
    asistencia_pct = excluded.asistencia_pct,
    tiempo_efectivo_pct = excluded.tiempo_efectivo_pct,
    calidad_pct = excluded.calidad_pct,
    herramientas_pct = excluded.herramientas_pct,
    total_pct = excluded.total_pct,
    paradas_evaluables = excluded.paradas_evaluables,
    paradas_asistidas = excluded.paradas_asistidas,
    paradas_con_hora = excluded.paradas_con_hora,
    paradas_puntuales = excluded.paradas_puntuales,
    campos_obligatorios = excluded.campos_obligatorios,
    campos_respondidos = excluded.campos_respondidos,
    fotos_esperadas = excluded.fotos_esperadas,
    fotos_presentes = excluded.fotos_presentes,
    items_checklist = excluded.items_checklist,
    items_cumplidos = excluded.items_cumplidos,
    calculado_at = excluded.calculado_at,
    cerrado_at = excluded.cerrado_at;
end;
$$;

comment on function app.calcular_puntaje_merchandiser(uuid, public.periodo_puntaje, date) is
  'Calcula (o recalcula) el puntaje del plan de lealtad de un mercaderista en un periodo. Un periodo ya cerrado no se toca. Pasada la ventana de gracia, el cálculo lo sella.';

revoke execute on function app.calcular_puntaje_merchandiser(uuid, public.periodo_puntaje, date) from public;

-- ---------------------------------------------------------------------------
-- 8. La RPC del panel
--
-- Sin `p_mercaderista` recalcula el cliente entero. El guard es de STAFF: el
-- mercaderista no dispara el cálculo de su propio bono.
-- ---------------------------------------------------------------------------
create function public.recalcular_puntaje_merchandiser(
  p_tipo         public.periodo_puntaje,
  p_inicio       date,
  p_mercaderista uuid default null
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_n integer := 0;
  v_id uuid;
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
  loop
    perform app.calcular_puntaje_merchandiser(v_id, p_tipo, p_inicio);
    v_n := v_n + 1;
  end loop;

  return v_n;
end;
$$;

comment on function public.recalcular_puntaje_merchandiser(public.periodo_puntaje, date, uuid) is
  'Recalcula el puntaje del plan de lealtad de un periodo, para un mercaderista o para todos. Solo staff. Devuelve cuántos se procesaron; los periodos ya cerrados no se tocan.';

revoke execute on function public.recalcular_puntaje_merchandiser(public.periodo_puntaje, date, uuid) from public;
grant execute on function public.recalcular_puntaje_merchandiser(public.periodo_puntaje, date, uuid)
  to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 9. GRANTs y RLS
--
-- El GRANT es la puerta y la RLS el portero. Sin `delete` en config ni en
-- niveles: borrarlos dejaría huérfanos los puntajes que los referencian, y el
-- histórico es justo lo que protegen.
--
-- El puntaje NO lo escribe nadie desde la app: lo produce el servidor.
-- ---------------------------------------------------------------------------
grant select, insert on public.config_perfect_merchandiser to authenticated;
grant all    on public.config_perfect_merchandiser to service_role;
grant select, insert on public.nivel_bono_merchandiser to authenticated;
grant all    on public.nivel_bono_merchandiser to service_role;
grant select on public.puntaje_merchandiser to authenticated;
grant all    on public.puntaje_merchandiser to service_role;

grant execute on function app.config_perfect_merchandiser_aplicable(uuid, date)
  to authenticated, service_role;
grant execute on function app.nivel_bono_aplicable(uuid, numeric, date)
  to authenticated, service_role;

alter table public.config_perfect_merchandiser enable row level security;
alter table public.nivel_bono_merchandiser     enable row level security;
alter table public.puntaje_merchandiser        enable row level security;

-- La configuración y la escalera: el staff las lee y solo el admin las escribe.
-- El cliente-marca NO las ve: el plan de lealtad es la relación laboral entre la
-- outsourcing y su personal, no algo que la marca compre.
create policy config_pm_staff_lee on public.config_perfect_merchandiser for select to authenticated
  using ((select app.es_staff()));
create policy config_pm_admin_escribe on public.config_perfect_merchandiser for all to authenticated
  using ((select app.rol_actual()) = 'admin')
  with check ((select app.rol_actual()) = 'admin');

create policy nivel_bono_staff_lee on public.nivel_bono_merchandiser for select to authenticated
  using ((select app.es_staff()));
create policy nivel_bono_admin_escribe on public.nivel_bono_merchandiser for all to authenticated
  using ((select app.rol_actual()) = 'admin')
  with check ((select app.rol_actual()) = 'admin');

-- El puntaje: el staff lo ve entero (es quien paga el bono) y el mercaderista
-- SOLO el suyo. Nunca el de un compañero: es un plan de lealtad individual, y
-- comparar sueldos entre pares no es lo que se compró.
--
-- Ojo: esta política gobierna PostgREST, no la bajada al móvil. Lo que el
-- teléfono descargue lo deciden las sync rules, y eso es de otro ticket.
create policy puntaje_pm_staff_lee on public.puntaje_merchandiser for select to authenticated
  using ((select app.es_staff()));
create policy puntaje_pm_mercaderista_lee_el_suyo on public.puntaje_merchandiser for select to authenticated
  using (mercaderista_id = (select auth.uid()));
