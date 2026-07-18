-- Rol de replicación y publicación que PowerSync necesita en el Postgres de
-- origen. LOCAL / harness: en producción (Supabase Cloud) la integración de
-- PowerSync gestiona su propio usuario de replicación (MAR-63).
--
-- BYPASSRLS es literal: al replicar, PowerSync ve TODAS las filas. Por eso el
-- aislamiento de la bajada vive SOLO en las sync rules, no en la RLS.
-- La contraseña es de juguete y no sale del Docker local.
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'powersync_role') then
    create role powersync_role with replication bypassrls login password 'powersync_local';
  end if;
end $$;

grant select on all tables in schema public to powersync_role;
alter default privileges in schema public grant select on tables to powersync_role;

drop publication if exists powersync;
create publication powersync for all tables;
