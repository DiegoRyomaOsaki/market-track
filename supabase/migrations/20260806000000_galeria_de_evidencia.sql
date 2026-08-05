-- La galería de evidencia del portal del cliente-marca: qué se fotografió, dónde
-- y cuándo, agrupado por punto de venta.
--
-- Devuelve `jsonb` y no un `returns table` porque es un árbol de cuatro niveles
-- —tienda → visita → marca → par antes/después—. Aplanarlo repetiría la cabecera
-- de tienda y de visita por cada foto y obligaría a reagrupar en TypeScript, que
-- es dar forma en la UI a algo que la base ya sabe. Los embeds anidados de
-- PostgREST tampoco valen: todas las FK de este esquema son COMPUESTAS.
--
-- La jerarquía no es un adorno: el par antes/después es POR MARCA dentro de la
-- visita, no por tienda. Una tienda con Oster y Sharpie tiene dos pares en cada
-- visita, en pasillos distintos, y el cliente tiene que verlo así o creerá que
-- faltan fotos.
--
-- `security invoker`: la RLS de `visita`, `tienda` y `foto` decide qué ve quien
-- llama. Ni un parámetro de tenant — nunca se elige inquilino por parámetro.

-- --- El desempate del par ------------------------------------------------------
--
-- Un levantamiento puede tener VARIAS fotos del mismo tipo: el móvil inserta una
-- fila por pulsación y nada deduplica. Sin un orden explícito, `jsonb_agg` no
-- garantiza cuál sale, y el comparador enseñaría una foto distinta en cada
-- refresco.
--
-- Gana la última palabra del mercaderista (la más reciente), y el id desempata
-- para que el resultado sea el mismo entre llamadas.
create function public.foto_del_levantamiento(
  p_visita uuid,
  p_levantamiento uuid,
  p_tipo public.tipo_foto,
  p_filtro public.tipo_foto
)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select case
    -- Con un filtro de tipo puesto, la ranura que no encaja se apaga: el cliente
    -- pidió ver solo un tipo y ver el par entero sería ignorarlo.
    when p_filtro is not null and p_filtro <> p_tipo then null
    else (
      select jsonb_build_object(
        'id', fo.id,
        'capturada_at', fo.capturada_at,
        'subida_at', fo.subida_at
      )
      from public.foto fo
      where fo.visita_id = p_visita
        and fo.levantamiento_id = p_levantamiento
        and fo.tipo = p_tipo
      order by fo.capturada_at desc, fo.id desc
      limit 1
    )
  end;
$$;

comment on function public.foto_del_levantamiento(uuid, uuid, public.tipo_foto, public.tipo_foto) is
  'La foto vigente de un tipo en un levantamiento: la más reciente, con el id como desempate para que el orden no dependa de jsonb_agg.';

grant execute on function public.foto_del_levantamiento(uuid, uuid, public.tipo_foto, public.tipo_foto)
  to authenticated, service_role;

create function public.galeria_evidencia(
  p_desde        date,
  p_hasta        date,
  p_cadena       uuid             default null,
  p_tienda       uuid             default null,
  p_tipo         public.tipo_foto default null,
  p_tope_visitas integer          default 24
)
returns jsonb
language sql
stable
set search_path = ''
as $$
  with visitas_ventana as (
    select v.id, v.tienda_id, v.check_in_at, v.check_out_at
    from public.visita v
    join public.tienda t on t.id = v.tienda_id
    where
      -- Ventana anclada en Lima y sargable: nunca `col::date between`, que
      -- castea por fila y tira el índice `(tenant_id, check_in_at desc)`.
      --
      -- Ancla en `check_in_at` y no en `foto.capturada_at`: una foto tomada sin
      -- señal y sincronizada tres días después caería en una ventana distinta
      -- que su propia visita, y el cliente vería evidencia sin su contexto.
      v.check_in_at >= (p_desde::timestamp at time zone 'America/Lima')
      and v.check_in_at < ((p_hasta + 1)::timestamp at time zone 'America/Lima')
      and (p_cadena is null or t.cadena_id = p_cadena)
      and (p_tienda is null or v.tienda_id = p_tienda)
    order by v.check_in_at desc
    -- Acotado donde nace. Sin tope, treinta días con cincuenta mercaderistas son
    -- miles de visitas en un solo jsonb y decenas de miles de URLs que firmar.
    -- Esto es un navegador de evidencia, no un almacén.
    limit p_tope_visitas
  ),
  total as (
    select count(*) as n
    from public.visita v
    join public.tienda t on t.id = v.tienda_id
    where v.check_in_at >= (p_desde::timestamp at time zone 'America/Lima')
      and v.check_in_at < ((p_hasta + 1)::timestamp at time zone 'America/Lima')
      and (p_cadena is null or t.cadena_id = p_cadena)
      and (p_tienda is null or v.tienda_id = p_tienda)
  )
  -- Cada nivel ordena por su COLUMNA, nunca por el jsonb recién construido:
  -- `order by x->>'campo'` hace que Postgres re-evalúe el `jsonb_build_object`
  -- entero —subconsultas de quiebres y fotos incluidas— solo para sacar la
  -- clave de orden. Medido: duplica el subplan por nivel, y aquí hay tres
  -- anidados.
  select jsonb_build_object(
    'visitas_totales', (select n from total),
    'truncado', (select n from total) > p_tope_visitas,
    'tiendas', coalesce((
      select jsonb_agg(x order by orden)
      from (
        select jsonb_build_object(
          'id', t.id,
          'nombre', t.nombre,
          'direccion', t.direccion,
          'cadena_nombre', ca.nombre,
          'visitas', (
            select jsonb_agg(y order by orden desc)
            from (
              select jsonb_build_object(
                'id', vv.id,
                'check_in_at', vv.check_in_at,
                'check_out_at', vv.check_out_at,
                'levantamientos', coalesce((
                  select jsonb_agg(z order by orden)
                  from (
                    select jsonb_build_object(
                      'id', le.id,
                      'marca_nombre', ma.nombre,
                      'estado', le.estado,
                      'sos_frentes_propios', le.sos_frentes_propios,
                      'quiebres', (
                        select count(*) from public.levantamiento_sku ls
                        where ls.levantamiento_id = le.id and ls.quiebre
                      ),
                      'antes', public.foto_del_levantamiento(vv.id, le.id, 'antes', p_tipo),
                      'despues', public.foto_del_levantamiento(vv.id, le.id, 'despues', p_tipo),
                      'otras', coalesce((
                        select jsonb_agg(jsonb_build_object(
                          'id', fo.id, 'tipo', fo.tipo,
                          'capturada_at', fo.capturada_at, 'subida_at', fo.subida_at
                        ) order by fo.capturada_at)
                        from public.foto fo
                        where fo.visita_id = vv.id
                          and fo.levantamiento_id = le.id
                          and fo.tipo not in ('selfie', 'antes', 'despues')
                          and (p_tipo is null or fo.tipo = p_tipo)
                      ), '[]'::jsonb)
                    ) as z, ma.nombre as orden
                    from public.levantamiento le
                    join public.marca ma on ma.id = le.marca_id
                    where le.visita_id = vv.id
                  ) niveles
                ), '[]'::jsonb),
                -- Las que no cuelgan de una marca: contingencias de la visita.
                -- La SELFIE nunca sale: es la cara de un empleado de la
                -- outsourcing, no evidencia de tienda. El guardián es este SQL,
                -- no el desplegable de la UI — por eso se excluye aquí aunque
                -- alguien pida `p_tipo := 'selfie'`.
                'fotos_visita', coalesce((
                  select jsonb_agg(jsonb_build_object(
                    'id', fo.id, 'tipo', fo.tipo,
                    'capturada_at', fo.capturada_at, 'subida_at', fo.subida_at
                  ) order by fo.capturada_at)
                  from public.foto fo
                  where fo.visita_id = vv.id
                    and fo.levantamiento_id is null
                    and fo.tipo <> 'selfie'
                    and (p_tipo is null or fo.tipo = p_tipo)
                ), '[]'::jsonb)
              ) as y, vv.check_in_at as orden
              from visitas_ventana vv
              where vv.tienda_id = t.id
            ) porVisita
          )
        ) as x, t.nombre as orden
        from public.tienda t
        join public.cadena ca on ca.id = t.cadena_id
        where exists (select 1 from visitas_ventana vv where vv.tienda_id = t.id)
      ) porTienda
    ), '[]'::jsonb)
  );
$$;

comment on function public.galeria_evidencia(date, date, uuid, uuid, public.tipo_foto, integer) is
  'La evidencia fotográfica de un periodo, agrupada por tienda → visita → marca. La selfie de check-in nunca sale. Acotada a `p_tope_visitas` visitas más recientes; `truncado` lo dice. La RLS decide qué ve quien llama: el staff vería todos los clientes, igual que en el resto del dashboard.';

grant execute on function public.galeria_evidencia(date, date, uuid, uuid, public.tipo_foto, integer)
  to authenticated, service_role;

-- La galería siempre busca las fotos de una visita acotando por levantamiento y
-- tipo, y se queda con la más reciente. Con el índice de `visita_id` a secas,
-- Postgres traía todas las fotos de la visita y filtraba en memoria.
create index if not exists foto_visita_lev_tipo_idx
  on public.foto (visita_id, levantamiento_id, tipo, capturada_at desc);

-- La selfie de check-in es la cara de un empleado de la outsourcing, y el
-- cliente-marca es una parte externa: no tiene por qué verla.
--
-- Excluirla en la galería no basta. `foto_usuario_lee_su_tenant` daba SELECT
-- sobre TODAS las fotos del tenant a cualquier rol, así que el cliente podía
-- pedir `foto?tipo=eq.selfie` por PostgREST, quedarse con el id y hacérselo
-- firmar por la función `fotos-url-firmada`, que firma lo que la RLS deje leer.
-- Verificado contra la base local: devolvía la fila.
--
-- El portador del dato es la política, no la consulta que lo agrupa: cualquier
-- pantalla futura que liste `foto` heredaba el agujero.
drop policy foto_usuario_lee_su_tenant on public.foto;
create policy foto_usuario_lee_su_tenant on public.foto for select to authenticated
  using (
    tenant_id = (select app.tenant_actual())
    and (tipo <> 'selfie' or (select app.rol_actual()) <> 'cliente')
  );

comment on policy foto_usuario_lee_su_tenant on public.foto is
  'El cliente-marca no lee la selfie de check-in: es un dato personal del mercaderista y el cliente es una parte externa. El staff y el propio mercaderista sí la ven.';
