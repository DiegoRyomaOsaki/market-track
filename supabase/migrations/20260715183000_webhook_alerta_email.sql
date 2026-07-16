-- Database Webhook: al insertarse una alerta relevante, avisa a la Edge Function
-- de email de forma ASÍNCRONA (pg_net). No bloquea la escritura del sync — si el
-- insert de la alerta tuviera que esperar una llamada HTTP, un Resend lento
-- frenaría la sincronización del mercaderista.
--
-- La URL de la función y el secreto del webhook vienen de settings por entorno
-- (no van en el repo). En local, si no están seteados, el trigger es un no-op:
-- no rompe el insert. El envío end-to-end se valida al desplegar.

create extension if not exists pg_net;

create function app.notificar_alerta_email()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  base_url text := current_setting('app.settings.functions_url', true);
  secret   text := current_setting('app.settings.alerta_webhook_secret', true);
begin
  -- Solo los tipos que van por email; el resto vive solo en el dashboard.
  if new.tipo not in ('quiebre', 'desviacion_precio') then
    return null;
  end if;

  -- Sin configurar (p.ej. local sin settings): no-op silencioso, no rompe nada.
  if base_url is null or base_url = '' then
    return null;
  end if;

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

revoke execute on function app.notificar_alerta_email() from public;

create trigger notificar_alerta_email
  after insert on public.alerta
  for each row execute function app.notificar_alerta_email();

-- Correos de los clientes (brand managers) de un tenant, en UNA consulta. La
-- Edge Function la llama por RPC en vez de iterar getUserById por cada cliente
-- (N+1). `auth.users` no está expuesta a PostgREST, así que este join va aquí,
-- SECURITY DEFINER. Vive en `public` (el único esquema que PostgREST expone, para
-- que `.rpc()` la encuentre) pero SOLO el service_role puede ejecutarla — se
-- revoca a public/anon/authenticated para que no sea un endpoint de fuga de
-- correos entre tenants.
create function public.correos_clientes_del_tenant(p_tenant uuid)
returns table (correo text)
language sql
security definer
set search_path = ''
as $$
  select u.email
  from public.profile p
  join auth.users u on u.id = p.id
  where p.tenant_id = p_tenant
    and p.rol = 'cliente'
    and p.activo
    and u.email is not null;
$$;

revoke execute on function public.correos_clientes_del_tenant(uuid)
  from public, anon, authenticated;
grant execute on function public.correos_clientes_del_tenant(uuid) to service_role;

-- La consulta filtra por (tenant_id, rol='cliente', activo): índice parcial para
-- que no escanee todos los perfiles del tenant (mayormente mercaderistas).
create index profile_tenant_cliente_activo_idx
  on public.profile (tenant_id)
  where rol = 'cliente' and activo;
