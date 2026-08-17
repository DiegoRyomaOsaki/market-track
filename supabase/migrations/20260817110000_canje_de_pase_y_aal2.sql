-- El canje del pase de acceso temporal y la elevación de la sesión a `aal2`
-- (ADR-0008, punto 2).
--
-- El problema que resuelve: no existe API de admin/service_role que eleve una
-- sesión a `aal2` — GoTrue solo la sube al completar challenge+verify con el OTP
-- nativo. Y el pase existe justamente para quien NO recibe su OTP. Sin embargo,
-- TODO lo que exige el segundo factor lee el claim `aal` del JWT: la RLS
-- (`app.perfil_efectivo()`), el middleware del panel, las reglas de sincronización
-- del móvil (`auth.parameter('aal')`) y el guard de la app. Así que la forma de no
-- abrir un segundo camino de enforcement es que el pase termine escribiendo ESE
-- claim, y no que cada consumidor aprenda una excepción.
--
-- Cómo: la Edge Function `canjear-pase` valida el código y marca el pase como
-- usado POR UNA SESIÓN concreta (`usado_por_sesion` = el `session_id` del JWT
-- aal1 con el que llegó el mercaderista). A partir de ahí, el Custom Access Token
-- Hook —que GoTrue invoca cada vez que emite un access token para esa sesión, en
-- el login y en cada refresco— ve la marca y sube `aal` a `aal2`. Verificado en el
-- código de GoTrue (`internal/tokens/service.go`): las claims que devuelve el hook
-- se firman tal cual; sobre `aal` solo se comprueba que sea un string.
--
-- La elevación es una propiedad de la SESIÓN, exactamente como el aal2 nativo: la
-- retiene al refrescar y no se filtra a otro dispositivo (otro session_id). Y el
-- hook nunca degrada: un aal2 nativo se respeta tal cual.

-- --- El pase recuerda qué sesión lo usó ------------------------------------------
alter table public.pase_acceso_temporal
  add column usado_por_sesion uuid,
  -- Cota antifuerza-bruta del canje: un código de 6 dígitos con 15 minutos de vida
  -- se recorre a fuerza bruta si nadie cuenta los fallos. Lo cuenta la RPC de
  -- abajo, y al llegar al tope el pase se revoca solo.
  add column intentos_fallidos integer not null default 0
    check (intentos_fallidos >= 0),
  -- Un pase usado siempre dice QUÉ sesión lo usó: es lo que el hook consulta y lo
  -- que la auditoría necesita para responder "¿con qué sesión entró?".
  add constraint pase_uso_con_sesion
    check ((usado_at is null) = (usado_por_sesion is null));

-- El hook corre en CADA emisión de token de CADA usuario: la búsqueda por sesión
-- tiene que ser un index lookup. Único: una sesión canjea a lo sumo un pase.
create unique index pase_usado_por_sesion_uq
  on public.pase_acceso_temporal (usado_por_sesion)
  where usado_por_sesion is not null;

-- --- El canje: marcar el pase usado, atómicamente --------------------------------
--
-- Un solo UPDATE con el estado en el WHERE: bajo concurrencia, el segundo canje del
-- mismo pase espera el candado de fila, re-evalúa el predicado sobre la versión ya
-- marcada y no toca nada. Devuelve si ESTA llamada fue la que lo marcó.
--
-- Hereda de `app.estado_pase()` qué significa "vigente" (usado, revocado y vencido
-- se rechazan ahí, no aquí): un solo dueño de la regla.
--
-- La compara del código NO vive aquí: la hace la Edge Function en tiempo
-- constante contra `codigo_hash`. La base recibe el id del pase que coincidió.
create function public.canjear_pase(p_pase_id uuid, p_sesion_id uuid)
returns boolean
language sql
volatile
set search_path = ''
as $$
  with marcado as (
    update public.pase_acceso_temporal
    set usado_at = now(), usado_por_sesion = p_sesion_id
    where id = p_pase_id
      and app.estado_pase(usado_at, revocado_at, expira_at) = 'vigente'
    returning id
  )
  select exists (select 1 from marcado);
$$;

comment on function public.canjear_pase(uuid, uuid) is
  'Marca un pase vigente como usado por una sesión, atómicamente. Devuelve true solo si esta llamada lo marcó. La llama únicamente la Edge Function canjear-pase (service_role) tras comparar el código en tiempo constante.';

-- --- El intento fallido: contar, y quemar el pase al tope --------------------------
--
-- Se contabiliza sobre TODOS los pases vigentes del usuario, porque un código que
-- no coincide no dice a cuál apuntaba. Al llegar al tope el pase se revoca (el
-- trigger de revocación de una vía le pone el reloj del servidor). Devuelve
-- cuántos pases quemó este intento, para que la función lo deje en el log.
create function public.pase_intento_fallido(p_profile_id uuid)
returns integer
language sql
volatile
set search_path = ''
as $$
  with contado as (
    update public.pase_acceso_temporal
    set intentos_fallidos = intentos_fallidos + 1,
        -- 5 fallos por pase. Con el tope diario de 3 pases, quien tenga la
        -- contraseña del mercaderista dispone de 15 intentos sobre un millón de
        -- códigos por día.
        revocado_at = case when intentos_fallidos + 1 >= 5 then now() else revocado_at end
    where profile_id = p_profile_id
      and app.estado_pase(usado_at, revocado_at, expira_at) = 'vigente'
    returning revocado_at
  )
  select count(*)::integer from contado where revocado_at is not null;
$$;

comment on function public.pase_intento_fallido(uuid) is
  'Registra un intento de canje fallido sobre los pases vigentes del usuario; al quinto fallo el pase se revoca solo. Devuelve cuántos pases quemó. Solo la llama la Edge Function canjear-pase (service_role).';

-- Solo el servidor canjea y cuenta fallos. Sin el grant a `authenticated`, ninguna
-- de las dos es alcanzable por PostgREST con un JWT de usuario: un mercaderista no
-- puede marcarse un pase ni quemarle los pases a otro.
revoke execute on function public.canjear_pase(uuid, uuid) from public, anon, authenticated;
revoke execute on function public.pase_intento_fallido(uuid) from public, anon, authenticated;
grant execute on function public.canjear_pase(uuid, uuid) to service_role;
grant execute on function public.pase_intento_fallido(uuid) to service_role;

-- --- El hook: la única autoridad de `aal` fuera del OTP nativo -------------------
--
-- GoTrue lo invoca (`[auth.hook.custom_access_token]` en config.toml; en la nube,
-- Authentication → Hooks) antes de firmar cada access token, con las claims que
-- iba a emitir. Si la sesión canjeó un pase, sube `aal` a `aal2` y deja constancia
-- en `amr` de que el segundo factor fue el pase — el propio token dice cómo llegó
-- a aal2. Si no, devuelve el evento intacto. Nunca degrada un aal2 nativo.
--
-- `security definer`: corre como el dueño de la tabla, así el rol del hook
-- (`supabase_auth_admin`) no necesita grant ni política sobre la tabla del pase.
create function public.custom_access_token_hook(event jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  claims jsonb := event -> 'claims';
  sesion uuid;
  canje_usado_at timestamptz;
begin
  -- Nunca degrada: el aal2 nativo (OTP) se respeta tal cual.
  if claims ->> 'aal' = 'aal2' then
    return event;
  end if;

  -- Sin session_id legible no hay a qué atar la marca: el evento sigue intacto.
  begin
    sesion := (claims ->> 'session_id')::uuid;
  exception when others then
    return event;
  end;
  if sesion is null then
    return event;
  end if;

  select usado_at into canje_usado_at
  from public.pase_acceso_temporal
  where usado_por_sesion = sesion;
  if not found then
    return event;
  end if;

  claims := claims || jsonb_build_object(
    'aal', 'aal2',
    'amr', coalesce(claims -> 'amr', '[]'::jsonb) || jsonb_build_array(
      jsonb_build_object(
        'method', 'pase_acceso',
        'timestamp', extract(epoch from canje_usado_at)::bigint
      )
    )
  );
  return jsonb_set(event, '{claims}', claims);
end;
$$;

comment on function public.custom_access_token_hook(jsonb) is
  'Custom Access Token Hook de GoTrue. Sube `aal` a `aal2` cuando la sesión canjeó un pase de acceso temporal (marca `usado_por_sesion`); nunca degrada. Es la única forma de llegar a aal2 sin el OTP nativo, y todo enforcement (RLS, middleware, sync del móvil) sigue leyendo el mismo claim.';

-- Solo GoTrue lo ejecuta. Un usuario que pudiera invocarlo por PostgREST solo
-- obtendría un JSON, no un token —el token lo firma GoTrue—, pero no hay razón para
-- exponerlo.
grant usage on schema public to supabase_auth_admin;
revoke execute on function public.custom_access_token_hook(jsonb) from public, anon, authenticated;
grant execute on function public.custom_access_token_hook(jsonb) to supabase_auth_admin;
