-- Diseño de ruteros: leer un periodo, reordenar paradas, duplicar y publicar.
--
-- `rutero` es POR DÍA (unique mercaderista+fecha). La vista semanal y la mensual
-- del panel son dos ventanas sobre esas filas diarias: no hay entidad "semana"
-- ni "mes", y no hace falta crearla.

-- --- Reordenar necesita que la unique sea diferible -------------------------
--
-- `unique (rutero_id, orden)` se comprueba FILA A FILA. Intercambiar la parada 1
-- con la 2 falla en la primera sentencia, cuando las dos valen 1 por un instante,
-- aunque el estado final sea perfectamente válido. Es el caso clásico de un orden
-- reordenable, y la solución también lo es: diferir la comprobación al final de
-- la transacción.
--
-- `initially immediate` mantiene el comportamiento de siempre para cualquier otra
-- escritura; solo la función de abajo pide explícitamente diferirla.
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
  -- Sin esto, renumerar falla en cuanto dos paradas coinciden en un orden
  -- intermedio, aunque el estado final sea válido.
  set constraints public.rutero_parada_rutero_id_orden_key deferred;

  update public.rutero_parada rp
  set orden = nueva.posicion
  from (
    select id, ordinality::integer as posicion
    from unnest(p_paradas) with ordinality as u(id, ordinality)
  ) as nueva
  where rp.id = nueva.id and rp.rutero_id = p_rutero_id;

  -- Si la lista no cubre exactamente las paradas del rutero, algo se quedó fuera
  -- y renumerar habría dejado huecos. Mejor no escribir que escribir a medias.
  if (select count(*) from public.rutero_parada where rutero_id = p_rutero_id)
     <> coalesce(array_length(p_paradas, 1), 0)
  then
    raise exception 'La lista debe incluir todas las paradas del rutero, y solo esas';
  end if;
end;
$$;

comment on function public.reordenar_paradas(uuid, uuid[]) is
  'Renumera las paradas de un rutero según el orden recibido. Difiere la unique porque un intercambio la viola a mitad de camino aunque el estado final sea válido.';

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
  where mercaderista_id = p_mercaderista and fecha = p_fecha;

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
