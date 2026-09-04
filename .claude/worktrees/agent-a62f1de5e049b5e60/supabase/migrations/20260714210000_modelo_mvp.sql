-- El resto del modelo del MVP: maestro comercial, operación, levantamiento,
-- evidencia, alertas, auth e importación.
--
-- Extiende el patrón que fijó la migración del núcleo. Los tres mandamientos:
--
--   1. GRANT = la puerta. RLS = el portero. Toda tabla necesita las DOS: sin el
--      grant, la consulta muere con 42501 ANTES de que ninguna política corra.
--   2. En una política, las funciones SIEMPRE envueltas en (select ...). Sin el
--      select se evalúan una vez POR FILA: 42.480 ms contra 12,9 ms sobre 200k.
--   3. RLS en la MISMA migración que crea la tabla. La ventana entre "creé la
--      tabla" y "le puse RLS después" es por donde se filtran los datos.
--
-- Fuera de alcance a propósito: merma (⚪ sin fase), lote_vencimiento (🟡 Fase 2),
-- campania y actividad (ningún doc de alcance las conoce), comunicado,
-- capacitacion y jornada (🔵 Fase 3). Una tabla sin pantalla que la llene es
-- deuda, no adelanto.

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------
create type public.tipo_tienda as enum ('hiper', 'super', 'express');
create type public.estado_rutero as enum ('borrador', 'publicado', 'en_curso', 'completado');
create type public.estado_parada as enum ('pendiente', 'en_curso', 'completada');
create type public.estado_visita as enum ('en_curso', 'completada', 'bloqueada');
create type public.estado_levantamiento as enum ('pendiente', 'en_curso', 'completado', 'omitido');
create type public.tipo_exhibicion as enum ('cabecera', 'isla', 'ruma', 'pop', 'adicional');
create type public.paso_levantamiento as enum (
  'checkin', 'foto_antes', 'share_of_shelf', 'quiebres',
  'precios', 'exhibiciones', 'foto_despues', 'checkout'
);
create type public.tipo_foto as enum (
  'selfie', 'antes', 'despues', 'sos', 'exhibicion', 'precio', 'contingencia'
);
create type public.tipo_alerta as enum (
  'quiebre', 'diferencia_stock', 'desviacion_precio', 'promo_no_activa',
  'exhibicion_incompleta', 'contingencia'
);
create type public.severidad_alerta as enum ('info', 'alta', 'critica');
create type public.canal_alerta as enum ('dashboard', 'email', 'whatsapp');
create type public.estado_alerta as enum ('nueva', 'vista', 'resuelta');
create type public.estado_importacion as enum (
  'validando', 'con_errores', 'previsualizada', 'aplicada', 'cancelada'
);
create type public.canal_otp as enum ('correo', 'sms', 'whatsapp');

-- ---------------------------------------------------------------------------
-- La FK compuesta que sostiene el `tenant_id` denormalizado.
--
-- Toda tabla de negocio lleva `tenant_id` porque lo necesitan su política RLS y
-- las sync rules de PowerSync (que solo admiten un subconjunto de SQL, sin joins
-- complejos). Pero un `tenant_id` copiado puede DESVIARSE del de su padre, y
-- entonces el aislamiento miente.
--
-- Un trigger lo evitaría, pero un trigger es un procedimiento que alguien puede
-- olvidar. Una FK compuesta lo hace IMPOSIBLE: la base rechaza la fila.
-- ---------------------------------------------------------------------------
alter table public.marca add constraint marca_id_tenant_uq unique (id, tenant_id);

-- ---------------------------------------------------------------------------
-- Auth: 2FA y pase de acceso temporal
-- ---------------------------------------------------------------------------
create table public.configuracion_plataforma (
  id                      boolean primary key default true check (id),
  otp_requerido           boolean not null default true,
  otp_canales_habilitados public.canal_otp[] not null default '{correo}',
  actualizado_at          timestamptz not null default now()
);

comment on table public.configuracion_plataforma is
  'Fila única. Sin tenant_id: el 2FA es política de LA OUTSOURCING, no de sus clientes — el staff no pertenece a ninguno.';

insert into public.configuracion_plataforma (id) values (true);

create table public.pase_acceso_temporal (
  id            uuid primary key default gen_random_uuid(),
  profile_id    uuid not null references public.profile (id) on delete cascade,
  -- HASH, nunca el código en claro: quien puede emitir un pase puede entrar como
  -- ese mercaderista, así que ni siquiera nosotros guardamos el secreto.
  codigo_hash   text not null,
  motivo        text not null,
  generado_por  uuid not null references public.profile (id) on delete restrict,
  generado_at   timestamptz not null default now(),
  expira_at     timestamptz not null default now() + interval '15 minutes',
  usado_at      timestamptz,
  revocado_at   timestamptz
);

create index pase_profile_id_idx on public.pase_acceso_temporal (profile_id);

-- ---------------------------------------------------------------------------
-- Maestro comercial (llega como Excel del cliente)
-- ---------------------------------------------------------------------------
create table public.cadena (
  id             uuid primary key default gen_random_uuid(),
  tenant_id      uuid not null references public.tenant (id) on delete restrict,
  nombre         text not null,
  tipo_tienda    public.tipo_tienda,
  codigo_externo text,
  activo         boolean not null default true,
  creado_at      timestamptz not null default now(),
  unique (tenant_id, codigo_externo),
  -- Para la FK compuesta de `tienda`.
  constraint cadena_id_tenant_uq unique (id, tenant_id)
);

create index cadena_tenant_id_idx on public.cadena (tenant_id);

create table public.tienda (
  id               uuid primary key default gen_random_uuid(),
  tenant_id        uuid not null references public.tenant (id) on delete restrict,
  cadena_id        uuid not null,
  nombre           text not null,
  direccion        text,
  ubicacion        extensions.geography(Point, 4326),
  -- Default 100 m (revisión con el cliente, jul 2026). Editable por tienda: en un
  -- centro comercial denso, 100 m pueden abarcar la tienda de al lado.
  radio_geocerca_m integer not null default 100 check (radio_geocerca_m > 0),
  cluster          text,
  codigo_externo   text,
  activo           boolean not null default true,
  creado_at        timestamptz not null default now(),
  unique (tenant_id, codigo_externo),
  constraint tienda_cadena_fk foreign key (cadena_id, tenant_id)
    references public.cadena (id, tenant_id) on delete restrict,
  constraint tienda_id_tenant_uq unique (id, tenant_id)
);

create index tienda_tenant_id_idx on public.tienda (tenant_id);
create index tienda_cadena_id_idx on public.tienda (cadena_id);
-- Índice geoespacial: la validación de geocerca lo va a usar en cada check-in.
create index tienda_ubicacion_idx on public.tienda using gist (ubicacion);

create table public.sku (
  id             uuid primary key default gen_random_uuid(),
  tenant_id      uuid not null references public.tenant (id) on delete restrict,
  -- El SKU cuelga de la MARCA (Oster, Sharpie), no del cliente.
  marca_id       uuid not null,
  codigo         text not null,
  nombre         text not null,
  presentacion   text,
  codigo_barras  text,
  codigo_externo text,
  activo         boolean not null default true,
  creado_at      timestamptz not null default now(),
  unique (tenant_id, codigo_externo),
  constraint sku_marca_fk foreign key (marca_id, tenant_id)
    references public.marca (id, tenant_id) on delete restrict,
  constraint sku_id_tenant_uq unique (id, tenant_id)
);

create index sku_tenant_id_idx on public.sku (tenant_id);
create index sku_marca_id_idx on public.sku (marca_id);

-- La "lista exacta" de SKUs por tienda. De aquí sale también QUÉ MARCAS se
-- auditan en cada tienda: las marcas distintas de sus SKUs codificados. Una
-- `tienda_marca` sería un segundo dueño del mismo hecho, y divergiría.
create table public.tienda_sku (
  tienda_id uuid not null,
  sku_id    uuid not null,
  tenant_id uuid not null references public.tenant (id) on delete restrict,
  activo    boolean not null default true,
  primary key (tienda_id, sku_id),
  constraint tienda_sku_tienda_fk foreign key (tienda_id, tenant_id)
    references public.tienda (id, tenant_id) on delete cascade,
  constraint tienda_sku_sku_fk foreign key (sku_id, tenant_id)
    references public.sku (id, tenant_id) on delete cascade
);

create index tienda_sku_tenant_id_idx on public.tienda_sku (tenant_id);
create index tienda_sku_sku_id_idx on public.tienda_sku (sku_id);

create table public.precio_regular (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references public.tenant (id) on delete restrict,
  sku_id        uuid not null,
  cadena_id     uuid not null,
  tipo_tienda   public.tipo_tienda,
  precio        numeric(10, 2) not null check (precio >= 0),
  vigente_desde date not null default current_date,
  creado_at     timestamptz not null default now(),
  constraint precio_sku_fk foreign key (sku_id, tenant_id)
    references public.sku (id, tenant_id) on delete cascade,
  constraint precio_cadena_fk foreign key (cadena_id, tenant_id)
    references public.cadena (id, tenant_id) on delete cascade
);

create index precio_regular_tenant_id_idx on public.precio_regular (tenant_id);
create index precio_regular_sku_id_idx on public.precio_regular (sku_id);

create table public.promocion (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references public.tenant (id) on delete restrict,
  sku_id       uuid not null,
  precio_promo numeric(10, 2) not null check (precio_promo >= 0),
  fecha_inicio date not null,
  fecha_fin    date not null,
  clusters     text[] not null default '{}',
  -- ¿La promo está COMUNICADA en tienda (cartel, encarte)? Es la pregunta que
  -- bifurca el árbol de decisión de precios.
  comunicada   boolean not null default false,
  creado_at    timestamptz not null default now(),
  check (fecha_fin >= fecha_inicio),
  constraint promocion_sku_fk foreign key (sku_id, tenant_id)
    references public.sku (id, tenant_id) on delete cascade
);

create index promocion_tenant_id_idx on public.promocion (tenant_id);
create index promocion_sku_id_idx on public.promocion (sku_id);

create table public.exhibicion_negociada (
  id                uuid primary key default gen_random_uuid(),
  tenant_id         uuid not null references public.tenant (id) on delete restrict,
  tienda_id         uuid not null,
  -- La negocia UNA MARCA, no el cliente entero.
  marca_id          uuid not null,
  tipo              public.tipo_exhibicion not null,
  sku_ids           uuid[] not null default '{}',
  cantidad_sugerida integer check (cantidad_sugerida >= 0),
  fecha_inicio      date not null,
  fecha_fin         date not null,
  creado_at         timestamptz not null default now(),
  check (fecha_fin >= fecha_inicio),
  constraint exh_neg_tienda_fk foreign key (tienda_id, tenant_id)
    references public.tienda (id, tenant_id) on delete cascade,
  constraint exh_neg_marca_fk foreign key (marca_id, tenant_id)
    references public.marca (id, tenant_id) on delete cascade,
  constraint exh_neg_id_tenant_uq unique (id, tenant_id)
);

create index exh_neg_tenant_id_idx on public.exhibicion_negociada (tenant_id);
create index exh_neg_tienda_id_idx on public.exhibicion_negociada (tienda_id);

-- ---------------------------------------------------------------------------
-- Operación: ruteros y visitas
-- ---------------------------------------------------------------------------
create table public.rutero (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid not null references public.tenant (id) on delete restrict,
  mercaderista_id uuid not null references public.profile (id) on delete restrict,
  fecha           date not null,
  estado          public.estado_rutero not null default 'borrador',
  creado_at       timestamptz not null default now(),
  unique (mercaderista_id, fecha),
  constraint rutero_id_tenant_uq unique (id, tenant_id)
);

create index rutero_tenant_id_idx on public.rutero (tenant_id);
create index rutero_mercaderista_idx on public.rutero (mercaderista_id, fecha);

create table public.rutero_parada (
  id        uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenant (id) on delete restrict,
  rutero_id uuid not null,
  tienda_id uuid not null,
  orden     integer not null check (orden > 0),
  estado    public.estado_parada not null default 'pendiente',
  unique (rutero_id, orden),
  constraint parada_rutero_fk foreign key (rutero_id, tenant_id)
    references public.rutero (id, tenant_id) on delete cascade,
  constraint parada_tienda_fk foreign key (tienda_id, tenant_id)
    references public.tienda (id, tenant_id) on delete restrict,
  constraint parada_id_tenant_uq unique (id, tenant_id)
);

create index parada_tenant_id_idx on public.rutero_parada (tenant_id);
create index parada_rutero_id_idx on public.rutero_parada (rutero_id);

create table public.visita (
  id                  uuid primary key default gen_random_uuid(),
  tenant_id           uuid not null references public.tenant (id) on delete restrict,
  rutero_parada_id    uuid not null,
  mercaderista_id     uuid not null references public.profile (id) on delete restrict,
  tienda_id           uuid not null,
  -- Hora de SERVIDOR. La del teléfono es una sugerencia: se puede cambiar a mano.
  check_in_at         timestamptz not null default now(),
  check_in_geo        extensions.geography(Point, 4326),
  -- `selfie_foto_id` se añade abajo con un ALTER: `foto` todavía no existe y la
  -- referencia es circular (foto → visita → foto).
  check_out_at        timestamptz,
  check_out_geo       extensions.geography(Point, 4326),
  estado              public.estado_visita not null default 'en_curso',
  bitacora            text,
  tiempo_traslado_min integer check (tiempo_traslado_min >= 0),
  bateria_inicio_pct  integer check (bateria_inicio_pct between 0 and 100),
  creado_at           timestamptz not null default now(),
  constraint visita_parada_fk foreign key (rutero_parada_id, tenant_id)
    references public.rutero_parada (id, tenant_id) on delete restrict,
  constraint visita_tienda_fk foreign key (tienda_id, tenant_id)
    references public.tienda (id, tenant_id) on delete restrict,
  constraint visita_id_tenant_uq unique (id, tenant_id)
);

create index visita_tenant_id_idx on public.visita (tenant_id);
create index visita_mercaderista_idx on public.visita (mercaderista_id);
create index visita_tienda_idx on public.visita (tienda_id);
-- El dashboard del cliente filtra por tenant y fecha: es su consulta caliente.
create index visita_tenant_fecha_idx on public.visita (tenant_id, check_in_at desc);

-- ---------------------------------------------------------------------------
-- Levantamiento: UNA VISITA = UN LEVANTAMIENTO POR MARCA
--
-- Oster está en electrodomésticos y Sharpie en papelería: no comparten góndola.
-- Cada marca tiene su foto "Antes", su Share of Shelf y su foto "Después".
-- ---------------------------------------------------------------------------
create table public.levantamiento (
  id                      uuid primary key default gen_random_uuid(),
  tenant_id               uuid not null references public.tenant (id) on delete restrict,
  visita_id               uuid not null,
  marca_id                uuid not null,
  sos_frentes_propios     integer check (sos_frentes_propios >= 0),
  -- `competidor` es texto libre (Frutísima, Selva Viva): NO es la entidad `marca`,
  -- que solo modela las marcas de nuestros clientes.
  sos_frentes_competencia jsonb not null default '[]',
  estado                  public.estado_levantamiento not null default 'pendiente',
  creado_at               timestamptz not null default now(),
  -- Una marca no puede auditarse dos veces en la misma visita.
  unique (visita_id, marca_id),
  constraint lev_visita_fk foreign key (visita_id, tenant_id)
    references public.visita (id, tenant_id) on delete cascade,
  constraint lev_marca_fk foreign key (marca_id, tenant_id)
    references public.marca (id, tenant_id) on delete restrict,
  constraint lev_id_tenant_uq unique (id, tenant_id)
);

create index lev_tenant_id_idx on public.levantamiento (tenant_id);
create index lev_visita_id_idx on public.levantamiento (visita_id);

create table public.levantamiento_sku (
  id                  uuid primary key default gen_random_uuid(),
  tenant_id           uuid not null references public.tenant (id) on delete restrict,
  levantamiento_id    uuid not null,
  sku_id              uuid not null,
  frentes_propios     integer check (frentes_propios >= 0),
  frentes_competencia jsonb not null default '[]',
  stock_sistema       integer check (stock_sistema >= 0),
  stock_piso          integer check (stock_piso >= 0),

  -- DERIVADOS, con un solo calculador: la base. Nunca en el código de las apps.
  -- Son excluyentes por construcción: el quiebre exige piso = 0 y la diferencia
  -- exige piso > 0, así que un SKU jamás lleva los dos.
  quiebre    boolean generated always as (stock_piso = 0 and stock_sistema > 0) stored,
  diferencia boolean generated always as (stock_piso > 0 and stock_piso <> stock_sistema) stored,

  precio_registrado numeric(10, 2) check (precio_registrado >= 0),
  hay_promo         boolean,
  promo_comunicada  boolean,
  creado_at         timestamptz not null default now(),
  unique (levantamiento_id, sku_id),
  constraint lev_sku_lev_fk foreign key (levantamiento_id, tenant_id)
    references public.levantamiento (id, tenant_id) on delete cascade,
  constraint lev_sku_sku_fk foreign key (sku_id, tenant_id)
    references public.sku (id, tenant_id) on delete restrict
);

create index lev_sku_tenant_id_idx on public.levantamiento_sku (tenant_id);
create index lev_sku_lev_id_idx on public.levantamiento_sku (levantamiento_id);
-- El dashboard busca quiebres: índice parcial, solo sobre las filas que lo son.
create index lev_sku_quiebre_idx on public.levantamiento_sku (tenant_id) where quiebre;

create table public.exhibicion (
  id                     uuid primary key default gen_random_uuid(),
  tenant_id              uuid not null references public.tenant (id) on delete restrict,
  levantamiento_id       uuid not null,
  -- Null si es una exhibición ADICIONAL (conseguida por el mercaderista, no
  -- negociada). El check de abajo obliga a que una de las dos esté.
  exhibicion_negociada_id uuid,
  tipo_adicional         public.tipo_exhibicion,
  instalada              boolean,
  unidades               integer check (unidades >= 0),
  completa               boolean,
  vigente                boolean,
  creado_at              timestamptz not null default now(),
  check (
    (exhibicion_negociada_id is not null and tipo_adicional is null)
    or (exhibicion_negociada_id is null and tipo_adicional is not null)
  ),
  constraint exh_lev_fk foreign key (levantamiento_id, tenant_id)
    references public.levantamiento (id, tenant_id) on delete cascade,
  constraint exh_neg_ref_fk foreign key (exhibicion_negociada_id, tenant_id)
    references public.exhibicion_negociada (id, tenant_id) on delete restrict
);

create index exh_tenant_id_idx on public.exhibicion (tenant_id);
create index exh_lev_id_idx on public.exhibicion (levantamiento_id);

-- El bypass. Compromiso de la propuesta aceptada: el levantamiento es secuencial
-- pero NO un bloqueo absoluto — el mercaderista registra el hallazgo y continúa.
create table public.contingencia (
  id               uuid primary key default gen_random_uuid(),
  tenant_id        uuid not null references public.tenant (id) on delete restrict,
  visita_id        uuid not null,
  -- Null si el paso omitido es de la VISITA (checkin/checkout); poblado si es de
  -- una marca concreta.
  levantamiento_id uuid,
  paso             public.paso_levantamiento not null,
  motivo           text not null,
  comentario       text,
  -- Hora LOCAL de captura: la contingencia se registra offline y sincroniza después.
  registrada_at    timestamptz not null,
  creado_at        timestamptz not null default now(),
  constraint cont_visita_fk foreign key (visita_id, tenant_id)
    references public.visita (id, tenant_id) on delete cascade,
  constraint cont_lev_fk foreign key (levantamiento_id, tenant_id)
    references public.levantamiento (id, tenant_id) on delete cascade
);

create index cont_tenant_id_idx on public.contingencia (tenant_id);
create index cont_visita_id_idx on public.contingencia (visita_id);

-- ---------------------------------------------------------------------------
-- Evidencia y alertas
-- ---------------------------------------------------------------------------
create table public.foto (
  id               uuid primary key default gen_random_uuid(),
  tenant_id        uuid not null references public.tenant (id) on delete restrict,
  visita_id        uuid not null,
  -- Null en la selfie de check-in y en las contingencias de visita: esas no
  -- pertenecen a ninguna marca.
  levantamiento_id uuid,
  tipo             public.tipo_foto not null,
  url_r2           text,
  -- El hash se calcula AL CAPTURAR, igual que el watermark. Una foto marcada al
  -- subir no prueba nada: la subida puede ocurrir horas después.
  hash             text,
  capturada_at     timestamptz not null,
  geo              extensions.geography(Point, 4326),
  subida_at        timestamptz,
  creado_at        timestamptz not null default now(),
  constraint foto_visita_fk foreign key (visita_id, tenant_id)
    references public.visita (id, tenant_id) on delete cascade,
  constraint foto_lev_fk foreign key (levantamiento_id, tenant_id)
    references public.levantamiento (id, tenant_id) on delete cascade,
  constraint foto_id_tenant_uq unique (id, tenant_id)
);

create index foto_tenant_id_idx on public.foto (tenant_id);
create index foto_visita_id_idx on public.foto (visita_id);
-- La galería del portal filtra por tipo.
create index foto_tenant_tipo_idx on public.foto (tenant_id, tipo);

-- Las FKs circulares (visita → foto, levantamiento → foto) se añaden ahora que
-- `foto` existe.
alter table public.visita
  add column selfie_foto_id uuid,
  add constraint visita_selfie_fk foreign key (selfie_foto_id, tenant_id)
    references public.foto (id, tenant_id) on delete set null;

alter table public.levantamiento
  add column foto_antes_id uuid,
  add column foto_despues_id uuid,
  add column sos_foto_id uuid,
  add constraint lev_foto_antes_fk foreign key (foto_antes_id, tenant_id)
    references public.foto (id, tenant_id) on delete set null,
  add constraint lev_foto_despues_fk foreign key (foto_despues_id, tenant_id)
    references public.foto (id, tenant_id) on delete set null,
  add constraint lev_sos_foto_fk foreign key (sos_foto_id, tenant_id)
    references public.foto (id, tenant_id) on delete set null;

alter table public.levantamiento_sku
  add column sos_foto_id uuid,
  add constraint lev_sku_foto_fk foreign key (sos_foto_id, tenant_id)
    references public.foto (id, tenant_id) on delete set null;

alter table public.exhibicion
  add column foto_id uuid,
  add constraint exh_foto_fk foreign key (foto_id, tenant_id)
    references public.foto (id, tenant_id) on delete set null;

alter table public.contingencia
  add column foto_id uuid,
  add constraint cont_foto_fk foreign key (foto_id, tenant_id)
    references public.foto (id, tenant_id) on delete set null;

create table public.alerta (
  id         uuid primary key default gen_random_uuid(),
  tenant_id  uuid not null references public.tenant (id) on delete restrict,
  -- De qué MARCA es la alerta: el portal del cliente filtra por ella.
  marca_id   uuid,
  visita_id  uuid,
  tipo       public.tipo_alerta not null,
  severidad  public.severidad_alerta not null default 'info',
  canal      public.canal_alerta not null default 'dashboard',
  estado     public.estado_alerta not null default 'nueva',
  payload    jsonb not null default '{}',
  creado_at  timestamptz not null default now(),
  constraint alerta_marca_fk foreign key (marca_id, tenant_id)
    references public.marca (id, tenant_id) on delete cascade,
  constraint alerta_visita_fk foreign key (visita_id, tenant_id)
    references public.visita (id, tenant_id) on delete cascade
);

create index alerta_tenant_id_idx on public.alerta (tenant_id);
-- El feed del portal: alertas nuevas primero.
create index alerta_tenant_estado_idx on public.alerta (tenant_id, estado, creado_at desc);

-- ---------------------------------------------------------------------------
-- Importación del Excel del cliente
-- ---------------------------------------------------------------------------
create table public.importacion (
  id             uuid primary key default gen_random_uuid(),
  tenant_id      uuid not null references public.tenant (id) on delete restrict,
  -- El .xlsx original se CONSERVA: cuando el cliente diga "yo te mandé bien esos
  -- precios", está el archivo con su hash.
  archivo_url_r2 text,
  archivo_hash   text,
  subido_por     uuid not null references public.profile (id) on delete restrict,
  estado         public.estado_importacion not null default 'validando',
  resumen        jsonb not null default '{}',
  -- El informe fila por fila: [{hoja, fila, columna, valor, mensaje}]
  errores        jsonb not null default '[]',
  aplicada_at    timestamptz,
  creado_at      timestamptz not null default now()
);

create index importacion_tenant_id_idx on public.importacion (tenant_id);

create table public.mapeo_importacion (
  id         uuid primary key default gen_random_uuid(),
  tenant_id  uuid not null references public.tenant (id) on delete restrict,
  nombre     text not null,
  -- hoja → entidad, columna → campo. Guardado para no repetir el mapeo en cada carga.
  mapeo      jsonb not null,
  creado_por uuid not null references public.profile (id) on delete restrict,
  creado_at  timestamptz not null default now()
);

create index mapeo_tenant_id_idx on public.mapeo_importacion (tenant_id);

-- ---------------------------------------------------------------------------
-- GRANTs. Sin esto, las políticas de abajo NUNCA se evalúan.
--
-- Sin DELETE en ninguna: nada se borra en duro. Las bajas son lógicas (`activo`),
-- porque borrar una tienda o un SKU se llevaría por delante el histórico de
-- visitas que sostiene la evidencia ante SUNAFIL.
--
-- A `anon`: nada. Falla cerrado con 42501, que es lo que queremos.
-- ---------------------------------------------------------------------------
grant select on
  public.configuracion_plataforma, public.cadena, public.tienda, public.sku,
  public.tienda_sku, public.precio_regular, public.promocion,
  public.exhibicion_negociada, public.rutero, public.rutero_parada,
  public.importacion, public.mapeo_importacion, public.alerta
  to authenticated;

-- El mercaderista ESCRIBE lo que levanta en campo (sube por PostgREST y pasa por
-- RLS). El admin escribe el maestro.
grant select, insert, update on
  public.visita, public.levantamiento, public.levantamiento_sku,
  public.exhibicion, public.contingencia, public.foto
  to authenticated;

grant insert, update on
  public.cadena, public.tienda, public.sku, public.tienda_sku,
  public.precio_regular, public.promocion, public.exhibicion_negociada,
  public.rutero, public.rutero_parada, public.importacion,
  public.mapeo_importacion, public.configuracion_plataforma
  to authenticated;

-- Las alertas las escribe el motor (Edge Functions con service_role); el usuario
-- solo cambia su `estado` (nueva → vista → resuelta).
grant update on public.alerta to authenticated;

-- El pase de acceso temporal: nadie lee `codigo_hash` — ni siquiera el admin.
grant insert, update on public.pase_acceso_temporal to authenticated;
grant select (id, profile_id, motivo, generado_por, generado_at, expira_at, usado_at, revocado_at)
  on public.pase_acceso_temporal to authenticated;

grant all on
  public.configuracion_plataforma, public.pase_acceso_temporal, public.cadena,
  public.tienda, public.sku, public.tienda_sku, public.precio_regular,
  public.promocion, public.exhibicion_negociada, public.rutero,
  public.rutero_parada, public.visita, public.levantamiento,
  public.levantamiento_sku, public.exhibicion, public.contingencia,
  public.foto, public.alerta, public.importacion, public.mapeo_importacion
  to service_role;

-- ---------------------------------------------------------------------------
-- RLS — en la misma migración que crea cada tabla.
-- ---------------------------------------------------------------------------
alter table public.configuracion_plataforma enable row level security;
alter table public.pase_acceso_temporal enable row level security;
alter table public.cadena enable row level security;
alter table public.tienda enable row level security;
alter table public.sku enable row level security;
alter table public.tienda_sku enable row level security;
alter table public.precio_regular enable row level security;
alter table public.promocion enable row level security;
alter table public.exhibicion_negociada enable row level security;
alter table public.rutero enable row level security;
alter table public.rutero_parada enable row level security;
alter table public.visita enable row level security;
alter table public.levantamiento enable row level security;
alter table public.levantamiento_sku enable row level security;
alter table public.exhibicion enable row level security;
alter table public.contingencia enable row level security;
alter table public.foto enable row level security;
alter table public.alerta enable row level security;
alter table public.importacion enable row level security;
alter table public.mapeo_importacion enable row level security;

-- --- configuracion_plataforma: la lee cualquiera autenticado (la app necesita
-- saber qué canales de OTP hay); solo el admin la escribe.
create policy config_lee_todo on public.configuracion_plataforma
  for select to authenticated using (true);
create policy config_admin_escribe on public.configuracion_plataforma
  for all to authenticated
  using ((select app.rol_actual()) = 'admin')
  with check ((select app.rol_actual()) = 'admin');

-- --- pase_acceso_temporal: quien puede emitir un pase puede entrar como ese
-- mercaderista. Es el camino más sensible del sistema de auth.
create policy pase_staff_lee on public.pase_acceso_temporal
  for select to authenticated using ((select app.es_staff()));
create policy pase_admin_emite on public.pase_acceso_temporal
  for all to authenticated
  using ((select app.rol_actual()) = 'admin')
  with check ((select app.rol_actual()) = 'admin');
-- El supervisor SOLO para los mercaderistas que le reportan.
create policy pase_supervisor_emite_a_los_suyos on public.pase_acceso_temporal
  for insert to authenticated
  with check (
    (select app.rol_actual()) = 'supervisor'
    and exists (
      select 1 from public.profile p
      where p.id = profile_id and p.supervisor_id = (select auth.uid())
    )
  );

-- --- Maestro comercial: el staff ve todo; el usuario de cliente, lo suyo; solo
-- el admin escribe (el maestro entra por la importación, no lo teclea el campo).
create policy cadena_staff_lee on public.cadena for select to authenticated
  using ((select app.es_staff()));
create policy cadena_usuario_lee_su_tenant on public.cadena for select to authenticated
  using (tenant_id = (select app.tenant_actual()));
create policy cadena_admin_escribe on public.cadena for all to authenticated
  using ((select app.rol_actual()) = 'admin')
  with check ((select app.rol_actual()) = 'admin');

create policy tienda_staff_lee on public.tienda for select to authenticated
  using ((select app.es_staff()));
create policy tienda_usuario_lee_su_tenant on public.tienda for select to authenticated
  using (tenant_id = (select app.tenant_actual()));
create policy tienda_admin_escribe on public.tienda for all to authenticated
  using ((select app.rol_actual()) = 'admin')
  with check ((select app.rol_actual()) = 'admin');

create policy sku_staff_lee on public.sku for select to authenticated
  using ((select app.es_staff()));
create policy sku_usuario_lee_su_tenant on public.sku for select to authenticated
  using (tenant_id = (select app.tenant_actual()));
create policy sku_admin_escribe on public.sku for all to authenticated
  using ((select app.rol_actual()) = 'admin')
  with check ((select app.rol_actual()) = 'admin');

create policy tsku_staff_lee on public.tienda_sku for select to authenticated
  using ((select app.es_staff()));
create policy tsku_usuario_lee_su_tenant on public.tienda_sku for select to authenticated
  using (tenant_id = (select app.tenant_actual()));
create policy tsku_admin_escribe on public.tienda_sku for all to authenticated
  using ((select app.rol_actual()) = 'admin')
  with check ((select app.rol_actual()) = 'admin');

create policy precio_staff_lee on public.precio_regular for select to authenticated
  using ((select app.es_staff()));
create policy precio_usuario_lee_su_tenant on public.precio_regular for select to authenticated
  using (tenant_id = (select app.tenant_actual()));
create policy precio_admin_escribe on public.precio_regular for all to authenticated
  using ((select app.rol_actual()) = 'admin')
  with check ((select app.rol_actual()) = 'admin');

create policy promo_staff_lee on public.promocion for select to authenticated
  using ((select app.es_staff()));
create policy promo_usuario_lee_su_tenant on public.promocion for select to authenticated
  using (tenant_id = (select app.tenant_actual()));
create policy promo_admin_escribe on public.promocion for all to authenticated
  using ((select app.rol_actual()) = 'admin')
  with check ((select app.rol_actual()) = 'admin');

create policy exhneg_staff_lee on public.exhibicion_negociada for select to authenticated
  using ((select app.es_staff()));
create policy exhneg_usuario_lee_su_tenant on public.exhibicion_negociada for select to authenticated
  using (tenant_id = (select app.tenant_actual()));
create policy exhneg_admin_escribe on public.exhibicion_negociada for all to authenticated
  using ((select app.rol_actual()) = 'admin')
  with check ((select app.rol_actual()) = 'admin');

-- --- Ruteros: los diseña el supervisor. El mercaderista lee el suyo.
create policy rutero_staff_lee on public.rutero for select to authenticated
  using ((select app.es_staff()));
create policy rutero_mercaderista_lee_el_suyo on public.rutero for select to authenticated
  using (mercaderista_id = (select auth.uid()));
create policy rutero_cliente_lee_su_tenant on public.rutero for select to authenticated
  using (tenant_id = (select app.tenant_actual()) and (select app.rol_actual()) = 'cliente');
create policy rutero_staff_escribe on public.rutero for all to authenticated
  using ((select app.es_staff())) with check ((select app.es_staff()));

create policy parada_staff_lee on public.rutero_parada for select to authenticated
  using ((select app.es_staff()));
create policy parada_usuario_lee_su_tenant on public.rutero_parada for select to authenticated
  using (tenant_id = (select app.tenant_actual()));
create policy parada_staff_escribe on public.rutero_parada for all to authenticated
  using ((select app.es_staff())) with check ((select app.es_staff()));

-- --- Visita y todo lo que cuelga: el MERCADERISTA escribe lo suyo.
create policy visita_staff_lee on public.visita for select to authenticated
  using ((select app.es_staff()));
create policy visita_usuario_lee_su_tenant on public.visita for select to authenticated
  using (tenant_id = (select app.tenant_actual()));
-- ⚠️ Las políticas de escritura del mercaderista van en INSERT y UPDATE por
-- separado, NUNCA en `for all`.
--
-- Con `for all`, el `USING` se aplica también a los SELECT — y el `USING` de
-- estas lleva un EXISTS con joins contra `visita` y `levantamiento`. Verificado
-- en el plan: metía un `SubPlan` con Nested Loop en CADA LECTURA de la tabla,
-- sin ganar nada: el mercaderista ya puede leer por la política de su tenant.
create policy visita_mercaderista_inserta_las_suyas on public.visita for insert to authenticated
  with check (mercaderista_id = (select auth.uid()));
create policy visita_mercaderista_actualiza_las_suyas on public.visita for update to authenticated
  using (mercaderista_id = (select auth.uid()))
  with check (mercaderista_id = (select auth.uid()));
create policy visita_staff_escribe on public.visita for all to authenticated
  using ((select app.es_staff())) with check ((select app.es_staff()));

create policy lev_staff_lee on public.levantamiento for select to authenticated
  using ((select app.es_staff()));
create policy lev_usuario_lee_su_tenant on public.levantamiento for select to authenticated
  using (tenant_id = (select app.tenant_actual()));
create policy lev_mercaderista_inserta on public.levantamiento for insert to authenticated
  with check (exists (select 1 from public.visita v where v.id = visita_id and v.mercaderista_id = (select auth.uid())));
create policy lev_mercaderista_actualiza on public.levantamiento for update to authenticated
  using (exists (select 1 from public.visita v where v.id = visita_id and v.mercaderista_id = (select auth.uid())))
  with check (exists (select 1 from public.visita v where v.id = visita_id and v.mercaderista_id = (select auth.uid())));

create policy levsku_staff_lee on public.levantamiento_sku for select to authenticated
  using ((select app.es_staff()));
create policy levsku_usuario_lee_su_tenant on public.levantamiento_sku for select to authenticated
  using (tenant_id = (select app.tenant_actual()));
create policy levsku_mercaderista_inserta on public.levantamiento_sku for insert to authenticated
  with check (exists (
    select 1 from public.levantamiento l join public.visita v on v.id = l.visita_id
    where l.id = levantamiento_id and v.mercaderista_id = (select auth.uid())
  ));
create policy levsku_mercaderista_actualiza on public.levantamiento_sku for update to authenticated
  using (exists (
    select 1 from public.levantamiento l join public.visita v on v.id = l.visita_id
    where l.id = levantamiento_id and v.mercaderista_id = (select auth.uid())
  ))
  with check (exists (
    select 1 from public.levantamiento l join public.visita v on v.id = l.visita_id
    where l.id = levantamiento_id and v.mercaderista_id = (select auth.uid())
  ));

create policy exh_staff_lee on public.exhibicion for select to authenticated
  using ((select app.es_staff()));
create policy exh_usuario_lee_su_tenant on public.exhibicion for select to authenticated
  using (tenant_id = (select app.tenant_actual()));
create policy exh_mercaderista_inserta on public.exhibicion for insert to authenticated
  with check (exists (
    select 1 from public.levantamiento l join public.visita v on v.id = l.visita_id
    where l.id = levantamiento_id and v.mercaderista_id = (select auth.uid())
  ));
create policy exh_mercaderista_actualiza on public.exhibicion for update to authenticated
  using (exists (
    select 1 from public.levantamiento l join public.visita v on v.id = l.visita_id
    where l.id = levantamiento_id and v.mercaderista_id = (select auth.uid())
  ))
  with check (exists (
    select 1 from public.levantamiento l join public.visita v on v.id = l.visita_id
    where l.id = levantamiento_id and v.mercaderista_id = (select auth.uid())
  ));

create policy cont_staff_lee on public.contingencia for select to authenticated
  using ((select app.es_staff()));
create policy cont_usuario_lee_su_tenant on public.contingencia for select to authenticated
  using (tenant_id = (select app.tenant_actual()));
create policy cont_mercaderista_inserta on public.contingencia for insert to authenticated
  with check (exists (select 1 from public.visita v where v.id = visita_id and v.mercaderista_id = (select auth.uid())));
create policy cont_mercaderista_actualiza on public.contingencia for update to authenticated
  using (exists (select 1 from public.visita v where v.id = visita_id and v.mercaderista_id = (select auth.uid())))
  with check (exists (select 1 from public.visita v where v.id = visita_id and v.mercaderista_id = (select auth.uid())));

create policy foto_staff_lee on public.foto for select to authenticated
  using ((select app.es_staff()));
create policy foto_usuario_lee_su_tenant on public.foto for select to authenticated
  using (tenant_id = (select app.tenant_actual()));
create policy foto_mercaderista_inserta on public.foto for insert to authenticated
  with check (exists (select 1 from public.visita v where v.id = visita_id and v.mercaderista_id = (select auth.uid())));
create policy foto_mercaderista_actualiza on public.foto for update to authenticated
  using (exists (select 1 from public.visita v where v.id = visita_id and v.mercaderista_id = (select auth.uid())))
  with check (exists (select 1 from public.visita v where v.id = visita_id and v.mercaderista_id = (select auth.uid())));

-- --- Alertas: las CREA el motor (service_role, que salta RLS). El usuario solo
-- las lee y les cambia el estado.
create policy alerta_staff_lee on public.alerta for select to authenticated
  using ((select app.es_staff()));
create policy alerta_usuario_lee_su_tenant on public.alerta for select to authenticated
  using (tenant_id = (select app.tenant_actual()));
create policy alerta_usuario_marca_estado on public.alerta for update to authenticated
  using (tenant_id = (select app.tenant_actual()) or (select app.es_staff()))
  with check (tenant_id = (select app.tenant_actual()) or (select app.es_staff()));

-- --- Importación: cosa de admin.
create policy imp_staff_lee on public.importacion for select to authenticated
  using ((select app.es_staff()));
create policy imp_admin_escribe on public.importacion for all to authenticated
  using ((select app.rol_actual()) = 'admin')
  with check ((select app.rol_actual()) = 'admin');

create policy mapeo_staff_lee on public.mapeo_importacion for select to authenticated
  using ((select app.es_staff()));
create policy mapeo_admin_escribe on public.mapeo_importacion for all to authenticated
  using ((select app.rol_actual()) = 'admin')
  with check ((select app.rol_actual()) = 'admin');
