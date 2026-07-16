-- Expone la ubicación de la tienda como lat/lon legibles por el panel.
--
-- El PORQUÉ: `tienda.ubicacion` es `geography(Point,4326)`, y PostgREST la
-- serializa como EWKB en hexadecimal — `0101000020E61000005C8FC2F5283C53C0…`.
-- Eso no se puede pintar en un mapa ni meter en un formulario sin decodificarlo
-- en el navegador, que es trabajo que Postgres ya sabe hacer.
--
-- Por qué COLUMNAS GENERADAS y no una vista: una vista sería una superficie
-- nueva que el harness de aislamiento NO mira (descubre tablas por
-- `relkind = 'r'`), y que sin `security_invoker = true` correría con los
-- permisos de su dueño y saltaría la RLS en silencio. Aquí no hay nada que
-- decidir: es la misma tabla, con su misma RLS y sus mismos grants, y los tipos
-- generados las traen solas.
--
-- Siguen siendo DERIVADAS y con un solo dueño: las calcula Postgres al escribir.
-- La fuente de verdad es `ubicacion`; nadie escribe lat/lon a mano (Postgres lo
-- impide: una columna generada es de solo lectura).
alter table public.tienda
  add column lat double precision
    generated always as (extensions.st_y(ubicacion::extensions.geometry)) stored,
  add column lon double precision
    generated always as (extensions.st_x(ubicacion::extensions.geometry)) stored;

comment on column public.tienda.lat is
  'Derivada de ubicacion (PostGIS). Solo lectura: se escribe ubicacion como EWKT, p. ej. SRID=4326;POINT(lon lat).';
comment on column public.tienda.lon is
  'Derivada de ubicacion (PostGIS). Solo lectura: se escribe ubicacion como EWKT, p. ej. SRID=4326;POINT(lon lat).';
