-- ⛔ NUNCA CONTRA UN PROYECTO REMOTO. ⛔
--
-- Este archivo crea un admin con la contraseña "password123". `supabase db push`
-- NO lo ejecuta (solo `db reset`, en local), pero `db reset --linked` o un
-- `psql -f seed.sql` contra la nube SÍ — y eso pondría un administrador con
-- contraseña trivial en la base de datos de un cliente real.

do $$
begin
  -- El único entorno donde este archivo puede correr es el Supabase LOCAL, que
  -- se reconoce por su JWT secret de desarrollo — el mismo en todas las
  -- máquinas, publicado en la documentación de Supabase. Un proyecto de la nube
  -- ni siquiera expone ese ajuste (comprobado contra los dos proyectos del
  -- cliente), así que el `coalesce` lo deja en cadena vacía y esto aborta. Falla
  -- CERRADO: lo que no se pueda confirmar como local, se rechaza.
  if coalesce(current_setting('app.settings.jwt_secret', true), '') <>
     'super-secret-jwt-token-with-at-least-32-characters-long'
  then
    raise exception
      'seed.sql solo corre contra el Supabase LOCAL. Este no lo es: crearía un admin con contraseña "password123" en una base real.';
  end if;
end $$;
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
  ('66666666-6666-6666-6666-666666666666'::uuid, 'merca.rival@markettrack.pe'),
  ('77777777-7777-7777-7777-777777777777'::uuid, 'supervisor2@markettrack.pe')
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
  ('66666666-6666-6666-6666-666666666666', 'mercaderista', 'bbbbbbbb-0000-0000-0000-000000000002', 'Merca Rival', '10000006', null, true),
  -- Un SEGUNDO supervisor, sin equipo. Con uno solo, "el supervisor ve lo de los
  -- SUYOS" es indemostrable: cualquier fila que viera sería de un mercaderista
  -- suyo por descarte, y una política que dejara pasar todo pasaría el test igual.
  ('77777777-7777-7777-7777-777777777777', 'supervisor', null, 'Rosa Medina',       '10000007', null, true);

-- ---------------------------------------------------------------------------
-- Una CADENA OPERATIVA COMPLETA por cliente: de la cadena de retail hasta la
-- alerta, pasando por una visita con su levantamiento, foto y contingencia.
--
-- Por qué importa: el harness de aislamiento descubre las tablas del catálogo,
-- pero un test que corre sobre una tabla VACÍA pasa con la política puesta o
-- rota — es un verde vacuo. Con una fila por cliente en CADA tabla con
-- tenant_id, quitar una política hace fallar el test de verdad. Y las apps
-- arrancan contra datos realistas, no contra una base en blanco.
--
-- Esquema de UUIDs: `a0000NN-…-0001` = Maracumango, `b0000NN-…-0002` = rival;
-- NN es el número de entidad. El sufijo repite el tenant a propósito, para leer
-- de un vistazo a quién pertenece cada fila.
-- ---------------------------------------------------------------------------

-- tenant_id EXPLÍCITO siempre: las tablas del mercaderista tienen
-- `default app.tenant_actual()`, pero el seed corre como `postgres` sin JWT, así
-- que ese default daría NULL. Aquí se escribe a mano.

insert into public.cadena (id, tenant_id, nombre, codigo_externo) values
  ('a0000001-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000001', 'Plaza Vea', 'PV'),
  ('b0000001-0000-0000-0000-000000000002', 'bbbbbbbb-0000-0000-0000-000000000002', 'Tottus', 'TOT');

insert into public.tienda (id, tenant_id, cadena_id, nombre, codigo_externo, ubicacion) values
  ('a0000002-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000001', 'a0000001-0000-0000-0000-000000000001', 'Plaza Vea La Molina', 'PV-LM', 'SRID=4326;POINT(-76.94 -12.08)'::extensions.geography),
  ('b0000002-0000-0000-0000-000000000002', 'bbbbbbbb-0000-0000-0000-000000000002', 'b0000001-0000-0000-0000-000000000002', 'Tottus Angamos', 'TOT-AN', 'SRID=4326;POINT(-77.02 -12.11)'::extensions.geography);

-- La categoría es del CLIENTE, no de la marca: agrupa SKUs de varias marcas suyas.
insert into public.categoria (id, tenant_id, nombre, codigo_externo) values
  ('a0000004-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000001', 'Bebidas', 'BEB'),
  ('b0000004-0000-0000-0000-000000000002', 'bbbbbbbb-0000-0000-0000-000000000002', 'Bebidas rival', 'BEB-R');

-- El SKU de Maracumango va categorizado y el del rival NO, a propósito: el
-- segundo es el que mantiene vivo el caso "SKU sin categoría" que el despliegue
-- aditivo tiene que soportar.
insert into public.sku (id, tenant_id, marca_id, categoria_id, codigo, nombre) values
  ('a0000003-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000001', 'cccccccc-0000-0000-0000-000000000001', 'a0000004-0000-0000-0000-000000000001', 'MRC-001', 'Néctar Maracumango 1L'),
  ('b0000003-0000-0000-0000-000000000002', 'bbbbbbbb-0000-0000-0000-000000000002', 'dddddddd-0000-0000-0000-000000000001', null, 'RIV-001', 'Bebida Rival 1L');

-- La configuración de Perfect Store. Maracumango lleva DOS filas —el default de
-- marca y una que afina la categoría Bebidas— porque la resolución "gana la más
-- específica" no se puede probar con una sola.
insert into public.config_perfect_store
  (id, tenant_id, marca_id, categoria_id, tipo_tienda,
   peso_distribucion, peso_visibilidad, peso_precio, peso_pop, peso_orden,
   sos_objetivo_pct, vigente_desde) values
  ('a0000019-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000001',
   'cccccccc-0000-0000-0000-000000000001', null, null,
   30, 25, 25, 10, 10, 35, '2026-01-01'),
  ('a0000019-0000-0000-0000-000000000002', 'aaaaaaaa-0000-0000-0000-000000000001',
   'cccccccc-0000-0000-0000-000000000001', 'a0000004-0000-0000-0000-000000000001', null,
   40, 20, 20, 10, 10, 45, '2026-01-01'),
  ('b0000019-0000-0000-0000-000000000002', 'bbbbbbbb-0000-0000-0000-000000000002',
   'dddddddd-0000-0000-0000-000000000001', null, null,
   20, 30, 30, 10, 10, 30, '2026-01-01');

-- tienda_sku tiene PK compuesta (tienda_id, sku_id): no lleva `id`.
insert into public.tienda_sku (tenant_id, tienda_id, sku_id) values
  ('aaaaaaaa-0000-0000-0000-000000000001', 'a0000002-0000-0000-0000-000000000001', 'a0000003-0000-0000-0000-000000000001'),
  ('bbbbbbbb-0000-0000-0000-000000000002', 'b0000002-0000-0000-0000-000000000002', 'b0000003-0000-0000-0000-000000000002');

-- `vigente_desde` EXPLÍCITO y en el pasado, no el default. Sembrarlo con la fecha
-- de hoy hace que el precio no esté vigente para una visita del mismo día si la
-- base se sembró después de las 19:00 de Lima —cuando el día UTC ya rodó—, y toda
-- la regla de precio deja de encontrar contra qué comparar.
insert into public.precio_regular (id, tenant_id, sku_id, cadena_id, precio, vigente_desde) values
  ('a0000005-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000001', 'a0000003-0000-0000-0000-000000000001', 'a0000001-0000-0000-0000-000000000001', 6.90, '2026-01-01'),
  ('b0000005-0000-0000-0000-000000000002', 'bbbbbbbb-0000-0000-0000-000000000002', 'b0000003-0000-0000-0000-000000000002', 'b0000001-0000-0000-0000-000000000002', 5.50, '2026-01-01');

insert into public.promocion (id, tenant_id, sku_id, precio_promo, fecha_inicio, fecha_fin) values
  ('a0000006-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000001', 'a0000003-0000-0000-0000-000000000001', 5.90, '2026-07-01', '2026-07-31'),
  ('b0000006-0000-0000-0000-000000000002', 'bbbbbbbb-0000-0000-0000-000000000002', 'b0000003-0000-0000-0000-000000000002', 4.90, '2026-07-01', '2026-07-31');

insert into public.exhibicion_negociada (id, tenant_id, tienda_id, marca_id, tipo, fecha_inicio, fecha_fin) values
  ('a0000007-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000001', 'a0000002-0000-0000-0000-000000000001', 'cccccccc-0000-0000-0000-000000000001', 'cabecera', '2026-07-01', '2026-07-31'),
  ('b0000007-0000-0000-0000-000000000002', 'bbbbbbbb-0000-0000-0000-000000000002', 'b0000002-0000-0000-0000-000000000002', 'dddddddd-0000-0000-0000-000000000001', 'isla', '2026-07-01', '2026-07-31'),
  -- Material POP y activación (MAR-97), para que el wizard tenga qué enseñar en
  -- dev. Con fechas amplias a propósito: las de arriba caducaron en julio y el
  -- paso de exhibiciones del móvil todavía no filtra por vigencia.
  ('a0000007-0000-0000-0000-000000000003', 'aaaaaaaa-0000-0000-0000-000000000001', 'a0000002-0000-0000-0000-000000000001', 'cccccccc-0000-0000-0000-000000000001', 'jalavista', '2026-01-01', '2026-12-31'),
  ('a0000007-0000-0000-0000-000000000004', 'aaaaaaaa-0000-0000-0000-000000000001', 'a0000002-0000-0000-0000-000000000001', 'cccccccc-0000-0000-0000-000000000001', 'activacion', '2026-01-01', '2026-12-31');

-- El `estado` va EXPLÍCITO, no heredado del default. El harness de sync tiene un
-- caso que exige un rutero publicado como control positivo, y con el default
-- `borrador` no podía cumplirse nunca: un test imposible que además no se veía,
-- porque `test:sync` no corría en CI.
--
-- Y hacen falta LOS DOS estados para el mismo mercaderista. Con solo el publicado
-- no quedaría ningún borrador en la base, así que «no bajó ningún borrador» sería
-- trivialmente cierto — el test seguiría verde aunque se borrara el filtro por
-- estado de las sync rules. Se arreglaría una mentira instalando la contraria.
insert into public.rutero (id, tenant_id, mercaderista_id, fecha, estado) values
  ('a0000008-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000001', '44444444-4444-4444-4444-444444444444', '2026-07-14', 'borrador'),
  ('b0000008-0000-0000-0000-000000000002', 'bbbbbbbb-0000-0000-0000-000000000002', '66666666-6666-6666-6666-666666666666', '2026-07-14', 'borrador'),
  -- El control positivo. Fecha FUTURA a propósito: una parada publicada, pasada y
  -- sin visita cuenta como falta en `puntualidad_paradas`, y eso movería el
  -- Perfect Merchandiser de José desde el seed. Y fija, no calculada: una fecha
  -- relativa colisionaría con las que fijan los tests el día que coincidieran.
  ('a0000008-0000-0000-0000-000000000003', 'aaaaaaaa-0000-0000-0000-000000000001', '44444444-4444-4444-4444-444444444444', '2027-03-10', 'borrador');

insert into public.rutero_parada (id, tenant_id, rutero_id, tienda_id, orden) values
  ('a0000009-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000001', 'a0000008-0000-0000-0000-000000000001', 'a0000002-0000-0000-0000-000000000001', 1),
  ('b0000009-0000-0000-0000-000000000002', 'bbbbbbbb-0000-0000-0000-000000000002', 'b0000008-0000-0000-0000-000000000002', 'b0000002-0000-0000-0000-000000000002', 1),
  ('a0000009-0000-0000-0000-000000000003', 'aaaaaaaa-0000-0000-0000-000000000001', 'a0000008-0000-0000-0000-000000000003', 'a0000002-0000-0000-0000-000000000001', 1);

-- Se publica DESPUÉS de sembrar su parada, y el orden no es estético: el trigger
-- `parada_solo_se_planifica_en_borrador` rechaza un INSERT de parada sobre un
-- rutero que ya está publicado. Ponerlo publicado arriba abortaría el `db reset`
-- entero en la línea de las paradas.
update public.rutero set estado = 'publicado'
 where id = 'a0000008-0000-0000-0000-000000000003';

insert into public.visita (id, tenant_id, rutero_parada_id, mercaderista_id, tienda_id, check_in_geo) values
  ('a0000010-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000001', 'a0000009-0000-0000-0000-000000000001', '44444444-4444-4444-4444-444444444444', 'a0000002-0000-0000-0000-000000000001', 'SRID=4326;POINT(-76.94 -12.08)'::extensions.geography),
  ('b0000010-0000-0000-0000-000000000002', 'bbbbbbbb-0000-0000-0000-000000000002', 'b0000009-0000-0000-0000-000000000002', '66666666-6666-6666-6666-666666666666', 'b0000002-0000-0000-0000-000000000002', 'SRID=4326;POINT(-77.02 -12.11)'::extensions.geography);

insert into public.levantamiento (id, tenant_id, visita_id, marca_id) values
  ('a0000011-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000001', 'a0000010-0000-0000-0000-000000000001', 'cccccccc-0000-0000-0000-000000000001'),
  ('b0000011-0000-0000-0000-000000000002', 'bbbbbbbb-0000-0000-0000-000000000002', 'b0000010-0000-0000-0000-000000000002', 'dddddddd-0000-0000-0000-000000000001');

insert into public.levantamiento_sku (id, tenant_id, levantamiento_id, sku_id, stock_sistema, stock_piso, precio_registrado) values
  ('a0000012-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000001', 'a0000011-0000-0000-0000-000000000001', 'a0000003-0000-0000-0000-000000000001', 20, 0, 6.90),
  ('b0000012-0000-0000-0000-000000000002', 'bbbbbbbb-0000-0000-0000-000000000002', 'b0000011-0000-0000-0000-000000000002', 'b0000003-0000-0000-0000-000000000002', 15, 3, 5.50);

insert into public.exhibicion (id, tenant_id, levantamiento_id, exhibicion_negociada_id, instalada) values
  ('a0000013-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000001', 'a0000011-0000-0000-0000-000000000001', 'a0000007-0000-0000-0000-000000000001', true),
  ('b0000013-0000-0000-0000-000000000002', 'bbbbbbbb-0000-0000-0000-000000000002', 'b0000011-0000-0000-0000-000000000002', 'b0000007-0000-0000-0000-000000000002', true);

insert into public.contingencia (id, tenant_id, visita_id, paso, motivo, registrada_at) values
  ('a0000014-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000001', 'a0000010-0000-0000-0000-000000000001', 'precios', 'Góndola en remodelación, no se pudo verificar precio', now()),
  ('b0000014-0000-0000-0000-000000000002', 'bbbbbbbb-0000-0000-0000-000000000002', 'b0000010-0000-0000-0000-000000000002', 'exhibiciones', 'Cabecera ocupada por otra marca', now());

-- El PAR antes/después de cada marca, colgado de su levantamiento: es de ahí de
-- donde lo lee la galería del portal (`foto.tipo` + `foto.levantamiento_id`), no
-- de `levantamiento.foto_antes_id`, que está muerta a propósito.
--
-- Sin el par, cualquier test de galería devolvería un árbol vacío y pasaría igual
-- con la función bien o rota. Y la selfie está para comprobar que NO sale al
-- portal: es la cara de un empleado de la outsourcing, no evidencia de tienda.
--
-- Ninguna lleva `subida_at`: reproduce el estado real de un teléfono que capturó
-- pero aún no subió, que es lo que el panel y la galería tienen que saber decir.
insert into public.foto (id, tenant_id, visita_id, levantamiento_id, tipo, capturada_at) values
  ('a0000015-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000001', 'a0000010-0000-0000-0000-000000000001', 'a0000011-0000-0000-0000-000000000001', 'antes', now()),
  ('a0000015-0000-0000-0000-000000000003', 'aaaaaaaa-0000-0000-0000-000000000001', 'a0000010-0000-0000-0000-000000000001', 'a0000011-0000-0000-0000-000000000001', 'despues', now()),
  ('a0000015-0000-0000-0000-000000000004', 'aaaaaaaa-0000-0000-0000-000000000001', 'a0000010-0000-0000-0000-000000000001', null, 'selfie', now()),
  ('b0000015-0000-0000-0000-000000000002', 'bbbbbbbb-0000-0000-0000-000000000002', 'b0000010-0000-0000-0000-000000000002', 'b0000011-0000-0000-0000-000000000002', 'antes', now()),
  ('b0000015-0000-0000-0000-000000000005', 'bbbbbbbb-0000-0000-0000-000000000002', 'b0000010-0000-0000-0000-000000000002', 'b0000011-0000-0000-0000-000000000002', 'despues', now());

insert into public.alerta (id, tenant_id, tipo, marca_id, visita_id) values
  ('a0000016-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000001', 'quiebre', 'cccccccc-0000-0000-0000-000000000001', 'a0000010-0000-0000-0000-000000000001'),
  ('b0000016-0000-0000-0000-000000000002', 'bbbbbbbb-0000-0000-0000-000000000002', 'quiebre', 'dddddddd-0000-0000-0000-000000000001', 'b0000010-0000-0000-0000-000000000002');

insert into public.importacion (id, tenant_id, subido_por) values
  ('a0000017-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111'),
  ('b0000017-0000-0000-0000-000000000002', 'bbbbbbbb-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111');

insert into public.mapeo_importacion (id, tenant_id, nombre, mapeo, creado_por) values
  ('a0000018-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000001', 'Plantilla precios Maracumango', '{"codigo":"SKU","precio":"PRECIO"}'::jsonb, '11111111-1111-1111-1111-111111111111'),
  ('b0000018-0000-0000-0000-000000000002', 'bbbbbbbb-0000-0000-0000-000000000002', 'Plantilla precios rival', '{"codigo":"COD","precio":"PVP"}'::jsonb, '11111111-1111-1111-1111-111111111111');

-- Config de módulos del portal (MAR-74): modelo DISPERSO, solo se guarda lo que
-- el admin DESHABILITA. Cada cliente deshabilita uno para que el test de
-- aislamiento tenga algo que filtrar si una política se rompe; el resto de
-- módulos quedan habilitados por defecto (coalesce).
insert into public.portal_modulo_habilitado (tenant_id, modulo, habilitado) values
  ('aaaaaaaa-0000-0000-0000-000000000001', 'reportes', false),
  ('bbbbbbbb-0000-0000-0000-000000000002', 'galeria', false);

-- La configuración del plan de lealtad del mercaderista (MAR-100) y su escalera
-- de bonos. Los DOS clientes la llevan: sin la del rival, el test de aislamiento
-- contaría filas sobre una tabla que solo tiene datos de uno y pasaría en verde
-- aunque la política se rompiera.
--
-- `vigente_desde` explícito y en el pasado, como el resto del seed: con el
-- default (hoy en Lima) un periodo que empieza antes no encontraría configuración
-- y el motor no calcularía nada.
insert into public.config_perfect_merchandiser
  (id, tenant_id, peso_puntualidad, peso_asistencia, peso_tiempo_efectivo,
   peso_calidad, peso_herramientas, tolerancia_puntualidad_min,
   minutos_tardanza_cero, dias_gracia_cierre, vigente_desde) values
  ('a0000021-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000001',
   25, 30, 0, 25, 20, 15, 60, 7, '2026-01-01'),
  ('b0000021-0000-0000-0000-000000000002', 'bbbbbbbb-0000-0000-0000-000000000002',
   20, 40, 0, 30, 10, 10, 45, 7, '2026-01-01');

-- La escalera: tres peldaños. El puntaje por debajo del más bajo no cobra bono,
-- que es un estado que el motor tiene que saber representar.
insert into public.nivel_bono_merchandiser
  (id, tenant_id, vigente_desde, nombre, puntaje_min, monto) values
  ('a0000022-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000001', '2026-01-01', 'Bronce', 60, 100.00),
  ('a0000022-0000-0000-0000-000000000002', 'aaaaaaaa-0000-0000-0000-000000000001', '2026-01-01', 'Plata',  80, 250.00),
  ('a0000022-0000-0000-0000-000000000003', 'aaaaaaaa-0000-0000-0000-000000000001', '2026-01-01', 'Oro',    95, 500.00),
  ('b0000022-0000-0000-0000-000000000002', 'bbbbbbbb-0000-0000-0000-000000000002', '2026-01-01', 'Único',  70, 200.00);
