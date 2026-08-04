-- Revisión de reportes de visita: el staff aprueba o rechaza, el mercaderista lo ve.
--
-- POR QUÉ UNA TABLA APARTE Y NO COLUMNAS EN `visita`
--
--   1. `visita` la escribe el mercaderista por PowerSync, así que protegerla haría
--      falta a nivel de COLUMNA. Un `grant update (columnas)` rompe el reintento
--      del conector: manda todas las columnas, recibe 42501 y `esRechazoPermanente()`
--      descarta la operación — se pierde trabajo de campo. Y un trigger que hace
--      `raise` acaba igual, porque esa función trata CUALQUIER SQLSTATE como
--      definitivo. Quedaría un trigger que coerciona en silencio consultando
--      `app.es_staff()` en cada escritura de campo: un SEGUNDO dueño de la regla de
--      acceso, en el camino de escritura más caliente del producto.
--
--   2. La RLS filtra FILAS, no columnas, y `visita_usuario_lee_su_tenant` le entrega
--      la fila entera al cliente-marca. Con las columnas en `visita`, el brand
--      manager leería "tu reporte fue rechazado por foto borrosa": control de
--      calidad interno de la outsourcing sobre su propio empleado, en manos de un
--      tercero. Es el mismo razonamiento por el que `profile` no tiene una política
--      "leer los perfiles de mi tenant". Con tabla aparte basta con no escribirle
--      política al cliente.
--
--   3. Tampoco vale ampliar `estado_visita`. Una visita rechazada sigue estando
--      `completada` operativamente, son dos ejes distintos. Y `estadoVisual()` del
--      móvil tiene un `return "pendiente"` de fallback: un valor nuevo del enum
--      haría que una visita aprobada saliera como "Pendiente" en el teléfono sin
--      romper ninguna compilación.
--
-- Así, que el mercaderista no toque la revisión no lo impone un procedimiento: no
-- tiene política de escritura sobre esta tabla. Es estructural.

create type public.decision_revision as enum ('aprobada', 'rechazada');

create table public.revision_visita (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references public.tenant (id) on delete restrict,
  visita_id   uuid not null,
  decision    public.decision_revision not null,
  motivo      text,
  revisor_id  uuid not null references public.profile (id) on delete restrict,
  revisado_at timestamptz not null default now(),
  creado_at   timestamptz not null default now(),

  -- La decisión VIGENTE, no un historial: cambiar de opinión pisa esta fila. Hoy
  -- no existe ciclo de corrección (la app no tiene flujo de reenviar una visita),
  -- así que un log de decisiones sería una tabla sin nadie que la llene. Añadirlo
  -- después es aditivo.
  unique (visita_id),

  constraint revision_visita_fk foreign key (visita_id, tenant_id)
    references public.visita (id, tenant_id) on delete cascade,

  -- Rechazar EXIGE motivo en el ESQUEMA, no solo en la UI: es la mitad del valor
  -- de rechazar. Aprobar no lo exige — una cola de 50 visitas al día se atasca si
  -- cada visto bueno pide redactar. Es la diferencia deliberada con
  -- `solicitud_cambio_ruta`, donde el comentario es obligatorio en ambas ramas
  -- porque siempre hay que explicar qué pasa con la ruta.
  constraint revision_motivo_si_rechaza check (
    decision <> 'rechazada' or length(btrim(coalesce(motivo, ''))) > 0
  ),

  -- El motivo baja a un teléfono por la réplica: se acota como se acotó la
  -- respuesta de formulario.
  constraint revision_motivo_tamano check (motivo is null or length(motivo) <= 500)
);

create index revision_visita_tenant_idx on public.revision_visita (tenant_id);
-- El `unique (visita_id)` ya sirve al left join de la cola: no hace falta otro.

comment on table public.revision_visita is
  'La decisión vigente sobre el reporte de una visita. Vive aparte de `visita` porque esa la escribe el mercaderista por PowerSync y la lee el cliente-marca entera.';

comment on column public.revision_visita.motivo is
  'Obligatorio al rechazar (constraint). El mercaderista lo lee en su app: es lo que le dice qué corregir.';

-- El GRANT es la puerta; la RLS es el portero. Sin `delete`: una decisión de
-- calidad no se borra, se cambia.
grant select, insert, update on public.revision_visita to authenticated;
grant all on public.revision_visita to service_role;

alter table public.revision_visita enable row level security;

create policy revvis_staff_lee on public.revision_visita
  for select to authenticated
  using ((select app.es_staff()));

-- El mercaderista lee la de SUS visitas: es lo que su app le enseña.
create policy revvis_mercaderista_lee_las_suyas on public.revision_visita
  for select to authenticated
  using (exists (
    select 1 from public.visita v
    where v.id = visita_id and v.mercaderista_id = (select auth.uid())
  ));

-- NO hay política para el rol `cliente`, y es deliberado: ver la cabecera.

-- Decide el staff, y siempre firmando con su propio nombre. Sin el
-- `revisor_id = auth.uid()`, un supervisor podría atribuirle la decisión a otro y
-- la trazabilidad se queda en adorno. Mismo cuidado que `pase_acceso_temporal`
-- con `generado_por`.
create policy revvis_staff_decide on public.revision_visita
  for insert to authenticated
  with check ((select app.es_staff()) and revisor_id = (select auth.uid()));

create policy revvis_staff_cambia_la_decision on public.revision_visita
  for update to authenticated
  using ((select app.es_staff()))
  with check ((select app.es_staff()) and revisor_id = (select auth.uid()));

-- --- La cola -----------------------------------------------------------------
--
-- Las visitas cerradas de un rango, con lo que un supervisor necesita para decidir
-- sin abrir el detalle: cuántas marcas se auditaron, cuántas se omitieron, cuántas
-- contingencias hubo y cuánta evidencia sigue en el teléfono.
--
-- `decision IS NULL` ES el estado "pendiente": no se inventa un tercer valor del
-- enum para algo que es la ausencia de una fila.
--
-- Solo entran las `completada`. Una visita sin check-out todavía no es un reporte,
-- y perseguirla es trabajo del tablero del día — que ya la pinta en rojo. Dos
-- pantallas para el mismo hecho serían dos dueños.
create function public.cola_revision(p_desde date, p_hasta date)
returns table (
  visita_id uuid,
  mercaderista_id uuid,
  mercaderista_nombre text,
  tienda_nombre text,
  cadena_nombre text,
  check_in_at timestamptz,
  check_out_at timestamptz,
  duracion_min integer,
  check_in_geocerca_ok boolean,
  check_out_geocerca_ok boolean,
  marcas bigint,
  omitidos bigint,
  contingencias bigint,
  quiebres bigint,
  fotos bigint,
  fotos_pendientes bigint,
  decision public.decision_revision,
  motivo text,
  revisor_nombre text,
  revisado_at timestamptz
)
language sql
stable
set search_path = ''
as $$
  select
    v.id,
    v.mercaderista_id,
    p.nombre,
    t.nombre,
    ca.nombre,
    v.check_in_at,
    v.check_out_at,
    (extract(epoch from (v.check_out_at - v.check_in_at)) / 60)::integer,
    v.check_in_geocerca_ok,
    v.check_out_geocerca_ok,
    l.marcas,
    l.omitidos,
    co.n,
    q.n,
    f.total,
    f.pendientes,
    r.decision,
    r.motivo,
    rev.nombre,
    r.revisado_at
  from public.visita v
  join public.profile p on p.id = v.mercaderista_id
  join public.tienda t on t.id = v.tienda_id
  join public.cadena ca on ca.id = t.cadena_id
  left join public.revision_visita r on r.visita_id = v.id
  left join public.profile rev on rev.id = r.revisor_id
  left join lateral (
    select
      count(*) as marcas,
      count(*) filter (where le.estado = 'omitido') as omitidos
    from public.levantamiento le where le.visita_id = v.id
  ) l on true
  left join lateral (
    select count(*) as n from public.contingencia c where c.visita_id = v.id
  ) co on true
  left join lateral (
    select count(*) as n
    from public.levantamiento_sku ls
    join public.levantamiento le on le.id = ls.levantamiento_id
    where le.visita_id = v.id and ls.quiebre
  ) q on true
  left join lateral (
    select
      count(*) as total,
      -- Sin `subida_at` la evidencia sigue en el teléfono: no hay nada que firmar
      -- en R2 todavía. Se cuenta para que la cola lo diga en vez de enseñar huecos.
      count(*) filter (where fo.subida_at is null) as pendientes
    from public.foto fo where fo.visita_id = v.id
  ) f on true
  where v.estado = 'completada'
    -- Ventana anclada en Lima y sargable: nunca `check_out_at::date between`, que
    -- castea por fila y tira el índice.
    and v.check_out_at >= (p_desde::timestamp at time zone 'America/Lima')
    and v.check_out_at < ((p_hasta + 1)::timestamp at time zone 'America/Lima')
  -- Es una bandeja de trabajo: lo pendiente primero, y dentro de ello lo más viejo.
  order by (r.id is null) desc, v.check_out_at asc;
$$;

comment on function public.cola_revision(date, date) is
  'Visitas cerradas de un rango con su estado de revisión. `decision` nula = pendiente. La RLS acota lo que ve quien llama: el cliente-marca no recibe filas.';

grant execute on function public.cola_revision(date, date) to authenticated, service_role;

-- --- El detalle --------------------------------------------------------------
--
-- El reporte completo de una visita en un solo viaje. Devuelve `jsonb` y no un
-- `returns table` porque es un ÁRBOL: visita → N levantamientos → sus SKUs,
-- exhibiciones y respuestas. Aplanarlo duplicaría la cabecera por cada SKU y
-- obligaría a reagrupar en TypeScript, que es dar forma en la UI a algo que la base
-- ya sabe. Los embeds anidados de PostgREST no sirven aquí: todas las FK de este
-- esquema son COMPUESTAS (`(visita_id, tenant_id)`).
--
-- Devuelve NULL si quien llama no ve la visita — indistinguible de "no existe", que
-- es lo que impide sondear qué visitas tiene otro cliente.
create function public.detalle_visita(p_visita_id uuid)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_build_object(
    'visita', jsonb_build_object(
      'id', v.id,
      'tienda_nombre', t.nombre,
      'cadena_nombre', ca.nombre,
      'mercaderista_nombre', p.nombre,
      'check_in_at', v.check_in_at,
      'check_out_at', v.check_out_at,
      'duracion_min', (extract(epoch from (v.check_out_at - v.check_in_at)) / 60)::integer,
      'check_in_geocerca_ok', v.check_in_geocerca_ok,
      'check_out_geocerca_ok', v.check_out_geocerca_ok,
      'bitacora', v.bitacora,
      'tiempo_traslado_min', v.tiempo_traslado_min,
      'bateria_inicio_pct', v.bateria_inicio_pct,
      'selfie_foto_id', v.selfie_foto_id
    ),
    'revision', case when r.id is null then null else jsonb_build_object(
      'decision', r.decision,
      'motivo', r.motivo,
      'revisor_nombre', rev.nombre,
      'revisado_at', r.revisado_at
    ) end,
    'levantamientos', coalesce((
      select jsonb_agg(lev order by lev->>'marca_nombre')
      from (
        select jsonb_build_object(
          'id', le.id,
          'marca_nombre', ma.nombre,
          'estado', le.estado,
          'sos_frentes_propios', le.sos_frentes_propios,
          'sos_frentes_competencia', le.sos_frentes_competencia,
          'skus', coalesce((
            select jsonb_agg(jsonb_build_object(
              'codigo', s.codigo,
              'nombre', s.nombre,
              'stock_sistema', ls.stock_sistema,
              'stock_piso', ls.stock_piso,
              -- Columnas generadas: el quiebre y la diferencia tienen un solo
              -- calculador y no es este.
              'quiebre', ls.quiebre,
              'diferencia', ls.diferencia,
              'precio_registrado', ls.precio_registrado,
              'hay_promo', ls.hay_promo,
              'promo_comunicada', ls.promo_comunicada
            ) order by s.nombre)
            from public.levantamiento_sku ls
            join public.sku s on s.id = ls.sku_id
            where ls.levantamiento_id = le.id
          ), '[]'::jsonb),
          'exhibiciones', coalesce((
            select jsonb_agg(jsonb_build_object(
              'tipo', coalesce(ex.tipo_adicional::text, en.tipo::text),
              'negociada', ex.exhibicion_negociada_id is not null,
              'instalada', ex.instalada,
              'unidades', ex.unidades,
              'completa', ex.completa,
              'vigente', ex.vigente
            ))
            from public.exhibicion ex
            left join public.exhibicion_negociada en
              on en.id = ex.exhibicion_negociada_id
            where ex.levantamiento_id = le.id
          ), '[]'::jsonb),
          'respuestas', coalesce((
            select jsonb_agg(jsonb_build_object(
              'campo_id', re.campo_id,
              'valor', re.valor
            ) order by re.campo_id)
            from public.levantamiento_respuesta re
            where re.levantamiento_id = le.id
          ), '[]'::jsonb)
        ) as lev
        from public.levantamiento le
        join public.marca ma on ma.id = le.marca_id
        where le.visita_id = v.id
      ) niveles
    ), '[]'::jsonb),
    'contingencias', coalesce((
      select jsonb_agg(jsonb_build_object(
        'paso', c.paso,
        'motivo', c.motivo,
        'comentario', c.comentario,
        'registrada_at', c.registrada_at,
        'levantamiento_id', c.levantamiento_id
      ) order by c.registrada_at)
      from public.contingencia c where c.visita_id = v.id
    ), '[]'::jsonb),
    'fotos', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', fo.id,
        'levantamiento_id', fo.levantamiento_id,
        'tipo', fo.tipo,
        'capturada_at', fo.capturada_at,
        'subida_at', fo.subida_at
      ) order by fo.capturada_at)
      from public.foto fo where fo.visita_id = v.id
    ), '[]'::jsonb)
  )
  from public.visita v
  join public.profile p on p.id = v.mercaderista_id
  join public.tienda t on t.id = v.tienda_id
  join public.cadena ca on ca.id = t.cadena_id
  left join public.revision_visita r on r.visita_id = v.id
  left join public.profile rev on rev.id = r.revisor_id
  where v.id = p_visita_id;
$$;

comment on function public.detalle_visita(uuid) is
  'El reporte completo de una visita como jsonb. Null si quien llama no la ve, indistinguible de que no exista.';

grant execute on function public.detalle_visita(uuid) to authenticated, service_role;

-- --- Decidir -----------------------------------------------------------------
--
-- En una función porque el `tenant_id` sale de la visita: resolverlo desde el panel
-- serían dos viajes con una ventana entre la lectura y la escritura.
--
-- `security invoker`: la RLS sigue siendo el portero. Si quien llama no ve la
-- visita, el select de abajo no devuelve nada y la función falla igual que si la
-- visita no existiera.
create function public.revisar_visita(
  p_visita_id uuid,
  p_decision public.decision_revision,
  p_motivo text
)
returns timestamptz
language plpgsql
set search_path = ''
as $$
declare
  v_tenant uuid;
  v_revisado_at timestamptz;
begin
  select tenant_id into v_tenant
  from public.visita
  where id = p_visita_id and estado = 'completada';

  if v_tenant is null then
    raise exception 'La visita no existe, no está cerrada o no es tuya';
  end if;

  insert into public.revision_visita
    (tenant_id, visita_id, decision, motivo, revisor_id, revisado_at)
  values
    (v_tenant, p_visita_id, p_decision, nullif(btrim(coalesce(p_motivo, '')), ''),
     (select auth.uid()), now())
  on conflict (visita_id) do update
    set decision    = excluded.decision,
        motivo      = excluded.motivo,
        revisor_id  = excluded.revisor_id,
        revisado_at = excluded.revisado_at
  returning revisado_at into v_revisado_at;

  return v_revisado_at;
end;
$$;

comment on function public.revisar_visita(uuid, public.decision_revision, text) is
  'Aprueba o rechaza el reporte de una visita, siempre firmado por quien llama. Re-decidir pisa la decisión vigente.';

grant execute on function public.revisar_visita(uuid, public.decision_revision, text)
  to authenticated, service_role;
