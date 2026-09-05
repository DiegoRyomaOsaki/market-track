-- La atención de un hallazgo, declarada por el mercaderista, que sí viaja
-- desde el teléfono. Ver docs/adr/0012.
--
-- El problema: la `incidencia` nace de un trigger que corre cuando la fila llega
-- al SERVIDOR. En una visita hecha entera sin señal no existe en la réplica, así
-- que `UPDATE incidencia … WHERE id = ?` afecta a cero filas, PowerSync no
-- encola nada, y la acción del mercaderista —con su foto y su motivo— se pierde
-- SIN UN SOLO MENSAJE. Y `promo_no_comunicada` no se puede corregir desde la
-- tienda: solo se atiende. O sea que la verja de check-out sería una trampa.
--
-- Por qué una tabla y no abrir el INSERT de `incidencia`: el hallazgo es un
-- DERIVADO y su dueño es el servidor —la migración que creó `incidencia` lo negó
-- por escrito y hay un test que lo fija—; la atención es una DECLARACIÓN, y el
-- mercaderista es su único dueño posible. ADR-0011 no prohíbe duplicar: prohíbe
-- duplicar lo que se persiste.
--
-- Y no es poder nuevo: el mercaderista YA podía escribir estado, acción, motivo
-- y foto sobre `incidencia` por grant de columnas. Esto es la misma potestad por
-- una puerta que funciona ANTES de que la incidencia exista.

create table public.atencion_hallazgo (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references public.tenant (id) on delete restrict,

  -- La MISMA tupla que `incidencia_hallazgo_uq`: es lo que permite casar la
  -- declaración con el hallazgo cuando el motor por fin lo produce.
  visita_id                uuid not null,
  levantamiento_id         uuid,
  sku_id                   uuid,
  exhibicion_negociada_id  uuid,
  origen                   public.origen_incidencia not null,

  -- Solo los dos estados que el mercaderista puede declarar. `anulada` es del
  -- motor y `pendiente` es la ausencia de atención: ninguno se declara.
  estado       public.estado_incidencia not null
    check (estado in ('resuelta', 'no_resuelta')),
  accion_tomada text,
  motivo        text,
  foto_resolucion_id uuid,

  -- Nulo = todavía no ha encontrado su incidencia. NO es un error: puede que la
  -- fila del levantamiento aún no haya subido. Que se quede en null para siempre
  -- SÍ lo es —el espejo vio un hallazgo que el motor no produce— y por eso se
  -- guarda en vez de descartarse en silencio.
  aplicada_at  timestamptz,
  creado_at    timestamptz not null default now(),

  constraint atencion_hallazgo_uq unique nulls not distinct
    (tenant_id, visita_id, levantamiento_id, sku_id, exhibicion_negociada_id, origen),

  constraint atencion_visita_fk foreign key (visita_id, tenant_id)
    references public.visita (id, tenant_id) on delete cascade,
  constraint atencion_lev_fk foreign key (levantamiento_id, tenant_id)
    references public.levantamiento (id, tenant_id) on delete cascade,
  constraint atencion_sku_fk foreign key (sku_id, tenant_id)
    references public.sku (id, tenant_id) on delete restrict,
  constraint atencion_exh_neg_fk foreign key (exhibicion_negociada_id, tenant_id)
    references public.exhibicion_negociada (id, tenant_id) on delete cascade,
  constraint atencion_foto_fk foreign key (foto_resolucion_id, tenant_id)
    references public.foto (id, tenant_id) on delete set null
);

comment on table public.atencion_hallazgo is
  'Lo que el mercaderista declara haber hecho con un hallazgo, con la clave natural del hallazgo en vez de un id de incidencia: se puede escribir SIN SEÑAL, antes de que el motor produzca la incidencia. Ver docs/adr/0012.';

comment on column public.atencion_hallazgo.aplicada_at is
  'Cuándo se volcó sobre su incidencia. Nula mientras el motor no ha producido el hallazgo; si se queda nula, el espejo del móvil y el motor discrepan.';

-- Para buscar las atenciones de una visita al aplicarlas, y para la lista del
-- móvil. `atencion_hallazgo_uq` ya lleva `tenant_id` de líder, así que no hace
-- falta un índice suyo a secas — mismo motivo que en `incidencia`.
create index atencion_hallazgo_visita_idx
  on public.atencion_hallazgo (visita_id);

-- ---------------------------------------------------------------------------
-- La foto de la resolución es de SU visita
--
-- Misma verja que ya lleva `incidencia`: la FK compuesta solo valida
-- `(id, tenant_id)`, así que sin esto se podría enlazar como prueba cualquier
-- foto del mismo cliente. No es exposición —la lectura de `foto` ya está
-- acotada— es integridad de la evidencia.

create function app.foto_de_atencion_es_de_la_visita()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.foto_resolucion_id is null then return new; end if;
  if tg_op = 'UPDATE'
     and new.foto_resolucion_id is not distinct from old.foto_resolucion_id
     and new.visita_id is not distinct from old.visita_id then
    return new;
  end if;

  if not exists (
    select 1 from public.foto f
    where f.id = new.foto_resolucion_id and f.visita_id = new.visita_id
      and f.tenant_id = new.tenant_id
  ) then
    raise exception 'la foto de la atención % no pertenece a la visita %',
      new.foto_resolucion_id, new.visita_id using errcode = '23514';
  end if;
  return new;
end;
$$;

revoke execute on function app.foto_de_atencion_es_de_la_visita()
  from public, anon, authenticated, service_role;

create trigger foto_de_atencion_es_de_la_visita
  before insert or update of foto_resolucion_id, visita_id
  on public.atencion_hallazgo
  for each row execute function app.foto_de_atencion_es_de_la_visita();

-- ---------------------------------------------------------------------------
-- La reconciliación, en los DOS sentidos
--
-- La atención y la incidencia pueden llegar en cualquier orden: la fila del
-- levantamiento y la de la atención suben en la misma tanda de sincronización y
-- nada garantiza cuál se aplica primero. Cubrir un solo sentido dejaría la mitad
-- de los casos sin volcar, y sin ruido.

create function app.volcar_atencion(p_atencion public.atencion_hallazgo)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_n integer;
begin
  -- Solo sobre una incidencia PENDIENTE: si el motor ya la anuló, el hallazgo
  -- dejó de existir y volcar encima resucitaría algo que no está. Y si ya está
  -- atendida, la primera declaración manda.
  update public.incidencia i
  set estado = p_atencion.estado,
      accion_tomada = p_atencion.accion_tomada,
      motivo = p_atencion.motivo,
      foto_resolucion_id = p_atencion.foto_resolucion_id,
      atendida_at = coalesce(i.atendida_at, p_atencion.creado_at)
  where i.tenant_id = p_atencion.tenant_id
    and i.visita_id = p_atencion.visita_id
    and i.levantamiento_id is not distinct from p_atencion.levantamiento_id
    and i.sku_id is not distinct from p_atencion.sku_id
    and i.exhibicion_negociada_id is not distinct from p_atencion.exhibicion_negociada_id
    and i.origen = p_atencion.origen
    and i.estado = 'pendiente';

  get diagnostics v_n = row_count;
  return v_n > 0;
end;
$$;

revoke execute on function app.volcar_atencion(public.atencion_hallazgo)
  from public, anon, authenticated, service_role;

comment on function app.volcar_atencion(public.atencion_hallazgo) is
  'Vuelca una atención declarada sobre su incidencia, si existe y sigue pendiente. Único dueño de esa regla: la llaman los dos triggers de reconciliación.';

-- Sentido 1: llega la atención y la incidencia ya estaba.
create function app.atencion_busca_su_incidencia()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.aplicada_at is not null then return new; end if;
  if app.volcar_atencion(new) then
    new.aplicada_at := now();
  end if;
  return new;
end;
$$;

revoke execute on function app.atencion_busca_su_incidencia()
  from public, anon, authenticated, service_role;

create trigger atencion_busca_su_incidencia
  before insert or update on public.atencion_hallazgo
  for each row execute function app.atencion_busca_su_incidencia();

-- Sentido 2: nace la incidencia y la atención ya estaba esperando.
create function app.incidencia_busca_su_atencion()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_atencion public.atencion_hallazgo;
begin
  select * into v_atencion
  from public.atencion_hallazgo a
  where a.tenant_id = new.tenant_id
    and a.visita_id = new.visita_id
    and a.levantamiento_id is not distinct from new.levantamiento_id
    and a.sku_id is not distinct from new.sku_id
    and a.exhibicion_negociada_id is not distinct from new.exhibicion_negociada_id
    and a.origen = new.origen;

  if v_atencion.id is null then return null; end if;

  if app.volcar_atencion(v_atencion) then
    update public.atencion_hallazgo set aplicada_at = now()
    where id = v_atencion.id;
  end if;
  return null;
end;
$$;

revoke execute on function app.incidencia_busca_su_atencion()
  from public, anon, authenticated, service_role;

-- `after` y no `before`: el volcado es un UPDATE sobre la fila que este mismo
-- trigger está insertando, y eso necesita que ya exista.
create trigger incidencia_busca_su_atencion
  after insert on public.incidencia
  for each row execute function app.incidencia_busca_su_atencion();

-- ---------------------------------------------------------------------------
-- GRANT y RLS
--
-- El GRANT es la puerta; la RLS es el portero — y el grant cubre cada verbo que
-- la política permite, ni uno más.
--
-- Aquí SÍ hay INSERT para `authenticated`, y es la diferencia con `incidencia`:
-- esto no es un derivado, es lo que el mercaderista declara. `aplicada_at` queda
-- fuera del grant de columnas: lo escribe el servidor al volcar, y dejarlo
-- escribir al cliente permitiría marcar como aplicada una atención que nunca se
-- volcó — justo la señal de divergencia que esta tabla existe para conservar.

grant select on public.atencion_hallazgo to authenticated;
grant insert (tenant_id, visita_id, levantamiento_id, sku_id,
              exhibicion_negociada_id, origen, estado, accion_tomada, motivo,
              foto_resolucion_id)
  on public.atencion_hallazgo to authenticated;
grant update (estado, accion_tomada, motivo, foto_resolucion_id)
  on public.atencion_hallazgo to authenticated;
grant all on public.atencion_hallazgo to service_role;

alter table public.atencion_hallazgo enable row level security;

create policy atencion_staff_lee on public.atencion_hallazgo for select to authenticated
  using ((select app.es_staff()));

-- Mismo CASE por rol que las otras tablas de trabajo de campo, y sin rama ELSE a
-- propósito: un rol nuevo cae en NULL, y NULL en una política es denegar.
create policy atencion_usuario_lee_su_tenant on public.atencion_hallazgo for select to authenticated
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

-- El dueño de la visita declara lo que hizo en ella, y solo en ella. El
-- `with check` repite la condición: sin él, un PATCH podría mover la declaración
-- a la visita de un compañero.
create policy atencion_mercaderista_declara on public.atencion_hallazgo
  for insert to authenticated
  with check (
    tenant_id = (select app.tenant_actual())
    and (select app.rol_actual()) = 'mercaderista'
    and visita_id in (
      select v.id from public.visita v
      where v.mercaderista_id = (select auth.uid())
    )
  );

create policy atencion_mercaderista_corrige on public.atencion_hallazgo
  for update to authenticated
  using (
    visita_id in (
      select v.id from public.visita v
      where v.mercaderista_id = (select auth.uid())
    )
  )
  with check (
    visita_id in (
      select v.id from public.visita v
      where v.mercaderista_id = (select auth.uid())
    )
  );

comment on policy atencion_mercaderista_corrige on public.atencion_hallazgo is
  'Se admite corregir la declaración —el mercaderista puede cambiar de opinión antes de sincronizar, y sin UPDATE ese cambio moriría con un 42501 que el conector descarta en silencio—. El volcado se re-dispara, y la incidencia solo se toca si sigue pendiente.';
