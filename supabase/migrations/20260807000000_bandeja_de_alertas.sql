-- La bandeja de alertas del portal del cliente-marca: qué pasó, dónde, y en qué
-- punto del triage está.
--
-- `security invoker` en las dos funciones: la RLS de `alerta` decide qué ve quien
-- llama. Ni un parámetro de tenant — nunca se elige inquilino por parámetro.
--
-- El ciclo de estado NO necesita SQL: `alerta_usuario_marca_estado` ya restringe
-- la fila y el `grant update (estado)` de la migración de endurecimiento restringe
-- la columna. La evidencia es inmutable porque la base no deja escribirla, no
-- porque la UI no ofrezca el botón.

-- --- El uuid que viene dentro del payload -------------------------------------
--
-- El motor guarda `sku_id` y `exhibicion_id` como texto dentro del jsonb, no como
-- FK. Castear a ciegas hace que UNA fila con basura mate la consulta entera con
-- un error de tipo, y la pantalla acabe diciendo "no pudimos cargar las alertas"
-- cuando lo que falla es un registro.
create function app.uuid_del_payload(p_payload jsonb, p_clave text)
returns uuid
language sql
immutable
set search_path = ''
as $$
  select case
    when p_payload->>p_clave ~
      '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
    then (p_payload->>p_clave)::uuid
  end;
$$;

comment on function app.uuid_del_payload(jsonb, text) is
  'El uuid de una clave del payload de una alerta, o null si falta o no tiene forma de uuid. La guarda evita que una fila con basura tumbe la consulta entera.';

revoke execute on function app.uuid_del_payload(jsonb, text) from public;
grant execute on function app.uuid_del_payload(jsonb, text) to authenticated, service_role;

-- --- El índice de la bandeja ---------------------------------------------------
--
-- El índice existente `(tenant_id, estado, creado_at desc)` solo sirve cuando hay
-- igualdad en `estado`, y el estado es un filtro OPCIONAL: la bandeja por defecto
-- las trae todas.
--
-- El `id` va en el índice porque va en el ORDER BY, y va en el ORDER BY porque
-- las ~40 alertas de un mismo levantamiento nacen en la misma transacción y
-- comparten `creado_at` al milisegundo. Sin desempate, "las 50 más recientes"
-- no es un conjunto estable: la página 2 repetiría y omitiría filas al azar.
create index alerta_tenant_creado_id_idx
  on public.alerta (tenant_id, creado_at desc, id desc);

-- Y se retira el que acaba de quedar de sobra: `(tenant_id)` es prefijo estricto
-- del de arriba, así que toda consulta que lo usara puede usar el nuevo. Mantener
-- los dos solo cuesta escrituras, y aquí eso pesa: las ~40 alertas de un mismo
-- levantamiento se insertan de una vez.
drop index public.alerta_tenant_id_idx;

-- --- La bandeja ----------------------------------------------------------------
--
-- `returns table` y no jsonb: esto es una tabla, no un árbol. El jsonb de la
-- galería se justificaba por su jerarquía de cuatro niveles; aquí solo repetiría
-- trabajo de serialización.
--
-- `plpgsql` por el acotado de la paginación: repetir el `least(greatest(...))`
-- en el LIMIT y en el OFFSET es lo contrario de explícito.
create function public.bandeja_alertas(
  p_desde date,
  p_hasta date,
  p_cadena uuid default null,
  p_tienda uuid default null,
  p_tipo public.tipo_alerta default null,
  p_severidad public.severidad_alerta default null,
  p_estado public.estado_alerta default null,
  p_pagina integer default 1,
  p_por_pagina integer default 50
)
returns table (
  id uuid,
  tipo public.tipo_alerta,
  severidad public.severidad_alerta,
  estado public.estado_alerta,
  creado_at timestamptz,
  tienda_nombre text,
  cadena_nombre text,
  marca_nombre text,
  sku_codigo text,
  sku_nombre text,
  total bigint
)
language plpgsql
stable
set search_path = ''
as $$
declare
  -- Acotado en el servidor: la RPC es alcanzable directamente, no solo desde la
  -- UI, y un `p_por_pagina` enorme convierte una bandeja en una descarga.
  v_por_pagina integer := least(greatest(coalesce(p_por_pagina, 50), 1), 100);
  v_pagina     integer := greatest(coalesce(p_pagina, 1), 1);
begin
  return query
  select
    a.id, a.tipo, a.severidad, a.estado, a.creado_at,
    t.nombre, ca.nombre, ma.nombre, sk.codigo, sk.nombre,
    count(*) over () as total
  from public.alerta a
  -- LEFT y no INNER: `visita_id` y `marca_id` son nullable, y la contingencia de
  -- una VISITA (check-in/check-out) no cuelga de ninguna marca — es frecuente, no
  -- teórico. Con INNER, esas alertas desaparecerían en silencio de la bandeja.
  left join public.visita v on v.id = a.visita_id
  left join public.tienda t on t.id = v.tienda_id
  left join public.cadena ca on ca.id = t.cadena_id
  left join public.marca ma on ma.id = a.marca_id
  left join public.sku sk on sk.id = app.uuid_del_payload(a.payload, 'sku_id')
  -- La ventana es el día de calendario en LIMA, y sobre la columna cruda: un
  -- `creado_at::date between` anularía el índice.
  where a.creado_at >= (p_desde::timestamp at time zone 'America/Lima')
    and a.creado_at < ((p_hasta + 1)::timestamp at time zone 'America/Lima')
    and (p_cadena is null or t.cadena_id = p_cadena)
    and (p_tienda is null or v.tienda_id = p_tienda)
    and (p_tipo is null or a.tipo = p_tipo)
    and (p_severidad is null or a.severidad = p_severidad)
    and (p_estado is null or a.estado = p_estado)
  order by a.creado_at desc, a.id desc
  limit v_por_pagina offset (v_pagina - 1) * v_por_pagina;
end;
$$;

comment on function public.bandeja_alertas(date, date, uuid, uuid, public.tipo_alerta, public.severidad_alerta, public.estado_alerta, integer, integer) is
  'La bandeja de alertas del portal, paginada. `total` es el conteo de la ventana entera, no el de la página. La ventana se resuelve en America/Lima. La RLS acota al tenant de quien llama.';

-- Los DOS revokes, no uno: local concede vía PUBLIC y la nube deja un default
-- privilege explícito a `anon` sobre el esquema `public`. Revocar de uno solo
-- deja el agujero abierto en el otro entorno — está documentado en
-- `20260804190000_endurecer_funciones_del_primer_despliegue.sql`.
revoke execute on function public.bandeja_alertas(date, date, uuid, uuid, public.tipo_alerta, public.severidad_alerta, public.estado_alerta, integer, integer) from public;
revoke execute on function public.bandeja_alertas(date, date, uuid, uuid, public.tipo_alerta, public.severidad_alerta, public.estado_alerta, integer, integer) from anon;
grant execute on function public.bandeja_alertas(date, date, uuid, uuid, public.tipo_alerta, public.severidad_alerta, public.estado_alerta, integer, integer)
  to authenticated, service_role;

-- --- La foto de una alerta -----------------------------------------------------
--
-- Vive en el esquema `app` y no en `public` a propósito: PostgREST solo expone
-- `public`, así que aquí nadie puede invocarla por RPC eligiendo a mano la
-- visita, la marca y el payload. La llama `detalle_alerta`, que corre como el
-- llamante y por tanto bajo su misma RLS.
--
-- El payload no guarda un `foto_id`, y las FK que parecerían servir están MUERTAS:
-- `levantamiento_sku.sos_foto_id` y `exhibicion.foto_id` no las escribe nadie —el
-- móvil las deja en null a propósito, igual que `foto_antes_id`— porque la
-- evidencia se agrupa por `foto.tipo` y `foto.levantamiento_id`. La única viva es
-- `contingencia.foto_id`, que el modal del móvil sí rellena.
--
-- De ahí `del_hallazgo`: cuando es false, la foto es la del PASO de la visita, no
-- la de este SKU concreto. La pantalla tiene que decirlo. Enseñar la foto de
-- precio de la góndola como si fuera la del SKU que disparó la alerta es
-- inventarse la evidencia.
create function app.foto_de_la_alerta(
  p_visita uuid,
  p_marca uuid,
  p_tipo public.tipo_alerta,
  p_payload jsonb
)
returns jsonb
language sql
stable
set search_path = ''
as $$
  with elegida as (
    select fo.id, fo.capturada_at, fo.subida_at, false as del_hallazgo
    from public.foto fo
    join public.levantamiento le
      on le.id = fo.levantamiento_id and le.marca_id = p_marca
    where p_tipo <> 'contingencia'
      and fo.visita_id = p_visita
      and p_marca is not null
      and fo.tipo = case p_tipo
            when 'desviacion_precio' then 'precio'::public.tipo_foto
            when 'promo_no_activa' then 'precio'::public.tipo_foto
            when 'exhibicion_incompleta' then 'exhibicion'::public.tipo_foto
            else 'sos'::public.tipo_foto
          end
    -- La última palabra del mercaderista; el id desempata para que dos llamadas
    -- devuelvan lo mismo.
    order by fo.capturada_at desc, fo.id desc
    limit 1
  ),
  -- La contingencia sí guarda su foto: se empareja por el paso y el motivo que el
  -- motor copió al payload. Con dos contingencias idénticas en la misma visita el
  -- emparejamiento es ambiguo; el orden lo hace al menos determinista.
  de_contingencia as (
    select fo.id, fo.capturada_at, fo.subida_at, true as del_hallazgo
    from public.contingencia co
    join public.foto fo on fo.id = co.foto_id
    where p_tipo = 'contingencia'
      and co.visita_id = p_visita
      and co.paso::text = p_payload->>'paso'
      and co.motivo = p_payload->>'motivo'
    order by co.registrada_at desc, co.id desc
    limit 1
  )
  select jsonb_build_object(
    'id', f.id,
    'capturada_at', f.capturada_at,
    'subida_at', f.subida_at,
    'del_hallazgo', f.del_hallazgo
  )
  from (select * from de_contingencia union all select * from elegida) f
  limit 1;
$$;

comment on function app.foto_de_la_alerta(uuid, uuid, public.tipo_alerta, jsonb) is
  'La foto que respalda una alerta, o null si no hay ninguna. `del_hallazgo` en false significa que es la foto del paso de la visita y no la del hallazgo concreto: la pantalla debe rotularla como tal.';

revoke execute on function app.foto_de_la_alerta(uuid, uuid, public.tipo_alerta, jsonb) from public;
grant execute on function app.foto_de_la_alerta(uuid, uuid, public.tipo_alerta, jsonb)
  to authenticated, service_role;

-- --- El detalle ----------------------------------------------------------------
--
-- Devuelve el `payload` CRUDO más lo que hace falta unir para leerlo. Darle forma
-- de presentación es cosa de TypeScript: el SQL no sabe qué se llama "esperado" y
-- qué "registrado" en la pantalla.
--
-- `null` cuando no existe O no es del tenant de quien llama: los dos casos son
-- indistinguibles a propósito, para no confirmar la existencia de una alerta ajena.
create function public.detalle_alerta(p_alerta_id uuid)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_build_object(
    'id', a.id,
    'tipo', a.tipo,
    'severidad', a.severidad,
    'estado', a.estado,
    'creado_at', a.creado_at,
    'payload', a.payload,
    'tienda_nombre', t.nombre,
    'cadena_nombre', ca.nombre,
    'marca_nombre', ma.nombre,
    'sku_codigo', sk.codigo,
    'sku_nombre', sk.nombre,
    'visita_id', a.visita_id,
    'visita_check_in_at', v.check_in_at,
    'foto', app.foto_de_la_alerta(a.visita_id, a.marca_id, a.tipo, a.payload)
  )
  from public.alerta a
  left join public.visita v on v.id = a.visita_id
  left join public.tienda t on t.id = v.tienda_id
  left join public.cadena ca on ca.id = t.cadena_id
  left join public.marca ma on ma.id = a.marca_id
  left join public.sku sk on sk.id = app.uuid_del_payload(a.payload, 'sku_id')
  where a.id = p_alerta_id;
$$;

comment on function public.detalle_alerta(uuid) is
  'El detalle de una alerta con su evidencia resuelta, o null si no existe o no es del tenant de quien llama (indistinguibles a propósito). El payload va crudo: darle forma es cosa de la app.';

revoke execute on function public.detalle_alerta(uuid) from public;
revoke execute on function public.detalle_alerta(uuid) from anon;
grant execute on function public.detalle_alerta(uuid) to authenticated, service_role;
