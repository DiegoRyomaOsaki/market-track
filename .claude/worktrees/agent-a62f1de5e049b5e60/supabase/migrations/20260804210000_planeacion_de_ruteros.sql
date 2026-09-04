-- Diseño de ruteros: leer un periodo, reordenar paradas, duplicar y publicar.
--
-- `rutero` es POR DÍA (unique mercaderista+fecha). La vista semanal y la mensual
-- del panel son dos ventanas sobre esas filas diarias: no hay entidad "semana"
-- ni "mes", y no hace falta crearla.

-- --- Reordenar necesita que la unique sea diferible -------------------------
--
-- Una unique NO diferible se comprueba FILA A FILA: intercambiar el orden de dos
-- paradas revienta con `duplicate key` a mitad del UPDATE, cuando las dos valen
-- lo mismo por un instante, aunque el estado final sea perfectamente válido.
--
-- Declararla `deferrable` mueve la comprobación al FINAL DE LA SENTENCIA, y eso
-- ya basta: el renumerado de abajo es un único `update ... from`, así que el
-- estado intermedio inválido nunca se ve. Medido en Postgres 17: con la unique
-- tal cual, el intercambio falla; con `deferrable initially immediate` y sin
-- pedir nada más, pasa.
--
-- Por eso NO hace falta un `set constraints ... deferred` dentro de la función:
-- eso solo haría falta si el reordenado se repartiera en varias sentencias.
-- `initially immediate` mantiene el comportamiento de siempre para el resto de
-- escrituras.
alter table public.rutero_parada
  drop constraint rutero_parada_rutero_id_orden_key;

alter table public.rutero_parada
  add constraint rutero_parada_rutero_id_orden_key
  unique (rutero_id, orden) deferrable initially immediate;

-- --- Leer un periodo ---------------------------------------------------------
--
-- Un rutero por día del rango, con sus paradas y el nombre de la tienda. Los días
-- SIN rutero no salen: los pinta el panel como huecos del calendario, que es
-- información de presentación y no de la base.
--
-- `security invoker`: la RLS de `rutero` decide qué ve quien llama.
create function public.planeacion_ruteros(
  p_mercaderista uuid,
  p_desde date,
  p_hasta date
)
returns table (
  rutero_id uuid,
  fecha date,
  estado public.estado_rutero,
  parada_id uuid,
  orden integer,
  tienda_id uuid,
  tienda_nombre text,
  parada_estado public.estado_parada
)
language sql
stable
set search_path = ''
as $$
  select
    r.id, r.fecha, r.estado,
    rp.id, rp.orden, t.id, t.nombre, rp.estado
  from public.rutero r
  left join public.rutero_parada rp on rp.rutero_id = r.id
  left join public.tienda t on t.id = rp.tienda_id
  where r.mercaderista_id = p_mercaderista
    and r.fecha between p_desde and p_hasta
  order by r.fecha, rp.orden;
$$;

comment on function public.planeacion_ruteros(uuid, date, date) is
  'Los ruteros de un mercaderista en un rango de fechas, con sus paradas. Alimenta la vista semanal y la mensual del panel: ambas son ventanas sobre las mismas filas diarias.';

grant execute on function public.planeacion_ruteros(uuid, date, date) to authenticated, service_role;

-- --- Reordenar ---------------------------------------------------------------
--
-- Recibe las paradas en el orden deseado y las renumera 1..n. Se pasa la lista
-- entera y no "sube esta una posición" a propósito: dos supervisores tocando el
-- mismo rutero con operaciones relativas se pisan y dejan un orden incoherente;
-- con la lista completa, el último que escribe gana y el resultado siempre es una
-- secuencia sin huecos ni repetidos.
create function public.reordenar_paradas(p_rutero_id uuid, p_paradas uuid[])
returns void
language plpgsql
set search_path = ''
as $$
begin
  -- La lista tiene que ser EXACTAMENTE el conjunto de paradas del rutero. Comparar
  -- solo el tamaño no basta: `[a,a,c]` sobre las paradas {a,b,c} mide 3 igual que
  -- {a,b,c}, pero dejaría a `b` sin renumerar y a `a` con un orden indeterminado
  -- (el `update ... from` casa dos filas contra el mismo destino).
  if exists (
    -- Paradas del rutero que la lista se dejó fuera.
    select id from public.rutero_parada where rutero_id = p_rutero_id
    except
    select unnest(p_paradas)
  ) or exists (
    -- Ids de la lista que no son paradas de este rutero.
    select unnest(p_paradas)
    except
    select id from public.rutero_parada where rutero_id = p_rutero_id
  ) or coalesce(array_length(p_paradas, 1), 0) <> (
    -- Repetidos: `except` los ignora, así que el recuento los caza aparte.
    select count(distinct u) from unnest(p_paradas) u
  )
  then
    raise exception 'La lista debe incluir todas las paradas del rutero, una sola vez cada una';
  end if;

  -- Replanificar un rutero que ya salió a la calle le cambiaría el orden de las
  -- tiendas al mercaderista a media jornada, con la réplica ya en el teléfono.
  if not exists (
    select 1 from public.rutero
    where id = p_rutero_id and estado = 'borrador'
  ) then
    raise exception 'Solo se reordena un rutero en borrador';
  end if;

  update public.rutero_parada rp
  set orden = nueva.posicion
  from (
    select id, ordinality::integer as posicion
    from unnest(p_paradas) with ordinality as u(id, ordinality)
  ) as nueva
  where rp.id = nueva.id and rp.rutero_id = p_rutero_id;
end;
$$;

comment on function public.reordenar_paradas(uuid, uuid[]) is
  'Renumera las paradas de un rutero en borrador según el orden recibido. Exige la lista exacta (sin faltas, sobras ni repetidos) antes de escribir nada.';

grant execute on function public.reordenar_paradas(uuid, uuid[]) to authenticated, service_role;

-- --- Añadir una parada -------------------------------------------------------
--
-- Asignar una tienda a un día son tres cosas: crear el rutero si ese día aún no
-- lo tiene, calcular el orden siguiente y escribir la parada. En una función
-- porque las tres tienen que pasar juntas: el panel no debería poder dejar un
-- rutero creado y vacío porque falló el insert de la parada.
create function public.agregar_parada_rutero(
  p_mercaderista uuid,
  p_fecha date,
  p_tienda uuid
)
returns uuid
language plpgsql
set search_path = ''
as $$
declare
  v_rutero uuid;
  v_tenant uuid;
  v_parada uuid;
begin
  -- El tenant sale del mercaderista, nunca de un parámetro: quien llama no elige
  -- en qué cliente escribe.
  select tenant_id into v_tenant from public.profile where id = p_mercaderista;
  if v_tenant is null then
    raise exception 'El mercaderista no existe o no pertenece a ningún cliente';
  end if;

  select id into v_rutero from public.rutero
  where mercaderista_id = p_mercaderista and fecha = p_fecha
    and estado = 'borrador';

  -- Si el día YA tiene rutero pero no está en borrador, no se le cuelgan tiendas
  -- nuevas: el mercaderista puede estar en la calle con él. Sin este filtro, el
  -- `is null` de abajo intentaría crear un segundo rutero para el mismo día y
  -- moriría contra la unique con un error que no explica nada.
  if v_rutero is null and exists (
    select 1 from public.rutero
    where mercaderista_id = p_mercaderista and fecha = p_fecha
  ) then
    raise exception 'Ese día ya tiene un rutero publicado o en curso: no admite paradas nuevas';
  end if;

  if v_rutero is null then
    insert into public.rutero (tenant_id, mercaderista_id, fecha, estado)
    values (v_tenant, p_mercaderista, p_fecha, 'borrador')
    returning id into v_rutero;
  end if;

  insert into public.rutero_parada (tenant_id, rutero_id, tienda_id, orden)
  select v_tenant, v_rutero, p_tienda,
         coalesce(max(orden), 0) + 1
  from public.rutero_parada where rutero_id = v_rutero
  returning id into v_parada;

  return v_parada;
end;
$$;

comment on function public.agregar_parada_rutero(uuid, date, uuid) is
  'Asigna una tienda a un día, creando el rutero si hace falta y calculando el orden. Atómico: no deja ruteros vacíos si el insert de la parada falla.';

grant execute on function public.agregar_parada_rutero(uuid, date, uuid) to authenticated, service_role;

-- --- Duplicar un periodo -----------------------------------------------------
--
-- Copia los ruteros de un rango al siguiente, desplazando las fechas. Lo pide el
-- cliente porque una ruta se repite casi igual cada semana y rehacerla a mano es
-- el trabajo que hace que nadie planifique.
--
-- Copia SIEMPRE como borrador: duplicar es un punto de partida para editar, no
-- una publicación. Y no pisa lo que ya exista — un día con rutero se salta, con
-- lo que la operación se puede repetir sin miedo.
create function public.duplicar_periodo_rutero(
  p_mercaderista uuid,
  p_desde date,
  p_hasta date,
  p_dias_desplazamiento integer
)
returns integer
language plpgsql
set search_path = ''
as $$
declare
  creados integer := 0;
begin
  if p_dias_desplazamiento = 0 then
    raise exception 'El desplazamiento no puede ser cero: se copiaría sobre el propio periodo';
  end if;

  with origen as (
    select r.id, r.tenant_id, r.mercaderista_id,
           r.fecha + p_dias_desplazamiento as fecha_destino
    from public.rutero r
    where r.mercaderista_id = p_mercaderista
      and r.fecha between p_desde and p_hasta
  ),
  -- Los días que ya tienen rutero se saltan: duplicar no destruye trabajo hecho.
  nuevos as (
    insert into public.rutero (tenant_id, mercaderista_id, fecha, estado)
    select o.tenant_id, o.mercaderista_id, o.fecha_destino, 'borrador'
    from origen o
    where not exists (
      select 1 from public.rutero x
      where x.mercaderista_id = p_mercaderista and x.fecha = o.fecha_destino
    )
    returning id, mercaderista_id, fecha
  )
  insert into public.rutero_parada (tenant_id, rutero_id, tienda_id, orden)
  select rp.tenant_id, n.id, rp.tienda_id, rp.orden
  from nuevos n
  join origen o on o.fecha_destino = n.fecha
  join public.rutero_parada rp on rp.rutero_id = o.id;

  get diagnostics creados = row_count;
  return creados;
end;
$$;

comment on function public.duplicar_periodo_rutero(uuid, date, date, integer) is
  'Copia los ruteros de un rango desplazando las fechas. Siempre como borrador, y sin pisar los días que ya tienen rutero: se puede repetir sin miedo.';

grant execute on function public.duplicar_periodo_rutero(uuid, date, date, integer) to authenticated, service_role;

-- --- Quitar una parada necesita el GRANT, no solo la política -----------------
--
-- `parada_staff_escribe` es `for all`, o sea que la RLS ya contaba con el borrado.
-- Pero `authenticated` solo tenía INSERT, SELECT y UPDATE: el `delete` del panel
-- moría con `42501 permission denied` ANTES de que ninguna política llegara a
-- evaluarse, y el error parecía de RLS sin serlo. El GRANT es la puerta; la RLS es
-- el portero, y hacían falta los dos.
grant delete on public.rutero_parada to authenticated;

-- --- La planeación solo se toca mientras es borrador --------------------------
--
-- Las funciones de arriba ya lo exigen, pero no son la única puerta: `quitarParada`
-- del panel borra por PostgREST, y `parada_staff_escribe` deja a cualquier sesión
-- de staff escribir la tabla directamente. Un `delete` con un JWT de supervisor le
-- quitaría una tienda de la ruta a un mercaderista que ya está en la calle con
-- ella replicada en el teléfono. La comprobación de la UI es UX; esta es la regla.
--
-- Solo se bloquea la FORMA de la planeación (que la parada exista, a qué tienda
-- apunta y en qué orden). `estado` se deja libre a propósito: es la columna que
-- avanza con la jornada, y congelarla rompería el seguimiento de la visita.
create function public.parada_solo_se_planifica_en_borrador()
returns trigger
language plpgsql
-- `definer`: si la RLS del que llama no le dejara ver la fila de `rutero`, el
-- `select` de abajo no encontraría nada y el guard se abriría en vez de cerrarse.
security definer
set search_path = ''
as $$
declare
  v_rutero uuid := coalesce(new.rutero_id, old.rutero_id);
  v_estado public.estado_rutero;
begin
  if tg_op = 'UPDATE'
     and new.rutero_id is not distinct from old.rutero_id
     and new.tienda_id is not distinct from old.tienda_id
     and new.orden is not distinct from old.orden
  then
    return new;
  end if;

  select estado into v_estado from public.rutero where id = v_rutero;

  -- Sin fila padre es un borrado en cascada del rutero entero: no es replanificar.
  if not found then
    return coalesce(new, old);
  end if;

  if v_estado <> 'borrador' then
    raise exception
      'La planeación de un rutero % no se modifica: ya salió del borrador', v_estado;
  end if;

  return coalesce(new, old);
end;
$$;

revoke execute on function public.parada_solo_se_planifica_en_borrador() from public;

create trigger parada_solo_se_planifica_en_borrador
  before insert or update or delete on public.rutero_parada
  for each row execute function public.parada_solo_se_planifica_en_borrador();
