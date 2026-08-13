-- Lo que el panel necesita para CONFIGURAR las dos métricas.
--
-- Tres funciones y una columna. Ninguna calcula nada nuevo: las dos de vista
-- previa envuelven los ponderadores que ya existen, y la de publicar la escalera
-- cierra un agujero que hoy corrompe la configuración en silencio.

-- ---------------------------------------------------------------------------
-- 1. La cadencia del plan de lealtad
--
-- El bono se paga por periodo, y hasta ahora ese periodo solo existía como
-- argumento de quien llamaba al recálculo: no había forma de decir "el plan de
-- este cliente es trimestral". Va en la CONFIGURACIÓN y no en cada peldaño de la
-- escalera porque la cadencia es del plan entero — una escalera de tres niveles
-- no tiene tres periodicidades.
--
-- Aditiva y con default: las filas ya publicadas siguen siendo válidas y el
-- código que inserta sin la columna sigue funcionando durante el rollout.
-- ---------------------------------------------------------------------------
alter table public.config_perfect_merchandiser
  add column periodicidad public.periodo_puntaje not null default 'mensual';

comment on column public.config_perfect_merchandiser.periodicidad is
  'Cada cuánto se cierra y se paga el plan de lealtad. La cadencia es del plan, no de cada nivel de bono.';

-- ---------------------------------------------------------------------------
-- 2. Publicar una escalera de bonos, entera y de una vez
--
-- Sin esto, publicar una escalera con una `vigente_desde` que YA tiene una no
-- falla: FUSIONA las dos. La clave natural es (tenant, vigente_desde,
-- puntaje_min), así que solo choca si coincide el umbral exacto — y el resultado
-- es una escalera mezclada que nadie configuró:
--
--   vigente:  Bronce 60 · Plata 80 · Oro 95
--   publica:  Nuevo bajo 50 · Nuevo medio 70
--   queda:    Nuevo bajo 50 · Bronce 60 · Nuevo medio 70 · Plata 80 · Oro 95
--
-- Y `authenticated` no tiene `delete` sobre la tabla (a propósito: borrar dejaría
-- huérfanos los puntajes), así que desde el panel NO se puede deshacer. De estas
-- filas sale un bono que se paga.
--
-- `security invoker`: la RLS decide si quien llama puede escribir. La función no
-- comprueba el rol por su cuenta — habría dos reglas de acceso que podrían
-- desincronizarse, y la de aquí no protege el acceso directo por PostgREST.
-- ---------------------------------------------------------------------------
create function public.publicar_escalera_bono(
  p_tenant_id     uuid,
  p_vigente_desde date,
  p_niveles       jsonb
)
returns integer
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_n integer;
begin
  if jsonb_typeof(p_niveles) <> 'array' or jsonb_array_length(p_niveles) = 0 then
    raise exception 'la escalera necesita al menos un nivel'
      using errcode = 'check_violation';
  end if;

  -- Serializa a dos admins publicando la misma escalera a la vez: sin esto, los
  -- dos pasan la comprobación de abajo y los dos insertan. El lock es de
  -- transacción, así que se suelta solo al terminar.
  perform pg_advisory_xact_lock(
    hashtext(p_tenant_id::text || '|' || p_vigente_desde::text));

  if exists (
    select 1 from public.nivel_bono_merchandiser n
    where n.tenant_id = p_tenant_id and n.vigente_desde = p_vigente_desde
  ) then
    raise exception 'ya hay una escalera de bonos vigente desde %', p_vigente_desde
      using errcode = 'check_violation';
  end if;

  -- Una sola sentencia: o entran todos los peldaños o no entra ninguno. Media
  -- escalera publicada sería una escalera vigente.
  insert into public.nivel_bono_merchandiser
    (tenant_id, vigente_desde, nombre, puntaje_min, monto, creado_por)
  select p_tenant_id, p_vigente_desde, x.nombre, x.puntaje_min, x.monto, auth.uid()
  from jsonb_to_recordset(p_niveles)
    as x(nombre text, puntaje_min numeric, monto numeric);

  get diagnostics v_n = row_count;
  return v_n;
end;
$$;

comment on function public.publicar_escalera_bono(uuid, date, jsonb) is
  'Publica una escalera de bonos completa. Rechaza una fecha que ya tenga escalera: publicar sobre ella no la reemplaza, la fusiona, y no hay forma de deshacerlo desde el panel.';

revoke execute on function public.publicar_escalera_bono(uuid, date, jsonb) from public;
grant execute on function public.publicar_escalera_bono(uuid, date, jsonb)
  to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 3. Las vistas previas
--
-- RE-PONDERAN un puntaje ya calculado con los pesos que el admin está editando.
-- NO recalculan las variables: cambiar el objetivo de share of shelf o la
-- política de POP no se refleja aquí, y la UI tiene que decirlo. Recalcularlas
-- exigiría un motor what-if paralelo al de MAR-95/MAR-100, que divergiría del
-- que produce los puntajes de verdad.
--
-- Viven en `public` porque el esquema `app` NO está expuesto por PostgREST
-- (`config.toml`: schemas = ["public", "graphql_public"]), así que la app no
-- puede llamar a `app.ponderar_*` directamente. Son envolturas delgadas: toda la
-- aritmética sigue teniendo un solo dueño.
--
-- `security invoker` otra vez: leen `puntaje_*` con las políticas de quien llama,
-- así que la RLS acota el cliente sin una sola condición escrita a mano aquí.
-- ---------------------------------------------------------------------------
create function public.previsualizar_perfect_store(
  p_marca_id uuid,
  p_pesos    jsonb
)
returns table (
  levantamiento_id uuid,
  tienda_nombre    text,
  calculado_at     timestamptz,
  total_actual     numeric,
  total_previsto   numeric
)
language sql
stable
security invoker
set search_path = ''
as $$
  select
    p.levantamiento_id,
    t.nombre,
    p.calculado_at,
    p.total_pct,
    app.ponderar_perfect_store(
      -- `jsonb_populate_record` arma la fila de configuración a partir de los
      -- pesos sin guardar. Los campos que no vienen quedan nulos y el ponderador
      -- no los mira: solo usa los cinco pesos.
      --
      -- Ojo: la fila es EFÍMERA, nunca se inserta, así que los CHECK de la tabla
      -- (que los pesos sumen 100) NO se evalúan aquí. Una previa con pesos que
      -- no suman 100 devuelve un número fuera del contrato 0-100. Quien llama
      -- valida en su frontera; esto es de solo lectura y no persiste nada.
      jsonb_populate_record(null::public.config_perfect_store, p_pesos),
      p.distribucion_pct, p.visibilidad_pct, p.precio_pct
    )
  from public.puntaje_perfect_store p
  join public.levantamiento l on l.id = p.levantamiento_id
  join public.visita v on v.id = l.visita_id
  join public.tienda t on t.id = v.tienda_id
  where l.marca_id = p_marca_id
  order by p.calculado_at desc
  limit 1;
$$;

comment on function public.previsualizar_perfect_store(uuid, jsonb) is
  'El efecto de unos pesos sin guardar sobre el puntaje de Perfect Store más reciente de una marca. RE-PONDERA lo ya calculado: no recalcula las variables, así que un objetivo de share of shelf distinto no se refleja.';

revoke execute on function public.previsualizar_perfect_store(uuid, jsonb) from public;
grant execute on function public.previsualizar_perfect_store(uuid, jsonb)
  to authenticated, service_role;

create function public.previsualizar_merchandiser(
  p_tenant_id uuid,
  p_pesos     jsonb
)
returns table (
  mercaderista_id uuid,
  mercaderista    text,
  periodo_inicio  date,
  tipo            public.periodo_puntaje,
  total_actual    numeric,
  total_previsto  numeric
)
language sql
stable
security invoker
set search_path = ''
as $$
  select
    p.mercaderista_id,
    pr.nombre,
    p.periodo_inicio,
    p.tipo,
    p.total_pct,
    app.ponderar_merchandiser(
      jsonb_populate_record(null::public.config_perfect_merchandiser, p_pesos),
      p.puntualidad_pct, p.asistencia_pct, p.tiempo_efectivo_pct,
      p.calidad_pct, p.herramientas_pct
    )
  from public.puntaje_merchandiser p
  join public.profile pr on pr.id = p.mercaderista_id
  where p.tenant_id = p_tenant_id
  order by p.calculado_at desc
  limit 1;
$$;

comment on function public.previsualizar_merchandiser(uuid, jsonb) is
  'El efecto de unos pesos sin guardar sobre el puntaje del plan de lealtad más reciente de un cliente. RE-PONDERA lo ya calculado: no recalcula las variables.';

revoke execute on function public.previsualizar_merchandiser(uuid, jsonb) from public;
grant execute on function public.previsualizar_merchandiser(uuid, jsonb)
  to authenticated, service_role;
