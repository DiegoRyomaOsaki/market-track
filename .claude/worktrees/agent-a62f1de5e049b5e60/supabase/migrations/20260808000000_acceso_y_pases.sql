-- La pantalla de acceso y segundo factor del panel: los canales de OTP (política
-- global de la outsourcing) y la bitácora de pases de acceso temporal.
--
-- Es el camino más sensible del sistema de auth: quien emite un pase puede entrar
-- como ese mercaderista. Por eso esta migración endurece lo que ya existía antes
-- de ponerle una interfaz encima — una pantalla no puede ser la única que impida
-- algo que la base permite.

-- --- El estado de un pase ------------------------------------------------------
--
-- Derivado de tres columnas y del reloj, así que no puede ser una columna
-- generada. Tampoco una vista: el harness de aislamiento descubre las tablas por
-- `relkind = 'r'` y no la miraría, y sin `security_invoker` una vista salta la
-- RLS en silencio (está documentado en `20260716220000_tienda_lat_lon_generadas`).
--
-- Vive en `app` y no en `public` porque tiene DOS consumidores dentro de la base
-- —la bitácora y el trigger de revocación— y ninguno fuera. Que MAR-66 herede
-- esta definición de "vigente" en vez de reinventarla es justamente el objetivo:
-- una sola regla, un solo dueño.
create type public.estado_pase as enum ('vigente', 'usado', 'vencido', 'revocado');

create function app.estado_pase(
  p_usado_at timestamptz,
  p_revocado_at timestamptz,
  p_expira_at timestamptz
)
returns public.estado_pase
language sql
stable
set search_path = ''
as $$
  -- El orden importa: un pase usado ya no se puede revocar ni vencer, y uno
  -- revocado tampoco vence. El trigger de abajo impide que se den a la vez, pero
  -- la precedencia se declara igual porque los datos viejos no se re-validan.
  select case
    when p_usado_at is not null then 'usado'::public.estado_pase
    when p_revocado_at is not null then 'revocado'::public.estado_pase
    when p_expira_at <= now() then 'vencido'::public.estado_pase
    else 'vigente'::public.estado_pase
  end;
$$;

comment on function app.estado_pase(timestamptz, timestamptz, timestamptz) is
  'El estado de un pase de acceso temporal, derivado de sus marcas de tiempo. Un solo dueño de la regla: lo usan la bitácora y el trigger de revocación, y MAR-66 heredará de aquí qué significa "vigente".';

revoke execute on function app.estado_pase(timestamptz, timestamptz, timestamptz) from public;
grant execute on function app.estado_pase(timestamptz, timestamptz, timestamptz)
  to authenticated, service_role;

-- --- Quién lee qué pase --------------------------------------------------------
--
-- `pase_staff_lee` usaba `app.es_staff()`, que incluye al supervisor: uno veía
-- los pases de los mercaderistas de otro. Se parte por rol, porque el `select` va
-- por PostgREST y la política es lo único que lo contiene.
drop policy pase_staff_lee on public.pase_acceso_temporal;

create policy pase_admin_lee on public.pase_acceso_temporal
  for select to authenticated
  using ((select app.rol_actual()) = 'admin');

create policy pase_supervisor_lee_los_suyos on public.pase_acceso_temporal
  for select to authenticated
  using (
    (select app.rol_actual()) = 'supervisor'
    and exists (
      select 1 from public.profile p
      where p.id = profile_id
        and p.supervisor_id = (select auth.uid())
        -- El rol, además del organigrama: hoy solo un mercaderista tiene
        -- `supervisor_id`, pero esa invariante vive en la disciplina de quien da
        -- de alta, no en un CHECK. Si un día se le asignara supervisor a un
        -- perfil de staff, sin esto pasaría a ser sujeto de pase.
        and p.rol = 'mercaderista'
    )
  );

-- --- Quién emite y quién revoca ------------------------------------------------
--
-- `pase_admin_emite` era `for all`, y eso mezcla tres verbos con reglas distintas.
-- El problema concreto: atarle `generado_por = auth.uid()` al `with check` para
-- impedir que un admin atribuya un pase a otro haría que ese mismo check se
-- aplicara al UPDATE, y entonces un admin no podría revocar el pase que emitió un
-- supervisor. Se parte por verbo.
drop policy pase_admin_emite on public.pase_acceso_temporal;

create policy pase_admin_emite on public.pase_acceso_temporal
  for insert to authenticated
  with check (
    (select app.rol_actual()) = 'admin'
    -- El emisor es quien inserta. Sin esto, la bitácora puede mentir sobre quién
    -- dio acceso — que es lo único que esa bitácora existe para responder.
    and generado_por = (select auth.uid())
    and usado_at is null
    and revocado_at is null
    -- El pase es el rescate del MERCADERISTA que no recibe su código en tienda.
    -- La Edge Function ya lo restringe así, pero por PostgREST directo un admin
    -- podía emitirse uno para un supervisor, para otro admin o para el usuario
    -- de un cliente — o sea, un camino a la sesión de cualquiera. La RLS es la
    -- última línea y tiene que replicar el mismo alcance.
    and exists (
      select 1 from public.profile p
      where p.id = profile_id and p.rol = 'mercaderista'
    )
  );

create policy pase_admin_revoca on public.pase_acceso_temporal
  for update to authenticated
  using ((select app.rol_actual()) = 'admin')
  with check ((select app.rol_actual()) = 'admin');

-- El supervisor revoca los de los suyos: revocar solo QUITA acceso, nunca lo da.
-- Sin esto, quien dictó un código a la persona equivocada solo puede esperar
-- quince minutos o llamar a un admin.
create policy pase_supervisor_revoca_los_suyos on public.pase_acceso_temporal
  for update to authenticated
  using (
    (select app.rol_actual()) = 'supervisor'
    and exists (
      select 1 from public.profile p
      where p.id = profile_id
        and p.supervisor_id = (select auth.uid())
        -- El rol, además del organigrama: hoy solo un mercaderista tiene
        -- `supervisor_id`, pero esa invariante vive en la disciplina de quien da
        -- de alta, no en un CHECK. Si un día se le asignara supervisor a un
        -- perfil de staff, sin esto pasaría a ser sujeto de pase.
        and p.rol = 'mercaderista'
    )
  )
  with check (
    (select app.rol_actual()) = 'supervisor'
    and exists (
      select 1 from public.profile p
      where p.id = profile_id
        and p.supervisor_id = (select auth.uid())
        -- El rol, además del organigrama: hoy solo un mercaderista tiene
        -- `supervisor_id`, pero esa invariante vive en la disciplina de quien da
        -- de alta, no en un CHECK. Si un día se le asignara supervisor a un
        -- perfil de staff, sin esto pasaría a ser sujeto de pase.
        and p.rol = 'mercaderista'
    )
  );

-- --- La bitácora es de solo lectura salvo por una columna ----------------------
--
-- El UPDATE estaba concedido sobre TODA la tabla, así que el motivo y el emisor
-- de un pase ya emitido eran reescribibles. Una bitácora que se puede reescribir
-- no audita nada. La RLS filtra filas, no columnas: el grant es lo único que
-- distingue "revocar" de "reescribir la historia".
revoke update on public.pase_acceso_temporal from authenticated;
grant update (revocado_at) on public.pase_acceso_temporal to authenticated;

-- --- La revocación va en una sola dirección ------------------------------------
--
-- Con el grant de arriba todavía se podría des-revocar un pase (poner el valor de
-- vuelta a null) o antedatar la revocación, y entonces la bitácora diría "vigente"
-- de algo que se cerró. El valor lo pone el servidor, no el llamante.
create function app.pase_revocacion_de_una_via()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.revocado_at is not null
     and new.revocado_at is distinct from old.revocado_at then
    raise exception 'un pase revocado no se puede des-revocar ni retocar'
      using errcode = 'check_violation';
  end if;

  if new.revocado_at is not null and old.revocado_at is null then
    if app.estado_pase(old.usado_at, old.revocado_at, old.expira_at) <> 'vigente' then
      raise exception 'solo se revoca un pase vigente'
        using errcode = 'check_violation';
    end if;
    -- El reloj es el del servidor: una revocación antedatada dejaría un hueco en
    -- el que el pase parecería haber estado vivo.
    new.revocado_at := now();
  end if;

  return new;
end;
$$;

revoke execute on function app.pase_revocacion_de_una_via() from public;

create trigger pase_revocacion_de_una_via
  before update on public.pase_acceso_temporal
  for each row execute function app.pase_revocacion_de_una_via();

-- --- La bitácora ---------------------------------------------------------------
--
-- `security invoker`: las políticas de arriba deciden qué filas salen. La función
-- solo da forma —resuelve los nombres y deriva el estado—, nunca decide acceso.
create function public.bitacora_pases(
  p_profile_id uuid default null,
  p_estado public.estado_pase default null,
  p_limite integer default 50
)
returns table (
  id uuid,
  profile_id uuid,
  usuario_nombre text,
  emisor_nombre text,
  motivo text,
  estado public.estado_pase,
  generado_at timestamptz,
  expira_at timestamptz
)
language sql
stable
set search_path = ''
as $$
  select
    pa.id, pa.profile_id, u.nombre, e.nombre, pa.motivo,
    app.estado_pase(pa.usado_at, pa.revocado_at, pa.expira_at),
    pa.generado_at, pa.expira_at
  from public.pase_acceso_temporal pa
  -- LEFT y no INNER: una política futura que esconda un perfil haría desaparecer
  -- la fila entera de la bitácora, en silencio. Un nombre que falta se pinta como
  -- un hueco; una fila que falta no se ve.
  left join public.profile u on u.id = pa.profile_id
  left join public.profile e on e.id = pa.generado_por
  where (p_profile_id is null or pa.profile_id = p_profile_id)
    and (p_estado is null
         or app.estado_pase(pa.usado_at, pa.revocado_at, pa.expira_at) = p_estado)
  order by pa.generado_at desc, pa.id desc
  limit least(greatest(coalesce(p_limite, 50), 1), 200);
$$;

comment on function public.bitacora_pases(uuid, public.estado_pase, integer) is
  'La bitácora de pases de acceso temporal. Nunca expone `codigo_hash`. La RLS decide qué filas ve quien llama: el admin todas, el supervisor solo las de sus mercaderistas.';

revoke execute on function public.bitacora_pases(uuid, public.estado_pase, integer) from public;
revoke execute on function public.bitacora_pases(uuid, public.estado_pase, integer) from anon;
grant execute on function public.bitacora_pases(uuid, public.estado_pase, integer)
  to authenticated, service_role;

-- --- El correo no se puede desactivar ------------------------------------------
--
-- Es el único canal que entrega hoy, y dejar la plataforma sin ninguno cerraría
-- la puerta a todo el mundo. La regla vive en la base: en la UI sería una
-- convención que un POST directo se salta.
alter table public.configuracion_plataforma
  add constraint config_correo_siempre_habilitado
  check ('correo'::public.canal_otp = any (otp_canales_habilitados));

-- Cambiar la política global de 2FA es la acción más sensible de esta pantalla y
-- no dejaba rastro de quién la hizo.
alter table public.configuracion_plataforma
  add column actualizado_por uuid references public.profile (id) on delete set null;

-- Ni la marca de tiempo ni el autor los escribe el llamante: los pone el servidor.
-- Y `otp_requerido` no lo lee nadie todavía — dejarlo escribible invita a pintarle
-- un interruptor que no gobernaría nada.
revoke update on public.configuracion_plataforma from authenticated;
grant update (otp_canales_habilitados) on public.configuracion_plataforma to authenticated;

create function app.sellar_configuracion_plataforma()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.actualizado_at := now();
  new.actualizado_por := (select auth.uid());
  return new;
end;
$$;

revoke execute on function app.sellar_configuracion_plataforma() from public;

create trigger configuracion_plataforma_sellar
  before update on public.configuracion_plataforma
  for each row execute function app.sellar_configuracion_plataforma();
