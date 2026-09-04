-- La foto de resolución tiene que ser de LA MISMA visita que la incidencia.
--
-- Hallazgo de la revisión de seguridad de MAR-139. `incidencia_foto_fk` valida
-- `(foto_resolucion_id, tenant_id)`, y la política `incidencia_mercaderista_
-- atiende` comprueba que el mercaderista es dueño de la VISITA de la incidencia
-- — pero nadie comprueba que la foto referenciada sea de esa visita. Con un
-- PATCH a PostgREST se podía enlazar como prueba de la resolución cualquier
-- `foto.id` del mismo cliente.
--
-- Alcance real: no es exposición de fotos ajenas —la lectura de `foto` ya está
-- acotada a las visitas propias— es integridad de la evidencia. El panel
-- enseñaría como prueba de una resolución una foto que no es de esa visita.
--
-- Un CHECK no sirve: el predicado necesita una subconsulta contra `public.foto`.

create function app.foto_de_resolucion_es_de_la_visita()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.foto_resolucion_id is null then
    return new;
  end if;

  -- `update of <col>` se dispara aunque la columna vaya en el SET con el mismo
  -- valor. Sin esta guarda, cada PATCH del móvil relee `foto` sin motivo.
  if tg_op = 'UPDATE'
     and new.foto_resolucion_id is not distinct from old.foto_resolucion_id
     and new.visita_id is not distinct from old.visita_id then
    return new;
  end if;

  -- SECURITY DEFINER con el `tenant_id` explícito, no invoker. La comprobación
  -- tiene que ser determinista: con invoker dependería de la política de lectura
  -- de `foto`, que ya se ha reescrito tres veces, y un endurecimiento futuro de
  -- esa política convertiría esta verja en un rechazo de resoluciones legítimas.
  if not exists (
    select 1 from public.foto f
     where f.id = new.foto_resolucion_id
       and f.visita_id = new.visita_id
       and f.tenant_id = new.tenant_id
  ) then
    raise exception
      'la foto de resolucion % no pertenece a la visita %',
      new.foto_resolucion_id, new.visita_id
      using errcode = '23514';
  end if;

  return new;
end;
$$;

-- Postgres concede EXECUTE a PUBLIC al crear, y en la nube Supabase estampa
-- además un grant a `anon`: hacen falta los dos revokes. Que Postgres rechace
-- invocar una función de tipo trigger fuera de un trigger es una segunda verja,
-- no la primera.
revoke execute on function app.foto_de_resolucion_es_de_la_visita()
  from public, anon, authenticated, service_role;

-- `visita_id` entra en el `update of` aunque `authenticated` no tenga grant
-- sobre esa columna: cubre a `service_role` y a cualquier migración futura que
-- mueva una incidencia de visita.
create trigger foto_de_resolucion_es_de_la_visita
  before insert or update of foto_resolucion_id, visita_id
  on public.incidencia
  for each row execute function app.foto_de_resolucion_es_de_la_visita();

comment on function app.foto_de_resolucion_es_de_la_visita() is
  'La foto que prueba una resolución tiene que ser de la misma visita que la incidencia. La FK solo ata el tenant; esto ata la visita.';
