-- La identidad de una respuesta no se reescribe.
--
-- `levantamiento_respuesta` tiene `grant update` a nivel de TABLA, así que la
-- política `levresp_mercaderista_actualiza` deja cambiar cualquier columna
-- mientras la fila siga colgando de una visita del propio mercaderista. Eso
-- incluye `campo_id` y `levantamiento_id`: un PATCH podría mover una respuesta
-- a otro campo, o a otro levantamiento suyo, y el registro dejaría de decir lo
-- que se contestó. La app nunca lo hace —solo escribe `valor`— pero PostgREST
-- está abierto a cualquiera con la sesión.
--
-- POR QUÉ UN TRIGGER Y NO `grant update (valor)`
--
-- El grant por columna parece más limpio y era la primera opción del ticket,
-- pero rompería la sincronización del móvil. El conector reenvía los INSERT como
-- `upsert({...opData, id})`, que en PostgREST es `insert ... on conflict do
-- update` sobre TODAS las columnas; y el propio conector documenta que PowerSync
-- reintenta lotes enteros, así que un upsert sobre una fila que ya existe es el
-- caso normal, no el raro. Con el grant por columna ese reintento daría 42501,
-- que `esRechazoPermanente()` clasifica como definitivo: la operación se
-- descarta y el mercaderista pierde la respuesta que capturó en tienda.
--
-- El trigger no tiene ese problema. No le importa qué columnas trae el payload,
-- solo que esas dos no CAMBIEN — que es exactamente la invariante buscada. Un
-- upsert que reescribe `campo_id` con su mismo valor pasa sin ruido.

create function app.respuesta_identidad_inmutable()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.campo_id is distinct from old.campo_id then
    raise exception 'campo_id no se puede cambiar: una respuesta pertenece al campo que la originó'
      using errcode = 'check_violation';
  end if;
  if new.levantamiento_id is distinct from old.levantamiento_id then
    raise exception 'levantamiento_id no se puede cambiar: una respuesta no se mueve de levantamiento'
      using errcode = 'check_violation';
  end if;
  if new.tenant_id is distinct from old.tenant_id then
    raise exception 'tenant_id no se puede cambiar'
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

-- Postgres concede EXECUTE a PUBLIC al crear una función: sin este revoke queda
-- al alcance de cualquiera.
revoke execute on function app.respuesta_identidad_inmutable() from public;

comment on function app.respuesta_identidad_inmutable() is
  'Congela la identidad de una respuesta (campo, levantamiento y tenant). Un trigger y no un grant por columna: el upsert de reintento de PowerSync manda todas las columnas y un grant las rechazaría, descartando datos de campo.';

create trigger levantamiento_respuesta_identidad_inmutable
before update on public.levantamiento_respuesta
for each row execute function app.respuesta_identidad_inmutable();
