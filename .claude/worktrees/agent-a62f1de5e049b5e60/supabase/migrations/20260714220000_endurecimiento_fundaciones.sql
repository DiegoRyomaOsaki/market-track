-- Endurecimiento de fundaciones: cierra los huecos de ESCRITURA que la auditoría
-- de fundaciones encontró antes de construir apps/web y apps/mobile. El harness
-- de aislamiento solo probaba lecturas, así que estos huecos pasaban en verde.
--
-- Migración append-only: NO edita ninguna migración ya aplicada. Donde hay que
-- cambiar una política se hace drop + create (una política no se altera en sitio).

-- ---------------------------------------------------------------------------
-- 1. CRÍTICO — visita: la escritura del mercaderista no ataba tenant_id ni
--    respetaba la revocación. El WITH CHECK solo miraba `mercaderista_id =
--    auth.uid()`, que sigue siendo cierto para un desvinculado con un token aún
--    válido: podía insertar visitas nuevas y actualizar las suyas, y nada le
--    impedía escribir con un tenant_id ajeno. Es el camino de subida de
--    apps/mobile (PowerSync sube por PostgREST).
--    Al atar `tenant_id = app.tenant_actual()`, el desvinculado falla cerrado:
--    perfil_efectivo() devuelve 0 filas → tenant_actual() es NULL → la igualdad
--    nunca se cumple. La revocación llega también a la escritura, sin tocar el JWT.
-- ---------------------------------------------------------------------------
drop policy visita_mercaderista_inserta_las_suyas on public.visita;
drop policy visita_mercaderista_actualiza_las_suyas on public.visita;

create policy visita_mercaderista_inserta_las_suyas on public.visita for insert to authenticated
  with check (
    mercaderista_id = (select auth.uid())
    and tenant_id = (select app.tenant_actual())
  );
create policy visita_mercaderista_actualiza_las_suyas on public.visita for update to authenticated
  using (
    mercaderista_id = (select auth.uid())
    and tenant_id = (select app.tenant_actual())
  )
  with check (
    mercaderista_id = (select auth.uid())
    and tenant_id = (select app.tenant_actual())
  );

-- ---------------------------------------------------------------------------
-- 2. pase_acceso_temporal: el camino más sensible del sistema de auth (quien
--    emite un pase entra como el mercaderista). El supervisor podía atribuir el
--    pase a otro (`generado_por` = el admin), destruyendo la auditoría, y fijar
--    una expiración arbitraria. Se ata el emisor a quien inserta y se acota la
--    ventana con un CHECK de tabla (aplica a todos los roles).
-- ---------------------------------------------------------------------------
alter table public.pase_acceso_temporal
  add constraint pase_expira_max_15min
  check (expira_at <= generado_at + interval '15 minutes');

drop policy pase_supervisor_emite_a_los_suyos on public.pase_acceso_temporal;
create policy pase_supervisor_emite_a_los_suyos on public.pase_acceso_temporal
  for insert to authenticated
  with check (
    (select app.rol_actual()) = 'supervisor'
    and generado_por = (select auth.uid())
    and usado_at is null
    and revocado_at is null
    and exists (
      select 1 from public.profile p
      where p.id = profile_id and p.supervisor_id = (select auth.uid())
    )
  );

-- ---------------------------------------------------------------------------
-- 3. tenant: tenía la política de escritura del admin (tenant_admin_escribe)
--    pero ningún GRANT — la política estaba muerta y el alta/baja de un cliente
--    moría con 42501, que parece un error de RLS sin serlo. El GRANT es la
--    puerta; la RLS (solo admin) sigue siendo el portero. Mismo patrón que
--    marca/profile.
-- ---------------------------------------------------------------------------
grant insert, update on public.tenant to authenticated;

-- ---------------------------------------------------------------------------
-- 4. alerta: el UPDATE estaba concedido en TODA la tabla, así que cualquier
--    usuario del tenant (incluido el mercaderista, cuyas visitas las generan)
--    podía reescribir payload, tipo, severidad… — la evidencia de la alerta. La
--    RLS filtra filas, no columnas: se estrecha el grant a la única columna que
--    el usuario cambia (estado: nueva → vista → resuelta). El resto lo escribe
--    el motor con service_role. La política de update ya restringe la fila.
-- ---------------------------------------------------------------------------
revoke update on public.alerta from authenticated;
grant update (estado) on public.alerta to authenticated;

-- ---------------------------------------------------------------------------
-- 6. tenant_id de las tablas que escribe el mercaderista: los upload schemas lo
--    omiten a propósito (sale del contexto, no del payload), pero la columna es
--    NOT NULL sin default, así que todo INSERT vía PostgREST moría con 23502. Se
--    rellena con el tenant efectivo.
--    OJO: un DEFAULT de columna NO admite subconsulta — va `app.tenant_actual()`
--    sin envolver. El `(select ...)` es solo para las políticas (InitPlan); en un
--    default la función ya se evalúa una vez por fila. El INSERT de import o de
--    staff con tenant_id explícito ignora el default.
-- ---------------------------------------------------------------------------
alter table public.visita            alter column tenant_id set default app.tenant_actual();
alter table public.levantamiento     alter column tenant_id set default app.tenant_actual();
alter table public.levantamiento_sku alter column tenant_id set default app.tenant_actual();
alter table public.exhibicion        alter column tenant_id set default app.tenant_actual();
alter table public.contingencia      alter column tenant_id set default app.tenant_actual();
alter table public.foto              alter column tenant_id set default app.tenant_actual();

-- ---------------------------------------------------------------------------
-- 8. precio_regular y promocion no tenían clave natural: reimportar el mismo
--    Excel duplicaba precios y promos. El resto del maestro (marca, cadena,
--    tienda, sku) ya la lleva con unique (tenant_id, codigo_externo). Aquí la
--    clave es el propio hecho comercial.
--    NULLS NOT DISTINCT en precio_regular porque tipo_tienda es nullable y dos
--    precios con tipo_tienda NULL deben colisionar (si no, el NULL escapa siempre).
-- ---------------------------------------------------------------------------
alter table public.precio_regular
  add constraint precio_regular_natural_uq
  unique nulls not distinct (tenant_id, sku_id, cadena_id, tipo_tienda, vigente_desde);
alter table public.promocion
  add constraint promocion_natural_uq
  unique (tenant_id, sku_id, fecha_inicio);
