-- Revalidación de geocerca y timestamp de servidor en la visita.
--
-- La geocerca que valida el TELÉFONO es solo UX: se puede burlar con un fake-GPS.
-- La seguridad está aquí, en el servidor, al sincronizar: se recalcula la
-- distancia contra la ubicación real de la tienda (PostGIS) y se sella la hora de
-- recepción, que el teléfono NO puede falsear.
--
-- No BLOQUEA la sincronización: una visita fuera de la geocerca entra igual, pero
-- queda MARCADA para que el supervisor la revise. Bloquear rompería el offline
-- (una coordenada mala no puede impedir subir una jornada de trabajo).

alter table public.visita
  -- Hora de recepción en el servidor. Autoritativa: el trigger la fija, el
  -- cliente no. Distinta de check_in_at/check_out_at, que son la HORA DE CAPTURA
  -- que declara el teléfono (una sugerencia, corroborada por el watermark).
  add column check_in_recibido_at  timestamptz not null default now(),
  add column check_out_recibido_at timestamptz,
  -- ¿La coordenada capturada cae dentro del radio de la tienda? Derivado por el
  -- servidor. NULL = no se pudo validar (sin coordenada o sin ubicación de tienda).
  add column check_in_geocerca_ok  boolean,
  add column check_out_geocerca_ok boolean;

comment on column public.visita.check_in_recibido_at is
  'Hora de recepción en servidor (autoritativa, la fija el trigger). check_in_at es la hora que declara el teléfono.';
comment on column public.visita.check_in_geocerca_ok is
  'Revalidación PostGIS de la geocerca en servidor. NULL = no validable. La del cliente es solo UX.';

-- SECURITY DEFINER: el trigger lee `tienda` (que el mercaderista quizá no ve por
-- RLS) para revalidar. search_path vacío por seguridad.
create function app.revalidar_geocerca_visita()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  ubic  extensions.geography;
  radio integer;
begin
  -- Sello de servidor: sobrescribe cualquier valor que mande el cliente.
  if tg_op = 'INSERT' then
    new.check_in_recibido_at := now();
  end if;
  if new.check_out_at is not null and new.check_out_recibido_at is null then
    new.check_out_recibido_at := now();
  end if;

  select t.ubicacion, t.radio_geocerca_m into ubic, radio
  from public.tienda t where t.id = new.tienda_id;

  -- ST_DWithin sobre geography mide en METROS. NULL si falta el dato: no validado.
  new.check_in_geocerca_ok := case
    when new.check_in_geo is null or ubic is null then null
    else extensions.st_dwithin(new.check_in_geo, ubic, radio)
  end;
  new.check_out_geocerca_ok := case
    when new.check_out_geo is null or ubic is null then null
    else extensions.st_dwithin(new.check_out_geo, ubic, radio)
  end;

  return new;
end;
$$;

create trigger revalidar_geocerca_visita
  before insert or update on public.visita
  for each row execute function app.revalidar_geocerca_visita();
