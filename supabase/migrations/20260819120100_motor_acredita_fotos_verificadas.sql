-- El motor del plan de lealtad acredita fotos por `verificada_at` (sello del
-- servidor contra R2), no por `hash` (lo escribe el móvil).
--
-- Tercer y último paso de la decisión de MAR-118, que ya dejó la columna, el
-- trigger que impide que la app la escriba y el barrido que sella el histórico.
-- Los despliegues no son atómicos y por eso fueron tres: columna → confirmación
-- operando → backfill → cambio de lectura. Este archivo es el cambio de lectura.
--
-- Y con él, un guardarraíl que el cambio hace obligatorio: si el sello depende de
-- que R2 responda, una caída de R2 o una rotación de credenciales pondría la
-- calidad de registro y las herramientas de TODOS a cero, en silencio y con
-- forma de mal desempeño. De estos números sale un bono que se paga. Así que
-- cuando la evidencia del periodo no está sellada por encima de un umbral
-- configurable, el periodo NO se cierra y se levanta una alerta al staff.

-- ---------------------------------------------------------------------------
-- 1. El umbral: política de negocio, versionada por cliente
--
-- Va en la configuración —y no en el vault con `functions_url` y los secretos—
-- porque no es configuración de ENTORNO: es una decisión del plan de lealtad, y
-- el puntaje ya guarda con qué `config_id` se calculó (ADR-0011). Así queda
-- registrado con qué umbral se decidió no cerrar un periodo.
--
-- Aditiva y con default, igual que `periodicidad`: las filas ya publicadas —que
-- son inmutables— siguen siendo válidas, y el alta que no envía la columna sigue
-- funcionando durante el rollout. Un `alter table` no dispara `config_pm_inmutable`,
-- que es `for each row on update`.
-- ---------------------------------------------------------------------------
alter table public.config_perfect_merchandiser
  add column umbral_fotos_sin_verificar_pct numeric(5, 2) not null default 20
    check (umbral_fotos_sin_verificar_pct between 0 and 100);

comment on column public.config_perfect_merchandiser.umbral_fotos_sin_verificar_pct is
  'Porcentaje de fotos SUBIDAS y sin sellar por encima del cual el periodo no se cierra. Un porcentaje y no un conteo: el sellado es asíncrono por diseño y su cola es proporcional al volumen de cada mercaderista. Se resuelve por el INICIO del periodo, así que subirlo no desatasca un periodo ya empezado.';

-- ---------------------------------------------------------------------------
-- 2. El desglose que EXPLICA el bloqueo
--
-- Mismo patrón que los cinco pares que ya explican el puntaje: sin ellos, un
-- periodo sin cerrar se lee igual que uno que nadie ha calculado.
--
-- `fotos_del_periodo` distingue "no había fotos" de "no se subió ninguna" — la
-- diferencia entre el mercaderista que no trabajó y aquel cuyo teléfono no ha
-- drenado la cola. `cierre_bloqueado` es el VEREDICTO, y se guarda por lo mismo
-- que se guarda `config_id`: es el registro de una decisión tomada con la
-- configuración de ese momento, no un derivado que se pueda recalcular después.
-- ---------------------------------------------------------------------------
alter table public.puntaje_merchandiser
  add column fotos_del_periodo integer not null default 0,
  add column fotos_subidas     integer not null default 0,
  add column fotos_verificadas integer not null default 0,
  add column cierre_bloqueado  boolean not null default false;

comment on column public.puntaje_merchandiser.fotos_del_periodo is
  'Todas las filas `foto` de las visitas del periodo, subidas o no. Con `fotos_subidas` da por resta las que siguen en la cola del teléfono.';
comment on column public.puntaje_merchandiser.fotos_subidas is
  'Las que el móvil marcó como subidas a R2 (`subida_at`). Denominador del guardarraíl: una foto todavía en cola no es evidencia de que R2 falle, es el offline-first funcionando.';
comment on column public.puntaje_merchandiser.fotos_verificadas is
  'Las subidas que además tienen el sello del servidor (`verificada_at`). La resta con `fotos_subidas` es lo que el guardarraíl compara con el umbral.';
comment on column public.puntaje_merchandiser.cierre_bloqueado is
  'El cálculo iba a sellar el periodo y no lo hizo: demasiada evidencia subida y sin verificar. Se acompaña de una alerta `verificacion_fotos`. No se desatasca solo: hace falta que el barrido selle lo que falta, o un cierre manual por un operador con service_role.';

-- ---------------------------------------------------------------------------
-- 3. Qué tipos de alerta son del CLIENTE-MARCA
--
-- El plan de lealtad es la relación laboral entre la outsourcing y su personal,
-- no algo que la marca compre — lo dice ya la política de
-- `config_perfect_merchandiser`. Una alerta que nombra a un mercaderista y el
-- estado de su bono no puede llegar a su portal.
--
-- WHITELIST y no lista negra: así el tipo de alerta que alguien añada mañana
-- nace siendo de staff y hay que decidir a conciencia que el cliente lo vea. Al
-- revés, un olvido lo publicaría.
--
-- Un solo dueño de la regla, con tres consumidores: las dos políticas de `alerta`
-- y el emisor del feed en vivo. Sin él, la regla se copiaría en tres sitios que
-- luego divergen.
-- ---------------------------------------------------------------------------
create function app.tipo_alerta_del_cliente(p_tipo public.tipo_alerta)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select p_tipo = any (array[
    'quiebre', 'diferencia_stock', 'desviacion_precio',
    'promo_no_activa', 'exhibicion_incompleta', 'contingencia'
  ]::public.tipo_alerta[]);
$$;

comment on function app.tipo_alerta_del_cliente(public.tipo_alerta) is
  'Si un tipo de alerta pertenece a la operación de tienda que el cliente-marca compró. Whitelist: lo que no esté aquí es de staff. Único dueño de la regla — la usan las dos políticas de `alerta` y el emisor del feed en vivo.';

revoke execute on function app.tipo_alerta_del_cliente(public.tipo_alerta) from public;
grant execute on function app.tipo_alerta_del_cliente(public.tipo_alerta)
  to authenticated, service_role;

-- Las DOS políticas del tenant, no solo la de lectura: dejar la de UPDATE con el
-- predicado viejo permitiría al cliente marcar como vista una alerta que no puede
-- leer.
--
-- ⚠️ `app.tipo_alerta_del_cliente(tipo)` va SIN envolver en `(select ...)`, al
-- contrario que `app.tenant_actual()`. La regla del proyecto —envolver siempre—
-- aplica a las funciones que NO dependen de la fila: envueltas se evalúan una vez
-- por consulta en vez de una por fila. Esta depende de `tipo`, que es por fila:
-- envolverla la convertiría en una subconsulta correlacionada, que es peor. Al
-- ser `immutable` y de una sola expresión, Postgres la inlinea en el predicado.
alter policy alerta_usuario_lee_su_tenant on public.alerta
  using (
    tenant_id = (select app.tenant_actual())
    and app.tipo_alerta_del_cliente(tipo)
  );

alter policy alerta_usuario_marca_estado on public.alerta
  using (
    (tenant_id = (select app.tenant_actual()) and app.tipo_alerta_del_cliente(tipo))
    or (select app.es_staff())
  )
  with check (
    (tenant_id = (select app.tenant_actual()) and app.tipo_alerta_del_cliente(tipo))
    or (select app.es_staff())
  );

-- ---------------------------------------------------------------------------
-- 4. El feed en vivo NO emite las alertas de staff al canal del cliente
--
-- La RLS no cubre esto: `app.difundir_cambio_en_vivo()` es SECURITY DEFINER y
-- emite la fila entera a `tenant:<id>:alerta`, al que el portal del cliente está
-- suscrito. Sin esta guarda, estrechar las políticas de arriba no serviría de
-- nada — la alerta llegaría igual, en vivo y con su payload.
--
-- La guarda vive en el emisor genérico, y no en un trigger propio para `alerta`,
-- porque un trigger propio duplicaría las 40 líneas del emisor y los dos sitios
-- donde el fallo se degrada a WARNING. El precio es que el emisor genérico
-- conozca este caso; queda escrito aquí para que se entienda por qué.
-- ---------------------------------------------------------------------------
create or replace function app.difundir_cambio_en_vivo()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- El feed en vivo NUNCA puede tumbar la escritura que lo origina.
  --
  -- Este trigger corre dentro de la transacción del check-in o de la alerta, y el
  -- mercaderista sube su visita después de horas sin señal: ese dato es el
  -- producto; el tile del supervisor, no.
  --
  -- `realtime.send` ya degrada a WARNING el fallo de su propio INSERT (partición
  -- del día que aún no existe, por ejemplo), así que ese caso está cubierto aguas
  -- abajo. Lo que este bloque ataja es el resto: `realtime.broadcast_changes`
  -- envuelve todo lo demás en un `raise exception`, y esa sí subiría hasta aquí y
  -- abortaría la escritura. Es también el seguro ante un cambio de versión de
  -- Realtime, que la propia ficha del ticket advierte que ocurre a menudo.
  --
  -- Se degrada con ruido, no en silencio: el WARNING queda en los logs de Postgres.
  begin
    -- Cada cambio sale dos veces: al canal del cliente dueño de la fila y al canal
    -- del staff. Son audiencias distintas con permisos distintos, no una copia.
    --
    -- Salvo las alertas que no son del cliente-marca: esas salen SOLO al canal del
    -- staff. Misma regla que la política de lectura, mismo dueño.
    if tg_table_name <> 'alerta' or app.tipo_alerta_del_cliente(new.tipo) then
      perform realtime.broadcast_changes(
        app.topico_tenant(new.tenant_id, tg_table_name),
        tg_op, tg_op, tg_table_name, tg_table_schema, new, old
      );
    end if;
    perform realtime.broadcast_changes(
      app.topico_staff(tg_table_name),
      tg_op, tg_op, tg_table_name, tg_table_schema, new, old
    );
  exception
    when others then
      raise warning 'feed en vivo: no se emitió % sobre %.% — %',
        tg_op, tg_table_schema, tg_table_name, sqlerrm;
  end;
  return null;
end;
$$;

comment on function app.difundir_cambio_en_vivo() is
  'Emite el cambio de fila a los canales privados del tenant y del staff. AFTER trigger: no altera la fila, y un fallo al emitir no aborta la escritura de origen. Las alertas que no son del cliente-marca (`app.tipo_alerta_del_cliente`) salen solo al canal del staff.';

-- ---------------------------------------------------------------------------
-- 5. Una sola alerta por mercaderista y periodo
--
-- El recálculo se ejecuta muchas veces sobre el mismo periodo; el guardarraíl no
-- puede insertar una alerta en cada corrida. Un `if not exists (...)` dentro del
-- calculador NO basta: dos recálculos concurrentes lo pasan los dos e insertan
-- los dos. La única garantía es la base.
--
-- El aviso es uno para siempre: no se re-emite mientras el bloqueo dure, y el
-- motor nunca lo auto-resuelve (ningún tipo de alerta se auto-resuelve en este
-- sistema; el estado lo mueve el staff). Las cifras VIVAS están en
-- `puntaje_merchandiser`; las del payload son las de la primera detección.
-- ---------------------------------------------------------------------------
create unique index alerta_verificacion_fotos_uq
  on public.alerta ((payload->>'mercaderista_id'),
                    (payload->>'periodo_tipo'),
                    (payload->>'periodo_inicio'))
  where tipo = 'verificacion_fotos';

-- El `on conflict do nothing` va en el helper compartido —un solo dueño del
-- insert en `alerta`— y es estrictamente no-op para los otros tres triggers que
-- lo usan: sin índice único que violar, no hay conflicto que ignorar. Parte del
-- contrato del helper: el día que otra restricción única llegue a `alerta`, sus
-- violaciones se ignorarán aquí en silencio.
create or replace function app.crear_alerta(
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
  values (p_tenant, p_tipo, p_marca, p_visita, p_severidad, p_payload)
  on conflict do nothing;
$$;

comment on function app.crear_alerta(uuid, public.tipo_alerta, uuid, uuid, public.severidad_alerta, jsonb) is
  'Único insert en `alerta`. `on conflict do nothing`: solo muerde donde hay un índice único (hoy, la alerta de verificación de fotos, que es una por mercaderista y periodo).';

-- ---------------------------------------------------------------------------
-- 6. El motor
--
-- Cambia la lectura de las fotos (cuatro predicados) y se añade el guardarraíl.
-- Todo lo demás es idéntico: es un `create or replace` porque las migraciones son
-- append-only y la de MAR-100 no se edita.
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
      -- `verificada_at is not null` es el SELLO DEL SERVIDOR: la Edge Function
      -- `fotos-verificar` comprobó con un HEAD que existe un objeto en R2 bajo la
      -- key de esa foto (MAR-118). Es lo que convierte el crédito en algo que el
      -- mercaderista no puede escribir.
      --
      -- Antes se acreditaba por `hash is not null`, y era falsificable: `hash` y
      -- `subida_at` los escribe el móvil, y el mercaderista tiene política de
      -- INSERT sobre `foto` para sus propias visitas — una fila con un hash
      -- inventado, sin un solo byte subido, puntuaba igual. Los `least` de abajo
      -- acotaban CUÁNTAS filas se acreditaban, no si cada una era real.
      --
      -- Lo que el sello NO prueba es el contenido de la imagen: la URL PUT
      -- firmada admite un JPEG negro. Eso lo acotan el watermark en captura
      -- (ADR-0006) y estos mismos `least`.
      --
      -- Se cuentan FILAS `foto`, nunca el uuid guardado en el `valor` de una
      -- respuesta: esa referencia no tiene verja de autenticidad. Y los `least`
      -- impiden inflar el numerador insertando fotos de más.
      --
      -- El `visita_id` va en el predicado aunque el `levantamiento_id` ya
      -- identifique la foto: `foto_visita_lev_tipo_idx` empieza por `visita_id`
      -- y sin acotarlo el índice no puede buscar. Medido con EXPLAIN: sin él el
      -- plan es un Seq Scan de `foto` ENTERA —todos los clientes— y esto corre
      -- tres veces por levantamiento, dentro del bucle de la RPC. El sello no
      -- cambia el plan: se filtra tras la búsqueda por índice, exactamente donde
      -- se filtraba el hash.
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
      -- cada uno sobre el mismo denominador. Ni penalización extra ni descuento.
      -- Acredita el sello del servidor, igual que la calidad de registro.
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

-- Sustituye al puntero que dejó `20260817120000_autenticidad_de_foto.sql`, que
-- anunciaba este cambio como pendiente.
comment on function app.calcular_puntaje_merchandiser(uuid, public.periodo_puntaje, date) is
  'Calcula (o recalcula) el puntaje del plan de lealtad de un mercaderista en un periodo. Un periodo ya cerrado no se toca. Pasada la ventana de gracia, el cálculo lo sella — SALVO que el porcentaje de fotos subidas y sin sellar por el servidor supere `config.umbral_fotos_sin_verificar_pct`: entonces deja `cerrado_at` en null, marca `cierre_bloqueado` y levanta una alerta `verificacion_fotos`. Acredita fotos por `foto.verificada_at` (sello del servidor contra R2), nunca por `hash`, que lo escribe el móvil. Un bloqueo NO se desatasca solo ni subiendo el umbral (la config se resuelve por el inicio del periodo): o el barrido sella lo que falta, o un operador con service_role sella el periodo a mano.';

-- ---------------------------------------------------------------------------
-- 7. La RPC del panel informa cuántos periodos dejó sin cerrar
--
-- `drop` + `create` y no `create or replace`: Postgres no deja cambiar el tipo de
-- retorno de una función existente. El drop se lleva los grants por delante, así
-- que se reponen abajo.
--
-- Sin danza aditiva (función nueva + retirada de la vieja en otro PR) porque no
-- hay a quién proteger: esta RPC no tiene ni un llamante en `apps/web` — solo los
-- tipos generados y el test de BD. Lo único que puede notar el cambio es la caché
-- de esquema de PostgREST, que puede servir la forma vieja unos segundos tras la
-- migración; sin llamantes, es inocuo.
-- ---------------------------------------------------------------------------
drop function public.recalcular_puntaje_merchandiser(public.periodo_puntaje, date, uuid);

create function public.recalcular_puntaje_merchandiser(
  p_tipo         public.periodo_puntaje,
  p_inicio       date,
  p_mercaderista uuid default null
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

comment on function public.recalcular_puntaje_merchandiser(public.periodo_puntaje, date, uuid) is
  'Recalcula el puntaje del plan de lealtad de un periodo, para un mercaderista o para todos. Solo staff. Devuelve cuántos procesó y cuántos quedaron sin cerrar por el guardarraíl de verificación de fotos; los periodos ya cerrados no se tocan.';

revoke execute on function public.recalcular_puntaje_merchandiser(public.periodo_puntaje, date, uuid) from public;
revoke execute on function public.recalcular_puntaje_merchandiser(public.periodo_puntaje, date, uuid) from anon;
grant execute on function public.recalcular_puntaje_merchandiser(public.periodo_puntaje, date, uuid)
  to authenticated, service_role;
