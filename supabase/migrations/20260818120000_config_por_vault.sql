-- La configuración de entorno que leen los webhooks (`app.settings.*`) pasa de
-- GUCs a `supabase_vault`, porque las GUCs NO SE PUEDEN PONER en un Supabase
-- gestionado y el runbook que decía cómo hacerlo nunca fue ejecutable.
--
-- Lo que se midió contra `market-track-staging` (Postgres 17.6), el 18 ago 2026:
--
--   alter database postgres set app.settings.functions_url = '…';
--   -- ERROR 42501: permission denied to set parameter "app.settings.functions_url"
--
-- Y las tres razones por las que no hay vuelta de hoja:
--
--   1. Desde Postgres 15, fijar un parámetro PLACEHOLDER (uno con prefijo, que
--      ningún módulo ha declarado) a nivel de base o de rol exige SUPERUSUARIO:
--      Postgres no sabe todavía qué contexto tendrá ese parámetro, así que
--      asume el más restrictivo.
--   2. En Supabase gestionado, `postgres` NO es superusuario (`rolsuper` =
--      false). El único que lo es, `supabase_admin`, es suyo y no se alcanza
--      desde fuera. Por eso `app.settings.jwt_exp` sí está puesta: la pone él.
--   3. No hay escapatoria por `grant set on parameter` (`pg_parameter_acl` solo
--      tiene `log_min_messages`) ni por la API de configuración del proyecto,
--      que responde `400: Unrecognized key: "app.settings.functions_url"` —
--      lista blanca de parámetros conocidos.
--
-- La consecuencia de haberlo creído: staging llevaba desde que existe sin enviar
-- un solo correo de alerta y con el barrido de fotos saliendo por el `return`,
-- las dos cosas en silencio, porque el no-op es deliberado (el trigger no puede
-- romper la escritura del sync, y en local no hay Resend ni R2 que consultar).
--
-- `supabase_vault` sí funciona con el rol `postgres`, cifra en reposo y lo leen
-- `postgres` y `service_role` y nadie más. Los valores se cargan una vez por
-- entorno con `vault.create_secret` (ver SETUP.md); al repositorio no llega
-- ninguno.

create extension if not exists supabase_vault with schema vault;

-- ---------------------------------------------------------------------------
-- El ÚNICO lector de la configuración de entorno. Que haya uno solo es lo que
-- permite que exista `app.config_faltante()` de abajo: si cada función buscara
-- su valor por su cuenta, no habría dónde preguntar qué falta.
--
-- Devuelve NULL cuando la clave no está cargada — y eso es un caso normal en
-- local, donde no hay a quién llamar. Quien delata ese hueco en la nube es el
-- paso de despliegue, no una excepción aquí: reventar dentro del trigger
-- rompería el INSERT de la alerta, que es el camino de sync del mercaderista.
-- ---------------------------------------------------------------------------
create function app.config(clave text)
returns text
language sql
security definer
stable
set search_path = ''
as $$
  select s.decrypted_secret
  from vault.decrypted_secrets s
  where s.name = clave;
$$;

comment on function app.config(text) is
  'Lee de supabase_vault un valor de configuración del entorno (functions_url, alerta_webhook_secret, foto_verificacion_secret). NULL si no está cargado. Único lector: ver app.config_faltante().';

-- Los tres revokes por separado: local y la nube conceden distinto por defecto,
-- y aquí la puerta importa más que en ninguna otra función del esquema — quien
-- pueda ejecutarla lee los secretos EN CLARO. `app` no está expuesto por
-- PostgREST, pero eso es una segunda cerradura, no la primera.
revoke execute on function app.config(text) from public;
revoke execute on function app.config(text) from anon;
revoke execute on function app.config(text) from authenticated;

-- ---------------------------------------------------------------------------
-- Qué configuración le falta a este entorno, POR NOMBRE y nunca por valor: la
-- respuesta viaja a los logs de un runner de CI, así que un secreto que saliera
-- de aquí quedaría escrito en texto plano para siempre.
--
-- La lista de claves obligatorias vive aquí y solo aquí. El script del
-- despliegue reporta lo que esta función diga; no tiene su propia copia que se
-- desincronice cuando alguien añada una cuarta clave.
-- ---------------------------------------------------------------------------
create function app.config_faltante()
returns text[]
language sql
security definer
stable
set search_path = ''
as $$
  select coalesce(array_agg(c.clave order by c.clave), '{}')
  from unnest(array[
    'functions_url',
    'alerta_webhook_secret',
    'foto_verificacion_secret'
  ]) as c(clave)
  where coalesce(app.config(c.clave), '') = '';
$$;

comment on function app.config_faltante() is
  'Los nombres (nunca los valores) de las claves de configuración que este entorno no tiene cargadas en el vault. La comprueba el despliegue: ver .github/workflows/deploy-supabase.yml.';

revoke execute on function app.config_faltante() from public;
revoke execute on function app.config_faltante() from anon;
revoke execute on function app.config_faltante() from authenticated;

-- ---------------------------------------------------------------------------
-- Los dos consumidores. Mismo comportamiento que antes salvo por de dónde sale
-- la configuración; el no-op silencioso se queda, porque su motivo no ha
-- cambiado: en local no hay a quién llamar y el trigger no puede romper el
-- INSERT.
-- ---------------------------------------------------------------------------

-- El orden importa: la guarda por tipo va ANTES de leer la configuración. En la
-- versión anterior los valores se resolvían en el `declare`, o sea en CADA fila
-- insertada en `alerta`, incluidas las de los tipos que no van por email —
-- ahora, además, cada lectura descifra.
create or replace function app.notificar_alerta_email()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  base_url text;
  secret   text;
begin
  -- Solo los tipos que van por email; el resto vive solo en el dashboard.
  if new.tipo not in ('quiebre', 'desviacion_precio') then
    return null;
  end if;

  base_url := app.config('functions_url');

  -- Sin configurar (p.ej. local): no-op silencioso, no rompe nada.
  if base_url is null or base_url = '' then
    return null;
  end if;

  secret := app.config('alerta_webhook_secret');

  perform net.http_post(
    url := base_url || '/enviar-alerta-email',
    body := jsonb_build_object('record', to_jsonb(new)),
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-webhook-secret', coalesce(secret, '')
    ),
    timeout_milliseconds := 5000
  );
  return null;
end;
$$;

create or replace function app.barrer_fotos_sin_verificar()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  base_url text := app.config('functions_url');
  secret   text := app.config('foto_verificacion_secret');
begin
  if base_url is null or base_url = '' then
    return;
  end if;
  perform net.http_post(
    url := base_url || '/fotos-verificar',
    body := jsonb_build_object('modo', 'barrer', 'limite', 100),
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-webhook-secret', coalesce(secret, '')
    ),
    timeout_milliseconds := 5000
  );
end;
$$;

comment on function app.barrer_fotos_sin_verificar() is
  'Pide a la Edge Function fotos-verificar que procese un lote de fotos subidas y sin verificar. La programa pg_cron cada 5 min. No-op si la clave functions_url no está en el vault.';
