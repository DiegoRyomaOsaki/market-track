-- Índices para el orden de los listados comerciales del panel.
--
-- Las tres vistas ordenan por fecha descendente dentro del cliente activo
-- (`tenant_id = X order by fecha desc`), y ninguna tabla tenía índice por la
-- fecha: con solo `(tenant_id)`, Postgres encuentra las filas del cliente pero
-- ORDENA a mano el resultado entero — y `precio_regular` nunca sobreescribe
-- (la vigencia es parte de su clave natural), así que ese resultado solo crece.
--
-- El índice de una sola columna se retira: es un prefijo estricto del compuesto
-- y mantener los dos duplicaría la amplificación de escritura justo en la tabla
-- que el importador llena a granel. Retirarlo es seguro también a media
-- distribución: cualquier plan que usara el viejo puede usar el nuevo.
--
-- El `id` va DENTRO del índice y no solo en el `order by`: es el desempate que
-- hace estable la paginación, y con fechas repetidas —cada import deja lotes
-- con la misma vigencia— un índice sin él obliga a ordenar el grupo entero de
-- la fecha más reciente para servir la primera página. Medido con 40.000 filas
-- y dos vigencias: Seq Scan + top-N (12 ms) contra Index Scan puro (<1 ms).
--
-- Sin `concurrently` a propósito: `supabase db reset` corre las migraciones en
-- una transacción y `create index concurrently` no puede vivir en una.

create index precio_regular_tenant_vigente_idx
  on public.precio_regular (tenant_id, vigente_desde desc, id);
drop index public.precio_regular_tenant_id_idx;

create index promocion_tenant_inicio_idx
  on public.promocion (tenant_id, fecha_inicio desc, id);
drop index public.promocion_tenant_id_idx;

create index exh_neg_tenant_inicio_idx
  on public.exhibicion_negociada (tenant_id, fecha_inicio desc, id);
drop index public.exh_neg_tenant_id_idx;
