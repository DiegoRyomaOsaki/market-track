-- El motor de alertas estaba mudo para stock y precio en el flujo real.
--
-- El trigger nacía `after insert on levantamiento_sku`, pero el móvil no escribe
-- esa fila de una vez: `upsertLevantamientoSku` la crea en el paso "Antes + SOS"
-- con solo `frentes_propios`, y el stock y el precio llegan después como UPDATE.
-- El trigger se disparaba con `stock_piso` y `precio_registrado` todavía en NULL:
-- los flags `quiebre` y `diferencia` son columnas generadas y valían NULL, y al
-- árbol de precio ni se entraba. En el flujo real no salía ni una alerta de
-- `quiebre`, `diferencia_stock`, `desviacion_precio` ni `promo_no_activa`.
--
-- El ticket de la incidencia de visita rebindeó el trigger a `insert or update`,
-- pero dejó las alertas guardadas tras un `tg_op = 'INSERT'` a propósito: sin
-- clave natural, dispararlas en cada UPDATE habría producido tres alertas del
-- mismo quiebre en vez de una. Esa clave es lo que llega aquí, y con ella caen
-- los guardias.

-- ---------------------------------------------------------------------------
-- 1. El SKU sale del payload y pasa a ser una columna con verja
-- ---------------------------------------------------------------------------
--
-- Estaba dentro de `payload` (jsonb), donde no lo valida nadie: un uuid ahí no
-- tiene FK que lo ate a un SKU real ni al tenant correcto. Como columna con FK
-- compuesta queda igual que en `incidencia`, que es su gemela, y además se puede
-- indexar — que es lo que la deduplicación necesita.
alter table public.alerta add column sku_id uuid;

alter table public.alerta add constraint alerta_sku_fk
  foreign key (sku_id, tenant_id)
  references public.sku (id, tenant_id) on delete restrict;

-- El histórico se rellena desde donde estaba. `where exists` porque un payload
-- puede traer un uuid de un SKU que ya no existe, y la FK lo rechazaría: esas
-- filas se quedan con la columna nula y su payload intacto.
update public.alerta a
   set sku_id = (a.payload->>'sku_id')::uuid
 where a.payload->>'sku_id' is not null
   and exists (
     select 1 from public.sku s
     where s.id = (a.payload->>'sku_id')::uuid and s.tenant_id = a.tenant_id
   );

-- Las duplicadas que el flujo viejo ya dejó: se conserva la más antigua, que es
-- la que el supervisor vio primero y sobre la que pudo actuar.
delete from public.alerta a
 using public.alerta vieja
 where a.sku_id is not null
   and vieja.sku_id is not null
   and a.tenant_id = vieja.tenant_id
   and a.visita_id = vieja.visita_id
   and a.tipo = vieja.tipo
   and a.sku_id = vieja.sku_id
   and (vieja.creado_at, vieja.id) < (a.creado_at, a.id);

-- UN HALLAZGO = UNA ALERTA, pero solo para los hallazgos que cuelgan de un SKU.
--
-- PARCIAL a propósito. Una única sobre las cuatro columnas a secas rompería
-- `contingencia` —una visita tiene legítimamente varias, una por paso omitido— y
-- `exhibicion_incompleta`, que cuelga de una exhibición y no de un SKU. Con el
-- `where sku_id is not null` solo entran los cuatro tipos que el flujo de tres
-- pasadas duplica, que son exactamente los que estaban mudos.
create unique index alerta_hallazgo_sku_uq
  on public.alerta (tenant_id, visita_id, tipo, sku_id)
  where sku_id is not null;

comment on column public.alerta.sku_id is
  'El SKU del hallazgo, cuando lo hay. Fuera del payload para que tenga FK y para que la deduplicación pueda indexarlo; null en las alertas que no cuelgan de un SKU (contingencia, exhibicion_incompleta, verificacion_fotos).';

-- ---------------------------------------------------------------------------
-- 2. El helper deduplica en vez de acumular
-- ---------------------------------------------------------------------------
--
-- Cambia de firma (entra `p_sku`), así que se recrea. Los llamadores que no
-- pasan SKU siguen valiendo: el parámetro tiene default.
drop function app.crear_alerta(
  uuid, public.tipo_alerta, uuid, uuid, public.severidad_alerta, jsonb);

--
-- DOS caminos, y no por gusto: `alerta` tiene ya dos reglas de unicidad con
-- semánticas distintas, y una sola cláusula `on conflict` por sentencia.
--
--   · Hallazgo de SKU (`alerta_hallazgo_sku_uq`) — se deduplica y REVIVE: el
--     wizard escribe la fila en tres pasadas y el hallazgo puede ir y venir.
--   · Todo lo demás — se inserta una vez y ya. Aquí vive el aviso de
--     verificación de fotos, cuyo índice (`alerta_verificacion_fotos_uq`) es
--     "uno para siempre": no se re-emite mientras el bloqueo dure.
--
-- El helper viejo llevaba un `on conflict do nothing` a secas, y su propio
-- comentario avisó de esto: "el día que otra restricción única llegue a
-- `alerta`, sus violaciones se ignorarán aquí en silencio". Un `on conflict`
-- dirigido a la clave nueva deja de cubrir la vieja, así que la rama sin SKU
-- conserva el `do nothing` textualmente.
create function app.crear_alerta(
  p_tenant    uuid,
  p_tipo      public.tipo_alerta,
  p_marca     uuid,
  p_visita    uuid,
  p_severidad public.severidad_alerta,
  p_payload   jsonb,
  p_sku       uuid default null
) returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_sku is null then
    insert into public.alerta
      (tenant_id, tipo, marca_id, visita_id, severidad, payload)
    values (p_tenant, p_tipo, p_marca, p_visita, p_severidad, p_payload)
    on conflict do nothing;
    return;
  end if;

  insert into public.alerta as a
    (tenant_id, tipo, marca_id, visita_id, sku_id, severidad, payload)
  values (p_tenant, p_tipo, p_marca, p_visita, p_sku, p_severidad, p_payload)
  -- La inferencia repite el predicado del índice parcial: sin él Postgres no
  -- sabe cuál es.
  on conflict (tenant_id, visita_id, tipo, sku_id) where sku_id is not null
  do update
     set payload = excluded.payload,
         severidad = excluded.severidad,
         -- El hallazgo volvió: la alerta anulada se reabre.
         estado = case when a.estado = 'anulada'
                       then 'nueva'::public.estado_alerta
                       else a.estado end
   -- Lo que un humano ya miró no se toca. El supervisor marcó `vista` o
   -- `resuelta` sobre unos números concretos; refrescarle el payload por debajo
   -- le cambiaría la evidencia de una decisión que ya tomó.
   where a.estado = 'anulada'
      or (a.estado = 'nueva'
          and (a.payload is distinct from excluded.payload
               or a.severidad is distinct from excluded.severidad));
end;
$$;

/*
 * El hallazgo dejó de existir: el mercaderista corrigió el dato.
 *
 * Solo alcanza a las `nueva`. Una alerta que el supervisor ya miró es parte de
 * su bandeja de trabajo y la cierra él; anularla por debajo le quitaría de la
 * vista algo sobre lo que quizá ya actuó.
 */
create function app.anular_alerta(
  p_tenant uuid,
  p_visita uuid,
  p_tipo   public.tipo_alerta,
  p_sku    uuid
) returns void
language sql
security definer
set search_path = ''
as $$
  update public.alerta set estado = 'anulada'
   where tenant_id = p_tenant
     and visita_id = p_visita
     and tipo = p_tipo
     and sku_id = p_sku
     and estado = 'nueva';
$$;

revoke execute on function app.crear_alerta(
  uuid, public.tipo_alerta, uuid, uuid, public.severidad_alerta, jsonb, uuid)
  from public, anon, authenticated, service_role;
revoke execute on function app.anular_alerta(
  uuid, uuid, public.tipo_alerta, uuid)
  from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 3. El motor deja de callarse en el UPDATE
-- ---------------------------------------------------------------------------
--
-- Caen los `tg_op = 'INSERT'` que envolvían cada `crear_alerta`: con la clave
-- natural, dispararla en cada pasada del wizard actualiza la misma fila en vez
-- de acumular tres. Y cada rama de anulación de incidencia gana su gemela de
-- alerta — las dos nacen del mismo hallazgo y ahora también mueren con él.
--
-- El trigger no se toca: ya está bindeado a `insert or update of <columnas>`.
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
  -- QUÉ bloque corre. Sin ellas, la pasada del stock ejecuta las anulaciones de
  -- precio sobre hallazgos que nunca existieron, y la pasada del precio reevalúa
  -- un quiebre que nadie tocó: consultas de sobra por SKU, cuarenta SKUs por
  -- visita.
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
  -- hallazgo tiene que llegar con los números de ahora.
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
      perform app.crear_alerta(new.tenant_id, 'quiebre', lev.marca_id, lev.visita_id, 'alta',
        jsonb_build_object('sku_id', new.sku_id,
          'stock_sistema', new.stock_sistema, 'stock_piso', new.stock_piso),
        new.sku_id);
    elsif tg_op = 'UPDATE' then
      perform app.anular_incidencia(new.tenant_id, lev.visita_id, new.levantamiento_id,
        new.sku_id, null, 'quiebre');
      perform app.anular_alerta(new.tenant_id, lev.visita_id, 'quiebre', new.sku_id);
    end if;

    if new.diferencia then
      perform app.crear_incidencia(new.tenant_id, lev.visita_id, new.levantamiento_id,
        lev.marca_id, new.sku_id, null, 'diferencia_stock',
        jsonb_build_object('stock_sistema', new.stock_sistema, 'stock_piso', new.stock_piso,
          'delta', new.stock_piso - new.stock_sistema));
      perform app.crear_alerta(new.tenant_id, 'diferencia_stock', lev.marca_id, lev.visita_id, 'info',
        jsonb_build_object('sku_id', new.sku_id,
          'stock_sistema', new.stock_sistema, 'stock_piso', new.stock_piso,
          'delta', new.stock_piso - new.stock_sistema),
        new.sku_id);
    elsif tg_op = 'UPDATE' then
      perform app.anular_incidencia(new.tenant_id, lev.visita_id, new.levantamiento_id,
        new.sku_id, null, 'diferencia_stock');
      perform app.anular_alerta(new.tenant_id, lev.visita_id, 'diferencia_stock', new.sku_id);
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
        perform app.crear_alerta(new.tenant_id, 'desviacion_precio', lev.marca_id, lev.visita_id, 'alta',
          jsonb_build_object('sku_id', new.sku_id, 'precio_registrado', new.precio_registrado,
            'precio_regular', v_regular, 'motivo', v_veredicto),
          new.sku_id);
      elsif tg_op = 'UPDATE' then
        perform app.anular_incidencia(new.tenant_id, lev.visita_id, new.levantamiento_id,
          new.sku_id, null, 'desviacion_precio');
        perform app.anular_alerta(new.tenant_id, lev.visita_id, 'desviacion_precio', new.sku_id);
      end if;

      if v_veredicto = 'promo_no_comunicada' then
        perform app.crear_incidencia(new.tenant_id, lev.visita_id, new.levantamiento_id,
          lev.marca_id, new.sku_id, null, 'promo_no_comunicada',
          jsonb_build_object('precio_registrado', new.precio_registrado,
            'precio_regular', v_regular));
        perform app.crear_alerta(new.tenant_id, 'promo_no_activa', lev.marca_id, lev.visita_id, 'alta',
          jsonb_build_object('sku_id', new.sku_id, 'precio_registrado', new.precio_registrado,
            'precio_regular', v_regular),
          new.sku_id);
      elsif tg_op = 'UPDATE' then
        perform app.anular_incidencia(new.tenant_id, lev.visita_id, new.levantamiento_id,
          new.sku_id, null, 'promo_no_comunicada');
        perform app.anular_alerta(new.tenant_id, lev.visita_id, 'promo_no_activa', new.sku_id);
      end if;
    elsif tg_op = 'UPDATE' then
      -- El precio se borró: no hay veredicto que sostenga los hallazgos de
      -- precio. Sin esta rama sobrevivirían a la corrección que los desmiente.
      perform app.anular_incidencia(new.tenant_id, lev.visita_id, new.levantamiento_id,
        new.sku_id, null, 'desviacion_precio');
      perform app.anular_incidencia(new.tenant_id, lev.visita_id, new.levantamiento_id,
        new.sku_id, null, 'promo_no_comunicada');
      perform app.anular_alerta(new.tenant_id, lev.visita_id, 'desviacion_precio', new.sku_id);
      perform app.anular_alerta(new.tenant_id, lev.visita_id, 'promo_no_activa', new.sku_id);
    end if;
  end if;

  return null;
end;
$$;

revoke execute on function app.derivados_levantamiento_sku()
  from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 4. `anulada` la escribe el MOTOR, y eso lo dice la política
-- ---------------------------------------------------------------------------
--
-- El portal ya no ofrece el botón, pero eso es UX, no seguridad: el grant deja a
-- `authenticated` escribir la columna `estado`, y la política no miraba el VALOR.
-- Un cliente-marca podía marcar `anulada` por PostgREST y esconder de la bandeja
-- del supervisor un hallazgo que nadie corrigió — justo la integridad que este
-- ticket viene a devolver.
--
-- Se niega a todos, staff incluido: el estado significa "el dato que lo originó
-- dejó de existir", y eso solo lo sabe el motor. Las funciones que lo escriben
-- son SECURITY DEFINER y no pasan por RLS. Reabrir sigue funcionando: ahí el
-- valor NUEVO es `nueva`, no `anulada`.
--
-- Es la misma verja que `incidencia_mercaderista_atiende` puso para el estado
-- gemelo; faltaba su mitad aquí.
alter policy alerta_usuario_marca_estado on public.alerta
  using (
    (tenant_id = (select app.tenant_actual()) and app.tipo_alerta_del_cliente(tipo))
    or (select app.es_staff())
  )
  with check (
    (
      (tenant_id = (select app.tenant_actual()) and app.tipo_alerta_del_cliente(tipo))
      or (select app.es_staff())
    )
    and estado <> 'anulada'
  );

comment on policy alerta_usuario_marca_estado on public.alerta is
  'Quién mueve el estado de una alerta. `anulada` queda fuera para todos: la escribe el motor cuando el hallazgo deja de existir, y desde la app sería la forma de vaciar la bandeja sin que nadie corrigiera nada.';

-- `derivados_exhibicion` NO se toca. Su alerta (`exhibicion_incompleta`) no está
-- muda: la exhibición se inserta ya completa, así que el `after insert` la ve. Y
-- como no cuelga de un SKU, no entra en el índice parcial y no tendría con qué
-- deduplicarse — quitarle su guardia crearía una alerta por cada UPDATE.
