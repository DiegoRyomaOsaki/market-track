-- El ranking de mercaderistas del panel, con su frontera de autorización.
--
-- El motor (MAR-100/120) ya deja el puntaje, el desglose, el nivel de bono y
-- hasta el índice del ranking. Lo que faltaba era leerlo con posición y
-- evolución — y cerrar un agujero: la política `puntaje_pm_staff_lee` dejaba a
-- CUALQUIER supervisor leer por PostgREST el puntaje y el bono de todos los
-- mercaderistas de todos los clientes. El criterio del ticket es explícito:
-- el supervisor solo ve a su equipo, autorizado en el servidor.

-- ---------------------------------------------------------------------------
-- 1. Un solo dueño de "¿a quién puede ver este staff?"
--
-- La usan la política de abajo y las dos RPC nuevas. Sin ella, el predicado
-- `supervisor_id = auth.uid()` se copiaría en tres sitios que luego divergen.
--
-- Sin `else` a propósito: un rol nuevo sin traducir devuelve NULL —denegado—
-- en vez de colarse por un `true` por defecto. Mismo patrón que las políticas
-- por rol de `foto`.
-- ---------------------------------------------------------------------------
create function app.puede_ver_mercaderista(p_mercaderista uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select case (select app.rol_actual())
    when 'admin' then true
    when 'supervisor' then exists (
      select 1 from public.profile p
      where p.id = p_mercaderista
        and p.supervisor_id = (select auth.uid())
    )
  end;
$$;

comment on function app.puede_ver_mercaderista(uuid) is
  'Si el staff que llama puede ver los datos laborales de un mercaderista: el admin a todos, el supervisor solo a su equipo (`profile.supervisor_id`). Cualquier otro rol —o uno nuevo sin traducir— devuelve NULL, que deniega. Único dueño de la regla: la usan la política de `puntaje_merchandiser` y las RPC del ranking.';

revoke execute on function app.puede_ver_mercaderista(uuid) from public;
grant execute on function app.puede_ver_mercaderista(uuid)
  to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 2. La política de lectura del staff se ESTRECHA al equipo
--
-- Es seguro estrechar en un solo paso: nada en las apps lee hoy esta tabla
-- (verificado por grep), y la bajada del móvil va por sync rules con
-- `BYPASSRLS`, a las que una política no afecta. La del mercaderista
-- (`puntaje_pm_mercaderista_lee_el_suyo`) no se toca: MAR-103 depende de ella.
--
-- `app.puede_ver_mercaderista(mercaderista_id)` va SIN envolver en
-- `(select ...)`: depende de la fila, y envolverla la convertiría en un SubPlan
-- correlacionado — la misma lección que dejó escrita la política de `alerta`.
-- ---------------------------------------------------------------------------
drop policy puntaje_pm_staff_lee on public.puntaje_merchandiser;

create policy puntaje_pm_staff_lee on public.puntaje_merchandiser
  for select to authenticated
  using (
    (select app.es_staff())
    and app.puede_ver_mercaderista(mercaderista_id)
  );

-- ---------------------------------------------------------------------------
-- 3. El inicio del periodo anterior — la gemela de `fin_periodo`
--
-- Segundo uso del mismo CASE por tipo de periodo; la regla del proyecto extrae
-- al tercero.
-- ---------------------------------------------------------------------------
create function app.inicio_periodo_anterior(
  p_tipo   public.periodo_puntaje,
  p_inicio date
)
returns date
language sql
immutable
set search_path = ''
as $$
  select (p_inicio - case p_tipo
            when 'mensual'    then interval '1 month'
            when 'trimestral' then interval '3 months'
            when 'anual'      then interval '1 year'
          end)::date;
$$;

comment on function app.inicio_periodo_anterior(public.periodo_puntaje, date) is
  'El primer día del periodo inmediatamente anterior al que empieza en `p_inicio`. La evolución del ranking compara contra él.';

revoke execute on function app.inicio_periodo_anterior(public.periodo_puntaje, date) from public;
grant execute on function app.inicio_periodo_anterior(public.periodo_puntaje, date)
  to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 4. El puntaje de UNA parada, extraído del motor
--
-- La rampa (100 dentro de la tolerancia → 0 desde `minutos_tardanza_cero`, recta
-- entre medias) vivía en un CASE dentro de `calcular_puntaje_merchandiser`. El
-- detalle del ranking tiene que decir "esta parada valió 62 puntos", y sin
-- extraerla o mentiría por omisión o duplicaría la fórmula — el día que
-- diverjan, el detalle contradice al total del que sale un bono.
--
-- Un solo dueño, dos consumidores: el motor (promedia) y el detalle (lista).
-- ---------------------------------------------------------------------------
create function app.puntaje_de_parada(
  p_config           public.config_perfect_merchandiser,
  p_hora_planificada time,
  p_asistencia       public.asistencia_parada,
  p_minutos_desvio   integer
)
returns numeric
language sql
immutable
set search_path = ''
as $$
  select case
    -- Sin hora planificada no se le pidió nada: ni puntúa ni penaliza.
    when p_hora_planificada is null then null
    when p_asistencia = 'pendiente' then null
    -- El que no llegó puntúa 0 aquí Y 0 en asistencia. Ese doble golpe es el
    -- "una cosa es que llegues tarde, pero otra que ni siquiera llegues".
    when p_asistencia = 'falto' then 0
    -- Llegar antes NO suma extra: la velocidad por sí sola nunca sube el
    -- puntaje (el incentivo perverso que el cliente quiso evitar).
    when p_minutos_desvio <= p_config.tolerancia_puntualidad_min then 100
    when p_minutos_desvio >= p_config.minutos_tardanza_cero then 0
    else round(
      100 * (1 - (p_minutos_desvio - p_config.tolerancia_puntualidad_min)::numeric
               / (p_config.minutos_tardanza_cero - p_config.tolerancia_puntualidad_min)),
      2)
  end;
$$;

comment on function app.puntaje_de_parada(
  public.config_perfect_merchandiser, time, public.asistencia_parada, integer) is
  'El puntaje de puntualidad de una parada bajo una configuración: 100 dentro de la tolerancia, 0 desde `minutos_tardanza_cero`, recta entre medias; 0 si faltó, NULL si no tenía hora o sigue pendiente. Único dueño de la rampa — la usan el motor (promedia) y el detalle del ranking (lista parada a parada).';

revoke execute on function app.puntaje_de_parada(
  public.config_perfect_merchandiser, time, public.asistencia_parada, integer) from public;
grant execute on function app.puntaje_de_parada(
  public.config_perfect_merchandiser, time, public.asistencia_parada, integer)
  to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 5. El motor pasa a usar la función extraída
--
-- Se recrea desde el cuerpo que dejó `20260819120100` (el que acredita fotos
-- por `verificada_at`), NO desde el de `20260814100000`: copiar el viejo
-- desharía el cambio de lectura sin que ninguna migración fallara. El ÚNICO
-- cambio es el `avg(case ...)` de puntualidad, que ahora llama a
-- `app.puntaje_de_parada`; todo lo demás es idéntico.
-- ---------------------------------------------------------------------------
create or replace function app.calcular_puntaje_merchandiser(
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

  -- Salud de la evidencia del periodo (el guardarraíl).
  v_fotos_periodo    integer;
  v_fotos_subidas    integer;
  v_fotos_verificadas integer;
  v_pct_sin_verificar numeric;
  v_sellaria          boolean;
  v_bloqueado         boolean := false;

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
    -- El puntaje de cada parada, promediado. La rampa vive en
    -- `app.puntaje_de_parada` — el mismo dueño que usa el detalle del ranking
    -- para explicar cada parada. Una parada sin hora planificada devuelve NULL
    -- y queda fuera del promedio: no se le pidió una hora, así que ni puntúa
    -- ni penaliza (lo dice la propia columna en MAR-89).
    avg(app.puntaje_de_parada(
      v_config, pp.hora_planificada, pp.asistencia, pp.minutos_desvio
    )) as puntualidad
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
      -- `verificada_at is not null` es el SELLO DEL SERVIDOR (MAR-118/120):
      -- acredita lo que el mercaderista no puede escribir. El `visita_id` va en
      -- el predicado aunque el `levantamiento_id` ya identifique la foto:
      -- `foto_visita_lev_tipo_idx` empieza por `visita_id` y sin acotarlo el
      -- plan es un Seq Scan de `foto` entera, tres veces por levantamiento.
      least((select count(*) from public.foto ft
             where ft.visita_id = v.id and ft.levantamiento_id = l.id
               and ft.tipo = 'antes' and ft.verificada_at is not null), 1)
      + least((select count(*) from public.foto ft
               where ft.visita_id = v.id and ft.levantamiento_id = l.id
                 and ft.tipo = 'despues' and ft.verificada_at is not null), 1)
      + least((select count(*) from public.foto ft
               where ft.visita_id = v.id and ft.levantamiento_id = l.id
                 and ft.tipo = 'campo_extra' and ft.verificada_at is not null),
              c.fotos_campo) as presentes
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
      -- cada uno sobre el mismo denominador. Acredita el sello del servidor,
      -- igual que la calidad de registro.
      least((select count(*) from public.foto ft
             where ft.visita_id = v.id
               and ft.levantamiento_id is null
               and ft.tipo = 'campo_extra'
               and ft.verificada_at is not null), c.items_foto) as fotos
  ) f
  where r.mercaderista_id = p_mercaderista
    and r.fecha between p_inicio and v_fin
    and r.estado <> 'borrador'
    and v.formulario_version_id is not null;

  v_herr := case when v_items = 0 then null
                 else round(100.0 * v_cumplidos / v_items, 2) end;

  -- -------------------------------------------------------------------------
  -- La salud de la evidencia del periodo.
  --
  -- Es una señal del PIPELINE, no una segunda aritmética de crédito: mira todas
  -- las fotos de las visitas del periodo, sin los filtros de crédito
  -- (`l.estado='completado'`, `v.formulario_version_id is not null`) y sin los
  -- `least`. Repetirlos aquí sería decir el mismo cálculo dos veces.
  --
  -- Denominador: solo las SUBIDAS. Una foto que sigue en la cola del teléfono no
  -- es evidencia de que R2 falle — es el offline-first funcionando, y meterla
  -- aquí bloquearía todo periodo con un mercaderista sin cobertura, que es justo
  -- el falso positivo que hay que evitar.
  --
  -- `verificadas` se cuenta también bajo `subida_at is not null` para que la
  -- resta no pueda salir negativa.
  -- -------------------------------------------------------------------------
  select
    count(*),
    count(*) filter (where ft.subida_at is not null),
    count(*) filter (where ft.subida_at is not null and ft.verificada_at is not null)
  into v_fotos_periodo, v_fotos_subidas, v_fotos_verificadas
  from public.foto ft
  join public.visita v on v.id = ft.visita_id
  join public.rutero_parada rp on rp.id = v.rutero_parada_id
  join public.rutero r on r.id = rp.rutero_id
  where r.mercaderista_id = p_mercaderista
    and r.fecha between p_inicio and v_fin
    and r.estado <> 'borrador';

  -- Sin una sola foto subida no hay nada que juzgar: ni división por cero, ni
  -- bloqueo al mercaderista que no tuvo fotos en el periodo, ni al cliente recién
  -- dado de alta, ni al teléfono que todavía no ha drenado nada.
  v_pct_sin_verificar := case
    when v_fotos_subidas = 0 then null
    else round(100.0 * (v_fotos_subidas - v_fotos_verificadas) / v_fotos_subidas, 2)
  end;

  -- Pasada la gracia, el periodo se sella en el mismo cálculo. Sin cron: como la
  -- config se resuelve por el inicio del periodo, calcular tarde da el mismo
  -- número que calcular a tiempo.
  v_sellaria := (v_fin + v_config.dias_gracia_cierre) < app.hoy_lima();

  -- El guardarraíl se evalúa SOLO cuando el cálculo iba a sellar. El día 1 del
  -- mes lo normal es que casi nada esté sellado todavía (el barrido va cada 5
  -- min, y la gracia son días): juzgarlo entonces levantaría una alerta espuria
  -- en cada recálculo, para todos, todos los meses. Y bloquear un cierre que no
  -- iba a ocurrir es un no-op ruidoso.
  --
  -- Estricto (`>`), no `>=`: un umbral de 0 significa "cualquier foto sin
  -- verificar bloquea", y con `>=` un 0% —todo sellado— también bloquearía.
  v_bloqueado := v_sellaria
    and v_pct_sin_verificar is not null
    and v_pct_sin_verificar > v_config.umbral_fotos_sin_verificar_pct;

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
    fotos_del_periodo, fotos_subidas, fotos_verificadas, cierre_bloqueado,
    calculado_at, cerrado_at
  ) values (
    p_mercaderista, p_tipo, p_inicio, v_tenant, v_config.id, v_nivel.id,
    v_punt, v_asis, null, v_calidad, v_herr, v_total,
    v_evaluables, v_asistidas, v_con_hora, v_puntuales,
    v_obligatorios, v_respondidos, v_fotos_esp, v_fotos_pres,
    v_items, v_cumplidos,
    v_fotos_periodo, v_fotos_subidas, v_fotos_verificadas, v_bloqueado,
    now(),
    -- El puntaje se escribe igual cuando el guardarraíl muerde: los números son
    -- provisionales hasta que alguien los selle, y esconderlos dejaría al panel
    -- sin nada que enseñar justo cuando hay un problema que mirar.
    case when v_sellaria and not v_bloqueado then now() else null end
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
    fotos_del_periodo = excluded.fotos_del_periodo,
    fotos_subidas = excluded.fotos_subidas,
    fotos_verificadas = excluded.fotos_verificadas,
    cierre_bloqueado = excluded.cierre_bloqueado,
    calculado_at = excluded.calculado_at,
    cerrado_at = excluded.cerrado_at;

  -- La alerta va DESPUÉS del upsert: si el puntaje no se pudo escribir, no hay
  -- nada de lo que avisar. Es idempotente por índice único (una por mercaderista
  -- y periodo), así que recalcular no la repite.
  if v_bloqueado then
    perform app.crear_alerta(
      v_tenant,
      'verificacion_fotos',
      null,
      null,
      'alta',
      jsonb_build_object(
        'mercaderista_id',  p_mercaderista,
        'periodo_tipo',     p_tipo,
        'periodo_inicio',   p_inicio,
        'fotos_subidas',    v_fotos_subidas,
        'fotos_verificadas', v_fotos_verificadas,
        'pct_sin_verificar', v_pct_sin_verificar,
        'umbral_pct',       v_config.umbral_fotos_sin_verificar_pct
      )
    );
    -- También a los logs: la alerta vive en una tabla que hoy no tiene pantalla
    -- de staff, y un bloqueo que nadie ve es indistinguible de un periodo que
    -- todavía no tocaba cerrar.
    -- Sin el signo de porcentaje a propósito: en un `raise`, `%` es un marcador de
    -- sustitución y escaparlo aquí solo haría el formato ilegible.
    raise warning 'plan de lealtad: no se cierra el periodo % de % — % por ciento de fotos subidas sin verificar (umbral: %)',
      p_inicio, p_mercaderista, v_pct_sin_verificar, v_config.umbral_fotos_sin_verificar_pct;
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- 6. El ranking
--
-- `security definer` y no invoker, a propósito: con la RLS ya acotada al
-- equipo, un `rank()` bajo invoker se calcularía SOLO sobre las filas visibles
-- y el supervisor vería "puesto 1" para quien es 7.º de la empresa — el mismo
-- mercaderista tendría dos posiciones según quién mire. La posición es del
-- cliente entero; la visibilidad se aplica DESPUÉS de la ventana, con el mismo
-- dueño que la política. El gate de staff es el mismo que el de
-- `recalcular_puntaje_merchandiser`.
-- ---------------------------------------------------------------------------
create function public.ranking_merchandiser(
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
      -- Rango de COMPETICIÓN (91/88/88/74 → 1, 2, 2, 4), no denso: de esto sale
      -- dinero y "somos los dos segundos, y el siguiente es el cuarto" es la
      -- lectura que la gente hace de un ranking con premio. Un total NULL queda
      -- FUERA de la ventana: no tiene posición y no desplaza a nadie.
      case when pm.total_pct is not null then
        (rank() over (order by pm.total_pct desc nulls last))::integer
      end as posicion,
      pm.total_pct is not null
        and count(*) over (partition by pm.total_pct) > 1 as hay_empate
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
      case when pm.total_pct is not null then
        (rank() over (order by pm.total_pct desc nulls last))::integer
      end as posicion
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
  'El ranking del plan de lealtad de un cliente en un periodo: posición por rango de competición sobre TODO el cliente, desglose por variable, nivel de bono guardado (no recalculado) y evolución contra el periodo anterior. Solo staff; el supervisor recibe únicamente a su equipo, con las posiciones del cliente entero. Un total NULL es «sin datos», queda sin posición y no desplaza a nadie. Filas planas y ordenadas: consumibles tal cual por el exportador de reportes (MAR-58).';

revoke execute on function public.ranking_merchandiser(uuid, public.periodo_puntaje, date) from public;
revoke execute on function public.ranking_merchandiser(uuid, public.periodo_puntaje, date) from anon;
grant execute on function public.ranking_merchandiser(uuid, public.periodo_puntaje, date)
  to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 7. Los hechos de puntualidad del detalle
--
-- Parada a parada, con los puntos que la rampa le dio — la MISMA rampa que
-- promedió el motor, por construcción. La config es la del PUNTAJE guardado
-- (`config_id`), no la vigente: un periodo calculado bajo una tolerancia vieja
-- se explica con esa tolerancia. Si el periodo aún no se calculó, se usa la
-- aplicable a su inicio (los puntos son entonces una previa, no un registro).
-- ---------------------------------------------------------------------------
create function public.paradas_del_periodo_merchandiser(
  p_mercaderista uuid,
  p_tipo         public.periodo_puntaje,
  p_inicio       date
)
returns table (
  parada_id        uuid,
  fecha            date,
  tienda_id        uuid,
  tienda_nombre    text,
  hora_planificada time,
  check_in_at      timestamptz,
  minutos_desvio   integer,
  asistencia       public.asistencia_parada,
  puntos           numeric
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_tenant    uuid;
  v_config_id uuid;
  v_config    public.config_perfect_merchandiser;
begin
  if not app.es_staff() or not coalesce(app.puede_ver_mercaderista(p_mercaderista), false) then
    raise exception 'sin permiso sobre ese mercaderista' using errcode = '42501';
  end if;

  select p.tenant_id into v_tenant from public.profile p where p.id = p_mercaderista;
  if v_tenant is null then
    return;
  end if;

  select pm.config_id into v_config_id
  from public.puntaje_merchandiser pm
  where pm.mercaderista_id = p_mercaderista
    and pm.tipo = p_tipo
    and pm.periodo_inicio = p_inicio;

  if v_config_id is not null then
    select c.* into v_config
    from public.config_perfect_merchandiser c
    where c.id = v_config_id;
  else
    v_config := app.config_perfect_merchandiser_aplicable(v_tenant, p_inicio);
  end if;

  return query
  select
    pp.parada_id,
    pp.fecha,
    pp.tienda_id,
    t.nombre,
    pp.hora_planificada,
    pp.check_in_at,
    pp.minutos_desvio,
    pp.asistencia,
    -- Sin configuración no hay rampa que aplicar: los hechos se listan igual y
    -- los puntos van NULL — ausencia visible, no un número inventado.
    case when v_config.id is null then null
         else app.puntaje_de_parada(
           v_config, pp.hora_planificada, pp.asistencia, pp.minutos_desvio)
    end
  from public.puntualidad_paradas(
    p_mercaderista, p_inicio, app.fin_periodo(p_tipo, p_inicio)) pp
  left join public.tienda t on t.id = pp.tienda_id
  order by pp.fecha, pp.hora_planificada nulls last, pp.parada_id;
end;
$$;

comment on function public.paradas_del_periodo_merchandiser(uuid, public.periodo_puntaje, date) is
  'Los hechos que explican la puntualidad y la asistencia de un mercaderista en un periodo: cada parada con su hora esperada, su llegada, el desvío y los puntos que la rampa le dio — la misma rampa que promedió el motor (`app.puntaje_de_parada`), con la configuración del puntaje guardado. Solo staff, y el supervisor solo sobre su equipo.';

revoke execute on function public.paradas_del_periodo_merchandiser(uuid, public.periodo_puntaje, date) from public;
revoke execute on function public.paradas_del_periodo_merchandiser(uuid, public.periodo_puntaje, date) from anon;
grant execute on function public.paradas_del_periodo_merchandiser(uuid, public.periodo_puntaje, date)
  to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 8. El recálculo se ACOTA a un cliente
--
-- El bucle recorría a TODOS los mercaderistas de TODOS los clientes: mientras
-- la RPC no tuvo llamante en el panel, daba igual. Ahora el ranking la dispara
-- con un botón, y el cálculo SELLA el periodo pasada la ventana de gracia
-- (`cerrado_at`, sin reapertura): sin acotar, el supervisor de un cliente
-- congelaría los bonos de otro con un clic. No es fuga de datos — es una
-- escritura irreversible fuera de su ámbito.
--
-- `p_tenant` va al FINAL y con default null, así que el comportamiento previo
-- (todos los clientes) sigue disponible para un operador con service_role y las
-- llamadas posicionales existentes no cambian de significado.
--
-- `drop` + `create` y no `create or replace`: añadir un parámetro crea una
-- SOBRECARGA en vez de reemplazar, y dos firmas vivas dejarían a PostgREST sin
-- saber cuál llamar. El drop se lleva los grants, que se reponen abajo.
-- ---------------------------------------------------------------------------
drop function public.recalcular_puntaje_merchandiser(public.periodo_puntaje, date, uuid);

create function public.recalcular_puntaje_merchandiser(
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

comment on function public.recalcular_puntaje_merchandiser(public.periodo_puntaje, date, uuid, uuid) is
  'Recalcula el puntaje del plan de lealtad de un periodo, acotado a un cliente y/o a un mercaderista (sin acotar: todos). Solo staff. Devuelve cuántos procesó y cuántos quedaron sin cerrar por el guardarraíl de verificación de fotos; los periodos ya cerrados no se tocan. El panel SIEMPRE pasa `p_tenant`: el cálculo sella periodos vencidos, y sellar los de otro cliente es irreversible.';

revoke execute on function public.recalcular_puntaje_merchandiser(public.periodo_puntaje, date, uuid, uuid) from public;
revoke execute on function public.recalcular_puntaje_merchandiser(public.periodo_puntaje, date, uuid, uuid) from anon;
grant execute on function public.recalcular_puntaje_merchandiser(public.periodo_puntaje, date, uuid, uuid)
  to authenticated, service_role;
