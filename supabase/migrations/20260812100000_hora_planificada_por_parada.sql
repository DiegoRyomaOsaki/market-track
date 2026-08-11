-- La hora esperada de cada parada, y de ahí puntualidad y asistencia.
--
-- Hoy `rutero_parada` solo tiene `orden`: se sabe en qué secuencia hay que ir,
-- no a qué hora se esperaba llegar. Sin eso no se puede afirmar que alguien
-- llegó tarde, y el plan de lealtad del mercaderista mide puntualidad y
-- asistencia como dos cosas distintas — "una cosa es que llegues tarde, pero
-- otra cosa es que ni siquiera llegues".
--
-- Aquí van los HECHOS: a qué hora se esperaba, a qué hora llegó, cuántos minutos
-- de desvío hay. El puntaje que salga de ellos es de otro ticket.

-- ---------------------------------------------------------------------------
-- La hora esperada.
--
-- `time` y no `timestamptz`: la fecha ya vive en `rutero.fecha`, y guardarla dos
-- veces es dejar que diverjan. El instante se arma juntando las dos en Lima.
--
-- Nullable a propósito: una parada sin hora esperada no es un incumplimiento, es
-- una parada de la que no se dijo nada. No puntúa puntualidad ni penaliza.
-- ---------------------------------------------------------------------------
alter table public.rutero_parada
  add column hora_planificada time;

comment on column public.rutero_parada.hora_planificada is
  'Hora local de Lima a la que se espera el check-in. NULL = no se fijó ninguna: la parada no puntúa puntualidad ni penaliza por ello.';

-- ---------------------------------------------------------------------------
-- La tolerancia, por cliente.
--
-- Ojo con qué es cada cosa: `minutos_desvio` es un HECHO ("llegó doce minutos
-- tarde") y la tolerancia es una POLÍTICA ("doce minutos todavía no es tarde").
-- Por eso la función de abajo devuelve las dos por separado y no solo el
-- veredicto: el día que el motor del plan de lealtad tenga su configuración
-- versionada —el puntaje se guarda con la config que usó— tendrá que resolver la
-- política con la suya, y este valor le queda de defecto.
-- ---------------------------------------------------------------------------
alter table public.tenant
  add column tolerancia_puntualidad_min integer not null default 15
    check (tolerancia_puntualidad_min >= 0);

comment on column public.tenant.tolerancia_puntualidad_min is
  'Minutos de gracia sobre la hora planificada antes de considerar tarde una llegada. Es política de puntaje, no un hecho: el desvío en minutos se expone crudo aparte.';

-- ---------------------------------------------------------------------------
-- Asistencia: TRES estados, no un booleano.
--
-- El criterio del negocio es que una parada sin visita al cierre del día es una
-- inasistencia, no un retraso de cero. Pero a media mañana una parada todavía no
-- visitada tampoco es una falta: es una pendiente. Con un booleano, el rutero de
-- hoy marcaría inasistencia en todas las paradas que aún no tocan y el puntaje
-- del mercaderista se hundiría en vivo para recuperarse por la tarde.
--
-- El corte es el día de LIMA. Un rutero de hoy sigue abierto hasta que el día
-- cierra allí, no en UTC — donde ya habría rodado a las 19:00.
-- ---------------------------------------------------------------------------
create type public.asistencia_parada as enum ('pendiente', 'asistio', 'falto');

create function public.puntualidad_paradas(
  p_mercaderista uuid,
  p_desde        date,
  p_hasta        date
)
returns table (
  parada_id          uuid,
  rutero_id          uuid,
  fecha              date,
  tienda_id          uuid,
  hora_planificada   time,
  check_in_at        timestamptz,
  minutos_desvio     integer,
  dentro_tolerancia  boolean,
  asistencia         public.asistencia_parada
)
language sql
stable
set search_path = ''
as $$
  select
    rp.id,
    r.id,
    r.fecha,
    rp.tienda_id,
    rp.hora_planificada,
    v.check_in_at,
    -- El desvío en minutos contra el instante esperado, que es la fecha del
    -- rutero más la hora planificada, interpretadas en Lima. Positivo = tarde.
    -- Nulo si no se fijó hora o si no llegó: "no se sabe" no es "cero".
    case
      when rp.hora_planificada is null or v.check_in_at is null then null
      else (extract(epoch from (
              v.check_in_at
              - ((r.fecha + rp.hora_planificada) at time zone 'America/Lima')
            )) / 60)::integer
    end,
    case
      when rp.hora_planificada is null or v.check_in_at is null then null
      else v.check_in_at
             <= ((r.fecha + rp.hora_planificada) at time zone 'America/Lima')
                + (t.tolerancia_puntualidad_min || ' minutes')::interval
    end,
    case
      when v.check_in_at is not null then 'asistio'::public.asistencia_parada
      when r.fecha < app.hoy_lima() then 'falto'::public.asistencia_parada
      else 'pendiente'::public.asistencia_parada
    end
  from public.rutero_parada rp
  join public.rutero r on r.id = rp.rutero_id
  join public.tenant t on t.id = rp.tenant_id
  left join public.visita v on v.rutero_parada_id = rp.id
  where r.mercaderista_id = p_mercaderista
    and r.fecha between p_desde and p_hasta
    -- Un rutero en borrador NO cuenta. Nunca se le pidió al mercaderista: es
    -- planificación a medio hacer del supervisor, y contarla como inasistencia
    -- le restaría por un trabajo que nadie le encargó.
    and r.estado <> 'borrador'
  order by r.fecha, rp.orden;
$$;

comment on function public.puntualidad_paradas(uuid, date, date) is
  'Los hechos de puntualidad y asistencia por parada: desvío en minutos contra la hora esperada (positivo = tarde) y si asistió. Una parada de un día que aún no cerró en Lima queda pendiente, no como falta; un rutero en borrador no cuenta. El puntaje que salga de esto se calcula aparte.';

revoke execute on function public.puntualidad_paradas(uuid, date, date) from public;
grant execute on function public.puntualidad_paradas(uuid, date, date)
  to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- La planeación devuelve la hora.
--
-- Se DROPEA antes de recrear. No es una manía: cambia el tipo de retorno, y ahí
-- `create or replace` falla en seco ("cannot change return type of existing
-- function"). Y aunque no cambiara, añadir un parámetro con default tampoco
-- reemplaza — deja las dos firmas vivas como sobrecargas.
-- ---------------------------------------------------------------------------
drop function if exists public.planeacion_ruteros(uuid, date, date);

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
  parada_estado public.estado_parada,
  hora_planificada time
)
language sql
stable
set search_path = ''
as $$
  select
    r.id, r.fecha, r.estado,
    rp.id, rp.orden, t.id, t.nombre, rp.estado, rp.hora_planificada
  from public.rutero r
  left join public.rutero_parada rp on rp.rutero_id = r.id
  left join public.tienda t on t.id = rp.tienda_id
  where r.mercaderista_id = p_mercaderista
    and r.fecha between p_desde and p_hasta
  order by r.fecha, rp.orden;
$$;

comment on function public.planeacion_ruteros(uuid, date, date) is
  'Los ruteros de un mercaderista en un rango de fechas, con sus paradas y la hora esperada de cada una. Alimenta la vista semanal y la mensual del panel: ambas son ventanas sobre las mismas filas diarias.';

revoke execute on function public.planeacion_ruteros(uuid, date, date) from public;
grant execute on function public.planeacion_ruteros(uuid, date, date)
  to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Fijar (o quitar) la hora de una parada.
--
-- `security definer` como sus hermanas de planeación: el staff diseña ruteros de
-- cualquier cliente, y el filtro por tenant lo pone la comprobación de rol, no la
-- RLS de la fila.
-- ---------------------------------------------------------------------------
-- `p_hora` con default: omitirlo es quitar la hora. El generador de tipos marca
-- todo parámetro sin default como requerido y no-nulo, así que sin esto la única
-- forma de limpiarla desde la app sería un cast a mano.
create function public.fijar_hora_parada(p_parada uuid, p_hora time default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not app.es_staff() then
    raise exception 'solo el staff diseña ruteros' using errcode = '42501';
  end if;

  update public.rutero_parada set hora_planificada = p_hora where id = p_parada;

  if not found then
    raise exception 'la parada % no existe', p_parada using errcode = 'P0002';
  end if;
end;
$$;

comment on function public.fijar_hora_parada(uuid, time) is
  'Fija la hora esperada de una parada. Omitir la hora (o pasar NULL) la quita. Solo staff.';

revoke execute on function public.fijar_hora_parada(uuid, time) from public;
grant execute on function public.fijar_hora_parada(uuid, time)
  to authenticated, service_role;
