-- La incidencia de VISITA: el hallazgo que el mercaderista tiene que atender
-- antes de salir, venga del módulo que venga.
--
-- Acuerdo de la 4ª revisión con el cliente (25 ago 2026). Sabino:
-- "independientemente del módulo donde surja la incidencia —góndola,
-- exhibición, lo que sea—, esta debe acumularse en una lista global". Y Martin
-- cerró el punto que decide el diseño: la incidencia se genera SIN que el
-- mercaderista la declare — "simplemente levantó precios y hay una diferencia y
-- se genera una incidencia".
--
-- Por eso `authenticated` NO tiene INSERT sobre esta tabla: que las apps no la
-- creen no lo impone un procedimiento, lo impone la ausencia del grant. La
-- escribe el mismo dueño que ya calcula los derivados del levantamiento; un
-- segundo calculador en TypeScript divergiría del que ve el cliente.
--
-- No es `contingencia` (el bypass de un paso que NO se pudo completar por causa
-- externa) ni `alerta` (del servidor al supervisor). Es del mercaderista, nace
-- del dato que él mismo levantó, y vive en su teléfono.

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------
create type public.origen_incidencia as enum (
  -- Los cuatro primeros comparten nombre con `tipo_alerta` a propósito: es el
  -- MISMO hallazgo visto por dos consumidores (el supervisor lo recibe como
  -- alerta, el mercaderista como incidencia). Dos vocabularios para un hecho
  -- obligarían a mantener una tabla de traducción en el panel.
  --
  -- Con una excepción: aquí es `promo_no_comunicada` y en `tipo_alerta` es
  -- `promo_no_activa`. Se elige el nombre que ya usan `evaluacion_precio` y el
  -- propio cliente ("promoción no comunicada") — la alerta es la que tiene el
  -- nombre viejo, y renombrar su enum es un cambio que no toca a este ticket.
  'quiebre',
  'diferencia_stock',
  'desviacion_precio',
  'promo_no_comunicada',
  -- El motor de alertas solo mira `instalada and not completa`: la exhibición
  -- negociada que NO se instaló no tenía dueño hasta ahora.
  'exhibicion_no_instalada',
  -- Sin disparador todavía: la entidad `planograma` no existe. Está en el enum
  -- para que su ticket añada solo su rama de trigger y no una migración de enum
  -- aislada (Postgres prohíbe usar un valor nuevo en la misma transacción que lo
  -- añade). Hoy NADA crea una incidencia de este origen, y un test lo fija.
  'incumplimiento_planograma'
);

comment on type public.origen_incidencia is
  'De qué hallazgo nace la incidencia. `incumplimiento_planograma` todavía no tiene disparador: la entidad planograma no existe.';

create type public.estado_incidencia as enum (
  'pendiente',
  'resuelta',
  'no_resuelta',
  -- La escribe SOLO el motor, cuando el hallazgo deja de existir porque el
  -- mercaderista corrigió el dato que lo originó. Sin ella, un stock mal
  -- tecleado y luego corregido deja una incidencia que nadie puede atender —y
  -- la verja de check-out se cerraría para siempre sobre un hallazgo fantasma.
  'anulada'
);

-- ---------------------------------------------------------------------------
-- La tabla
-- ---------------------------------------------------------------------------
create table public.incidencia (
  id                      uuid primary key default gen_random_uuid(),
  tenant_id               uuid not null references public.tenant (id) on delete restrict,
  visita_id               uuid not null,
  -- Null cuando la incidencia no es de una marca. Hoy ningún origen lo es; lo
  -- será el planograma de tienda si se modela a nivel de local.
  levantamiento_id        uuid,
  marca_id                uuid,
  -- El HALLAZGO concreto, tipado y con FK, no un uuid suelto dentro del jsonb:
  -- el móvil pinta "Oster · Licuadora X" con un join local, sin parsear payloads.
  sku_id                  uuid,
  exhibicion_negociada_id uuid,
  origen                  public.origen_incidencia not null,
  estado                  public.estado_incidencia not null default 'pendiente',
  -- Los números del hallazgo, escritos por el único dueño. El teléfono los
  -- pinta; no los recalcula. Re-derivar el árbol de precio en TypeScript sería
  -- el segundo calculador que `app.evaluar_precio_sku` vino a evitar.
  detalle                 jsonb not null default '{}',
  accion_tomada           text,
  motivo                  text,
  foto_resolucion_id      uuid,
  -- Hora LOCAL de la captura, como `contingencia.registrada_at`: la incidencia
  -- se atiende offline y sincroniza después.
  atendida_at             timestamptz,
  creado_at               timestamptz not null default now(),

  -- UN HALLAZGO = UNA INCIDENCIA. El móvil escribe `levantamiento_sku` en tres
  -- pasadas (frentes, luego stock, luego precio) y el mercaderista puede
  -- reentrar al paso y volver a guardar: el motor se dispara otra vez y cae en
  -- este conflicto en lugar de duplicar.
  --
  -- `nulls not distinct` porque tres columnas de la clave son nullables y en la
  -- semántica normal un NULL nunca choca consigo mismo — la incidencia de
  -- quiebre (con `exhibicion_negociada_id` nulo) se duplicaría en cada pasada.
  constraint incidencia_hallazgo_uq unique nulls not distinct
    (tenant_id, visita_id, levantamiento_id, sku_id, exhibicion_negociada_id, origen),

  constraint incidencia_visita_fk foreign key (visita_id, tenant_id)
    references public.visita (id, tenant_id) on delete cascade,
  constraint incidencia_lev_fk foreign key (levantamiento_id, tenant_id)
    references public.levantamiento (id, tenant_id) on delete cascade,
  constraint incidencia_marca_fk foreign key (marca_id, tenant_id)
    references public.marca (id, tenant_id) on delete restrict,
  constraint incidencia_sku_fk foreign key (sku_id, tenant_id)
    references public.sku (id, tenant_id) on delete restrict,
  constraint incidencia_exh_neg_fk foreign key (exhibicion_negociada_id, tenant_id)
    references public.exhibicion_negociada (id, tenant_id) on delete cascade,
  constraint incidencia_foto_fk foreign key (foto_resolucion_id, tenant_id)
    references public.foto (id, tenant_id) on delete set null,

  -- Resolver EXIGE decir qué se hizo, y no resolver exige decir por qué: es la
  -- mitad del valor de la lista. Mismo criterio que `revision_motivo_si_rechaza`.
  constraint incidencia_accion_si_resuelta check (
    estado <> 'resuelta' or length(btrim(coalesce(accion_tomada, ''))) > 0),
  constraint incidencia_motivo_si_no_resuelta check (
    estado <> 'no_resuelta' or length(btrim(coalesce(motivo, ''))) > 0),
  constraint incidencia_atendida_at_si_cerrada check (
    estado in ('pendiente', 'anulada') or atendida_at is not null),
  -- Estos textos bajan a un teléfono por la réplica: se acotan como el motivo de
  -- la revisión de visita.
  constraint incidencia_accion_tamano check (
    accion_tomada is null or length(accion_tomada) <= 500),
  constraint incidencia_motivo_tamano check (
    motivo is null or length(motivo) <= 500)
);

comment on table public.incidencia is
  'El hallazgo que el mercaderista tiene que atender antes de salir de la tienda. La genera el motor a partir del dato levantado, nunca el código de las apps: `authenticated` no tiene INSERT.';

comment on column public.incidencia.detalle is
  'Los números del hallazgo (stock, precio registrado, precio regular), para que el móvil los pinte sin recalcular la regla.';

-- La lista del móvil y la verja de check-out preguntan por VISITA. `visita_id`
-- es la SEGUNDA columna de la clave natural, y un predicado que omite la columna
-- LÍDER no puede buscar por el índice: degradaría a Seq Scan cruzando todos los
-- clientes. El staff además lee sin predicado de tenant.
create index incidencia_visita_idx on public.incidencia (visita_id);

-- Sin índice por `tenant_id` a secas: `incidencia_hallazgo_uq` ya lo lleva de
-- líder. Es el mismo motivo por el que la bandeja de alertas retiró el suyo.

-- ---------------------------------------------------------------------------
-- GRANT y RLS
--
-- El GRANT es la puerta; la RLS es el portero — y el grant tiene que cubrir cada
-- verbo que la política permite, ni uno más.
-- ---------------------------------------------------------------------------

-- Sin INSERT: la incidencia la crea el motor. Sin DELETE: un hallazgo no se
-- borra, se anula. El UPDATE va por COLUMNAS, como en `alerta`: el mercaderista
-- atiende, no reescribe la evidencia (`origen`, `detalle`, `sku_id` son del
-- servidor). Aquí no aplica la objeción de que un grant por columna rompa el
-- upsert de reintento de PowerSync: el móvil nunca inserta esta tabla, así que
-- su operación de sync siempre es un PATCH.
grant select on public.incidencia to authenticated;
grant update (estado, accion_tomada, motivo, foto_resolucion_id, atendida_at)
  on public.incidencia to authenticated;
grant all on public.incidencia to service_role;

alter table public.incidencia enable row level security;

create policy incidencia_staff_lee on public.incidencia for select to authenticated
  using ((select app.es_staff()));

-- Mismo CASE por rol que el trabajo de campo acotado al dueño, y sin rama ELSE a
-- propósito: un rol nuevo cae en NULL, y NULL en una política es denegar.
--
-- Las ramas de supervisor y admin se conservan por simetría con las otras siete
-- tablas, pero no son las que dejan pasar al staff: admin y supervisor tienen
-- `tenant_id` nulo, así que el `tenant_id = app.tenant_actual()` de arriba corta
-- antes. Quien les da acceso es `incidencia_staff_lee`.
--
-- SIN rama 'cliente' a propósito. La vista del portal es de otro ticket, y la
-- decide su política: excluir el rol en la consulta que agrupa solo lo
-- escondería de esa pantalla, dejándolo legible por PostgREST.
create policy incidencia_usuario_lee_su_tenant on public.incidencia for select to authenticated
  using (
    tenant_id = (select app.tenant_actual())
    and case (select app.rol_actual())
      when 'mercaderista' then visita_id in (
        select v.id from public.visita v
        where v.mercaderista_id = (select auth.uid())
      )
      when 'supervisor' then true
      when 'admin' then true
    end
  );

comment on policy incidencia_usuario_lee_su_tenant on public.incidencia is
  'El mercaderista lee SOLO las incidencias de sus propias visitas. Al staff lo deja pasar `incidencia_staff_lee`, no esta política: admin y supervisor no tienen tenant_id, así que su rama del CASE nunca se cumple. El cliente-marca no lee ninguna hasta que la vista del portal traiga su propia rama.';

-- El dueño de la visita ATIENDE la incidencia. El `with check` niega `anulada`:
-- es el único estado que vacía la lista sin atenderla, y la verja de check-out
-- quedaría rodeable con un PATCH a PostgREST. Un grant por columna solo puede
-- acotar QUÉ columna se escribe; el VALOR lo acota el with check.
--
-- El `with check` tolera que la fila siga en `pendiente` a propósito: el móvil
-- puede mandar un PATCH parcial (solo `accion_tomada`), y rechazarlo con un
-- 42501 haría que el conector lo clasificase como permanente y DESCARTASE la
-- operación — perdiendo el trabajo del mercaderista en silencio.
create policy incidencia_mercaderista_atiende on public.incidencia for update to authenticated
  using (
    exists (
      select 1 from public.visita v
      where v.id = visita_id and v.mercaderista_id = (select auth.uid())
    )
  )
  with check (
    exists (
      select 1 from public.visita v
      where v.id = visita_id and v.mercaderista_id = (select auth.uid())
    )
    and estado <> 'anulada'
  );

comment on policy incidencia_mercaderista_atiende on public.incidencia is
  'El dueño de la visita resuelve o descarta sus incidencias. No puede escribir `anulada`: ese estado es del motor, y desde la app sería la forma de vaciar la lista sin atenderla.';

-- No hay política de escritura para el staff: la incidencia la atiende quien la
-- vive. El supervisor actúa sobre su `alerta`, que es su superficie.

-- ---------------------------------------------------------------------------
-- El motor
-- ---------------------------------------------------------------------------

/*
 * Alta idempotente de una incidencia. La clave natural la resuelve
 * `incidencia_hallazgo_uq`: reentrar al paso y volver a guardar actualiza el
 * detalle en vez de duplicar la fila.
 */
create function app.crear_incidencia(
  p_tenant        uuid,
  p_visita        uuid,
  p_levantamiento uuid,
  p_marca         uuid,
  p_sku           uuid,
  p_exh_negociada uuid,
  p_origen        public.origen_incidencia,
  p_detalle       jsonb
) returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.incidencia as inc (
    tenant_id, visita_id, levantamiento_id, marca_id, sku_id,
    exhibicion_negociada_id, origen, detalle)
  values (p_tenant, p_visita, p_levantamiento, p_marca, p_sku,
          p_exh_negociada, p_origen, p_detalle)
  -- Por CONSTRAINT y no por lista de columnas: la inferencia sobre un índice
  -- `nulls not distinct` se lee explícita así, y nadie tiene que deducirla.
  on conflict on constraint incidencia_hallazgo_uq do update
     set detalle = excluded.detalle,
         -- Revive lo anulado: el hallazgo volvió porque volvió a cambiar el dato.
         estado = case when inc.estado = 'anulada'
                       then 'pendiente'::public.estado_incidencia
                       else inc.estado end
   -- Lo que el mercaderista ya ATENDIÓ no se toca: ni el estado ni el DETALLE.
   -- El detalle es la foto del hallazgo tal como estaba cuando lo resolvió, y el
   -- puntaje condicional puntuará sobre ella; refrescarlo después dejaría una
   -- acción tomada explicando unos números que la fila ya no enseña.
   where inc.estado = 'anulada'
      or (inc.estado = 'pendiente'
          and inc.detalle is distinct from excluded.detalle);
$$;

/*
 * El hallazgo dejó de existir: el mercaderista corrigió el dato que lo originó.
 * Solo alcanza a las `pendiente` — lo ya atendido sigue siendo la prueba de que
 * pasó y de lo que hizo.
 */
create function app.anular_incidencia(
  p_tenant        uuid,
  p_visita        uuid,
  p_levantamiento uuid,
  p_sku           uuid,
  p_exh_negociada uuid,
  p_origen        public.origen_incidencia
) returns void
language sql
security definer
set search_path = ''
as $$
  update public.incidencia set estado = 'anulada'
   where tenant_id = p_tenant
     and visita_id = p_visita
     and levantamiento_id is not distinct from p_levantamiento
     and sku_id is not distinct from p_sku
     and exhibicion_negociada_id is not distinct from p_exh_negociada
     and origen = p_origen
     and estado = 'pendiente';
$$;

-- Postgres concede EXECUTE a PUBLIC al crear una función, y en la nube Supabase
-- estampa además un grant explícito a `anon`: hacen falta los dos revokes. Nadie
-- las llama desde fuera — solo los triggers, que corren como el dueño.
revoke execute on function app.crear_incidencia(
  uuid, uuid, uuid, uuid, uuid, uuid, public.origen_incidencia, jsonb)
  from public, anon, authenticated, service_role;
revoke execute on function app.anular_incidencia(
  uuid, uuid, uuid, uuid, uuid, public.origen_incidencia)
  from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- El dueño de los derivados del levantamiento por SKU
--
-- La función se renombra: `alertas_*` deja de ser verdad en cuanto también crea
-- incidencias, y un nombre que miente es como nace un segundo calculador el año
-- que viene. Los triggers apuntan por OID y la ACL viaja con la función, así que
-- el rename no rompe nada.
--
-- Y pasa a dispararse TAMBIÉN en UPDATE, que es el cambio que hace que el motor
-- exista de verdad. El móvil no escribe `levantamiento_sku` de una vez: crea la
-- fila en el paso "Antes + SOS" con solo `frentes_propios`, y el stock y el
-- precio llegan después como UPDATE (`apps/mobile/src/lib/levantamiento.ts`,
-- `upsertLevantamientoSku`). Un trigger `after insert` ve `stock_piso` y
-- `precio_registrado` en NULL y no produce NADA en el flujo real. Mismo
-- precedente que `levantamiento_sku_repuntua`, que ya se dispara en los dos.
--
-- `update of <columnas>` y no `update` a secas: los pasos que no tocan el precio
-- no re-evalúan el árbol de precio. Son 40 SKUs por tres pasadas.
--
-- Las ALERTAS se siguen creando SOLO en el INSERT (`tg_op`), exactamente como
-- hasta ahora. `alerta` no tiene clave natural: dispararla en cada UPDATE la
-- duplicaría. La incidencia sí la tiene, y por eso puede. Que el motor de
-- alertas herede el mismo hueco del INSERT-only es un defecto preexistente y va
-- en su propio ticket: este cambio no lo arregla ni lo empeora.
-- ---------------------------------------------------------------------------
alter function app.alertas_levantamiento_sku() rename to derivados_levantamiento_sku;

create or replace function app.derivados_levantamiento_sku()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  lev         record;
  v_cadena    uuid;
  v_fecha     date;
  v_regular   numeric;
  v_veredicto public.evaluacion_precio;
  -- El `update of <columnas>` del trigger acota CUÁNDO se dispara; esto acota
  -- QUÉ bloque corre. Sin ellas, la pasada del stock ejecuta las dos
  -- anulaciones de precio sobre incidencias que nunca existieron, y la pasada
  -- del precio reevalúa un quiebre que nadie tocó: cuatro consultas de sobra
  -- por SKU, cuarenta SKUs por visita.
  v_stock_cambio  boolean;
  v_precio_cambio boolean;
begin
  select l.marca_id, l.visita_id into lev
  from public.levantamiento l where l.id = new.levantamiento_id;

  v_stock_cambio := tg_op = 'INSERT'
    or new.stock_sistema is distinct from old.stock_sistema
    or new.stock_piso is distinct from old.stock_piso;
  -- Se mira la columna CRUDA y no el flag `quiebre`: con el piso en 0 y el
  -- sistema pasando de 10 a 15 el flag no cambia, pero el detalle sí, y el
  -- hallazgo tiene que llegar al teléfono con los números de ahora.
  v_precio_cambio := tg_op = 'INSERT'
    or new.precio_registrado is distinct from old.precio_registrado
    or new.hay_promo is distinct from old.hay_promo
    or new.promo_comunicada is distinct from old.promo_comunicada;

  -- Quiebre y diferencia: los flags ya vienen calculados (columnas generadas).
  if v_stock_cambio then
    if new.quiebre then
      perform app.crear_incidencia(new.tenant_id, lev.visita_id, new.levantamiento_id,
        lev.marca_id, new.sku_id, null, 'quiebre',
        jsonb_build_object('stock_sistema', new.stock_sistema, 'stock_piso', new.stock_piso));
      if tg_op = 'INSERT' then
        perform app.crear_alerta(new.tenant_id, 'quiebre', lev.marca_id, lev.visita_id, 'alta',
          jsonb_build_object('sku_id', new.sku_id,
            'stock_sistema', new.stock_sistema, 'stock_piso', new.stock_piso));
      end if;
    elsif tg_op = 'UPDATE' then
      perform app.anular_incidencia(new.tenant_id, lev.visita_id, new.levantamiento_id,
        new.sku_id, null, 'quiebre');
    end if;

    if new.diferencia then
      perform app.crear_incidencia(new.tenant_id, lev.visita_id, new.levantamiento_id,
        lev.marca_id, new.sku_id, null, 'diferencia_stock',
        jsonb_build_object('stock_sistema', new.stock_sistema, 'stock_piso', new.stock_piso,
          'delta', new.stock_piso - new.stock_sistema));
      if tg_op = 'INSERT' then
        perform app.crear_alerta(new.tenant_id, 'diferencia_stock', lev.marca_id, lev.visita_id, 'info',
          jsonb_build_object('sku_id', new.sku_id,
            'stock_sistema', new.stock_sistema, 'stock_piso', new.stock_piso,
            'delta', new.stock_piso - new.stock_sistema));
      end if;
    elsif tg_op = 'UPDATE' then
      perform app.anular_incidencia(new.tenant_id, lev.visita_id, new.levantamiento_id,
        new.sku_id, null, 'diferencia_stock');
    end if;
  end if;

  if v_precio_cambio then
    if new.precio_registrado is not null then
      -- El día del negocio es el de Lima, no el de UTC: entre las 19:00 y
      -- medianoche, `current_date` ya rodó al día siguiente y la promo de ayer
      -- dejaría de encontrarse.
      select t.cadena_id, (v.check_in_recibido_at at time zone 'America/Lima')::date
        into v_cadena, v_fecha
      from public.visita v join public.tienda t on t.id = v.tienda_id
      where v.id = lev.visita_id;

      select * into v_veredicto, v_regular
      from app.evaluar_precio_sku(
        new.tenant_id, new.sku_id, lev.marca_id, v_cadena, new.precio_registrado,
        new.hay_promo, new.promo_comunicada, v_fecha);

      if v_veredicto in ('sobreprecio', 'subvaluado_sin_promo') then
        perform app.crear_incidencia(new.tenant_id, lev.visita_id, new.levantamiento_id,
          lev.marca_id, new.sku_id, null, 'desviacion_precio',
          jsonb_build_object('precio_registrado', new.precio_registrado,
            'precio_regular', v_regular, 'motivo', v_veredicto));
        if tg_op = 'INSERT' then
          perform app.crear_alerta(new.tenant_id, 'desviacion_precio', lev.marca_id, lev.visita_id, 'alta',
            jsonb_build_object('sku_id', new.sku_id, 'precio_registrado', new.precio_registrado,
              'precio_regular', v_regular, 'motivo', v_veredicto));
        end if;
      elsif tg_op = 'UPDATE' then
        perform app.anular_incidencia(new.tenant_id, lev.visita_id, new.levantamiento_id,
          new.sku_id, null, 'desviacion_precio');
      end if;

      if v_veredicto = 'promo_no_comunicada' then
        perform app.crear_incidencia(new.tenant_id, lev.visita_id, new.levantamiento_id,
          lev.marca_id, new.sku_id, null, 'promo_no_comunicada',
          jsonb_build_object('precio_registrado', new.precio_registrado,
            'precio_regular', v_regular));
        if tg_op = 'INSERT' then
          perform app.crear_alerta(new.tenant_id, 'promo_no_activa', lev.marca_id, lev.visita_id, 'alta',
            jsonb_build_object('sku_id', new.sku_id, 'precio_registrado', new.precio_registrado,
              'precio_regular', v_regular));
        end if;
      elsif tg_op = 'UPDATE' then
        perform app.anular_incidencia(new.tenant_id, lev.visita_id, new.levantamiento_id,
          new.sku_id, null, 'promo_no_comunicada');
      end if;
    elsif tg_op = 'UPDATE' then
      -- El precio se borró: no hay veredicto que sostenga las dos incidencias de
      -- precio. Sin esta rama sobrevivirían a la corrección que las desmiente.
      perform app.anular_incidencia(new.tenant_id, lev.visita_id, new.levantamiento_id,
        new.sku_id, null, 'desviacion_precio');
      perform app.anular_incidencia(new.tenant_id, lev.visita_id, new.levantamiento_id,
        new.sku_id, null, 'promo_no_comunicada');
    end if;
  end if;

  return null;
end;
$$;

-- Los dos revokes, como en las funciones de arriba: Postgres concede EXECUTE a
-- PUBLIC al crear, y en la nube Supabase estampa además un grant a `anon`. Que
-- Postgres rechace invocar una función de tipo trigger fuera de un trigger es
-- una segunda verja, no la primera.
revoke execute on function app.derivados_levantamiento_sku()
  from public, anon, authenticated, service_role;

drop trigger alertas_levantamiento_sku on public.levantamiento_sku;
create trigger derivados_levantamiento_sku
  after insert or update of stock_sistema, stock_piso, precio_registrado,
                            hay_promo, promo_comunicada
  on public.levantamiento_sku
  for each row execute function app.derivados_levantamiento_sku();

-- ---------------------------------------------------------------------------
-- El dueño de los derivados de la exhibición
--
-- El motor de alertas solo miraba `instalada and not completa`. La exhibición
-- NEGOCIADA que no se instaló es un hallazgo distinto —y el que el cliente
-- nombró— y no tenía dueño. La `adicional` (sin negociación detrás) queda fuera:
-- que no se instale no incumple nada.
-- ---------------------------------------------------------------------------
alter function app.alertas_exhibicion() rename to derivados_exhibicion;

create or replace function app.derivados_exhibicion()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  lev record;
begin
  select l.marca_id, l.visita_id into lev
  from public.levantamiento l where l.id = new.levantamiento_id;

  if new.instalada is true and new.completa is false then
    if tg_op = 'INSERT' then
      perform app.crear_alerta(new.tenant_id, 'exhibicion_incompleta', lev.marca_id, lev.visita_id, 'info',
        jsonb_build_object('exhibicion_id', new.id, 'unidades', new.unidades));
    end if;
  end if;

  if new.exhibicion_negociada_id is not null and new.instalada is false then
    perform app.crear_incidencia(new.tenant_id, lev.visita_id, new.levantamiento_id,
      lev.marca_id, null, new.exhibicion_negociada_id, 'exhibicion_no_instalada',
      jsonb_build_object('exhibicion_id', new.id, 'unidades', new.unidades));
  elsif tg_op = 'UPDATE' and new.exhibicion_negociada_id is not null then
    perform app.anular_incidencia(new.tenant_id, lev.visita_id, new.levantamiento_id,
      null, new.exhibicion_negociada_id, 'exhibicion_no_instalada');
  end if;

  return null;
end;
$$;

revoke execute on function app.derivados_exhibicion()
  from public, anon, authenticated, service_role;

drop trigger alertas_exhibicion on public.exhibicion;
create trigger derivados_exhibicion
  after insert or update of instalada, completa
  on public.exhibicion
  for each row execute function app.derivados_exhibicion();
