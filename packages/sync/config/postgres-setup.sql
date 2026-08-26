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

-- El `alter` va FUERA del `if`, y ese es el punto: el `create` solo cubre el rol
-- que NO existe. Un rol que quedó con otra contraseña —o sin `replication`, o sin
-- `bypassrls`— hacía que la replicación muriera con un `28P01` que parece un
-- problema de entorno del desarrollador y no lo es.
--
-- Este fichero DECLARA el estado del rol; reejecutarlo lo restaura, exista como
-- exista. Medido: en la máquina donde salió esto, el rol ni siquiera existía y era
-- la causa real de que el harness fallara siete tests — el tiempo no se fue en
-- arreglarlo, se fue en no saber qué se estaba mirando.
alter role powersync_role with replication bypassrls login password 'powersync_local';

grant select on all tables in schema public to powersync_role;
alter default privileges in schema public grant select on tables to powersync_role;

-- La publicación se recrea SIEMPRE, y no es por gusto: `supabase db reset`
-- reconstruye la base y se la lleva por delante. O sea que esto no es un paso de
-- «una vez al clonar», es un paso de «después de cada reset» — y hasta hoy no lo
-- corría nadie, porque nada del repo ejecutaba este fichero.
drop publication if exists powersync;
create publication powersync for all tables;
