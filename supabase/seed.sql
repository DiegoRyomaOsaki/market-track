-- ⛔ NUNCA CONTRA UN PROYECTO REMOTO. ⛔
--
-- Este archivo crea un admin con la contraseña "password123". `supabase db push`
-- NO lo ejecuta (solo `db reset`, en local), pero `db reset --linked` o un
-- `psql -f seed.sql` contra la nube SÍ — y eso pondría un administrador con
-- contraseña trivial en la base de datos de un cliente real.
--
-- Datos de prueba. `supabase db reset` los carga solos.
--
-- Sirven para dos cosas: verificar los criterios de aceptación de esta migración,
-- y darle a los tests de aislamiento multi-tenant las fixtures que necesitan
-- (dos clientes distintos, un usuario por rol, y los casos de borde).
--
-- ⚠️ TRAMPA: las columnas de token de `auth.users` deben ir a '' (cadena vacía),
-- NUNCA a NULL. GoTrue está escrito en Go y no sabe escanear un NULL en un
-- string: el login muere con un 500 opaco — "Database error querying schema" —
-- que no dice nada de la causa. Se pierde media tarde averiguándolo.

-- Contraseña de todos los usuarios de prueba: "password123"
insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password,
  email_confirmed_at, created_at, updated_at,
  raw_app_meta_data, raw_user_meta_data,
  confirmation_token, recovery_token, email_change,
  email_change_token_new, email_change_token_current,
  phone_change, phone_change_token, reauthentication_token
)
select
  '00000000-0000-0000-0000-000000000000', u.id, 'authenticated', 'authenticated',
  u.email, extensions.crypt('password123', extensions.gen_salt('bf')),
  now(), now(), now(),
  '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb,
  '', '', '', '', '', '', '', ''   -- ← '' y no NULL. Ver la trampa de arriba.
from (values
  ('11111111-1111-1111-1111-111111111111'::uuid, 'admin@markettrack.pe'),
  ('22222222-2222-2222-2222-222222222222'::uuid, 'supervisor@markettrack.pe'),
  ('33333333-3333-3333-3333-333333333333'::uuid, 'brand@maracumango.pe'),
  ('44444444-4444-4444-4444-444444444444'::uuid, 'jose.quispe@markettrack.pe'),
  ('55555555-5555-5555-5555-555555555555'::uuid, 'desvinculado@markettrack.pe'),
  ('66666666-6666-6666-6666-666666666666'::uuid, 'merca.rival@markettrack.pe')
) as u (id, email);

-- Dos CLIENTES distintos: sin un segundo cliente no se puede probar que el
-- aislamiento funciona — solo que la consulta devuelve algo.
insert into public.tenant (id, nombre, activo) values
  ('aaaaaaaa-0000-0000-0000-000000000001', 'Maracumango', true),
  ('bbbbbbbb-0000-0000-0000-000000000002', 'Cliente Rival', true);

-- Maracumango tiene una sola marca (es el caso del piloto). El cliente rival
-- tiene otra: es la que ningún usuario de Maracumango debe llegar a ver jamás.
insert into public.marca (id, tenant_id, nombre, codigo_externo, tolerancia_precio_pct) values
  ('cccccccc-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000001', 'Maracumango', 'MRC', 5.00),
  ('cccccccc-0000-0000-0000-000000000002', 'aaaaaaaa-0000-0000-0000-000000000001', 'Maracumango Premium', 'MRC-P', 3.00),
  ('dddddddd-0000-0000-0000-000000000001', 'bbbbbbbb-0000-0000-0000-000000000002', 'Marca Rival', 'RIV', 10.00);

-- El staff de la outsourcing NO pertenece a ningún cliente (tenant_id null): lo
-- exige el CHECK `profile_tenant_segun_rol`.
insert into public.profile (id, rol, tenant_id, nombre, dni, supervisor_id, activo) values
  ('11111111-1111-1111-1111-111111111111', 'admin',      null, 'Admin Market Track', '10000001', null, true),
  ('22222222-2222-2222-2222-222222222222', 'supervisor', null, 'Ana Torres',         '10000002', null, true),
  ('33333333-3333-3333-3333-333333333333', 'cliente',    'aaaaaaaa-0000-0000-0000-000000000001', 'Luis Paredes', '10000003', null, true),
  ('44444444-4444-4444-4444-444444444444', 'mercaderista', 'aaaaaaaa-0000-0000-0000-000000000001', 'José Quispe', '10000004', '22222222-2222-2222-2222-222222222222', true),
  -- Caso de borde: desvinculado. Debe ver 0 marcas, pero SÍ su propia fila.
  ('55555555-5555-5555-5555-555555555555', 'mercaderista', 'aaaaaaaa-0000-0000-0000-000000000001', 'Merca Desvinculado', '10000005', '22222222-2222-2222-2222-222222222222', false),
  -- Caso de borde: mercaderista del OTRO cliente. Jamás debe ver nada de Maracumango.
  ('66666666-6666-6666-6666-666666666666', 'mercaderista', 'bbbbbbbb-0000-0000-0000-000000000002', 'Merca Rival', '10000006', null, true);
