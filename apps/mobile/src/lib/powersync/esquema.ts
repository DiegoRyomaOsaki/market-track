import { column, Schema, Table } from "@powersync/react-native";

// El esquema de la réplica LOCAL (SQLite). Espeja las tablas que las sync rules
// de packages/sync le bajan al mercaderista. PowerSync solo tiene tres tipos:
//   - text: uuid, text, enum, date, timestamptz, jsonb (todo lo que no sea número)
//   - integer: enteros y booleanos (0/1)
//   - real: numeric y double
//
// El `id` es la PK implícita: no se declara. Las columnas no declaradas se
// ignoran al replicar, así que aquí van solo las que la app usa.

const tienda = new Table({
  tenant_id: column.text,
  cadena_id: column.text,
  nombre: column.text,
  direccion: column.text,
  radio_geocerca_m: column.integer,
  cluster: column.text,
  codigo_externo: column.text,
  activo: column.integer,
  lat: column.real,
  lon: column.real,
});

const cadena = new Table({
  tenant_id: column.text,
  nombre: column.text,
  tipo_tienda: column.text,
  codigo_externo: column.text,
  activo: column.integer,
});

const marca = new Table({
  tenant_id: column.text,
  nombre: column.text,
  logo_url: column.text,
  tolerancia_precio_pct: column.real,
  codigo_externo: column.text,
  activo: column.integer,
});

const sku = new Table({
  tenant_id: column.text,
  marca_id: column.text,
  codigo: column.text,
  nombre: column.text,
  presentacion: column.text,
  codigo_barras: column.text,
  codigo_externo: column.text,
  activo: column.integer,
});

const tienda_sku = new Table({
  tienda_id: column.text,
  sku_id: column.text,
  tenant_id: column.text,
  activo: column.integer,
});

const precio_regular = new Table({
  tenant_id: column.text,
  sku_id: column.text,
  cadena_id: column.text,
  tipo_tienda: column.text,
  precio: column.real,
  vigente_desde: column.text,
});

const promocion = new Table({
  tenant_id: column.text,
  sku_id: column.text,
  precio_promo: column.real,
  fecha_inicio: column.text,
  fecha_fin: column.text,
  clusters: column.text,
  comunicada: column.integer,
});

const rutero = new Table({
  tenant_id: column.text,
  mercaderista_id: column.text,
  fecha: column.text,
  estado: column.text,
});

const rutero_parada = new Table({
  tenant_id: column.text,
  rutero_id: column.text,
  tienda_id: column.text,
  orden: column.integer,
  estado: column.text,
});

const visita = new Table({
  tenant_id: column.text,
  rutero_parada_id: column.text,
  mercaderista_id: column.text,
  tienda_id: column.text,
  check_in_at: column.text,
  check_out_at: column.text,
  // Las coordenadas de captura, en EWKT (`SRID=4326;POINT(lon lat)`). Se guardan
  // aquí para que suban por el CRUD de PowerSync; el servidor re-valida la
  // geocerca con PostGIS (MAR-30) y llena los `*_geocerca_ok`.
  check_in_geo: column.text,
  check_out_geo: column.text,
  estado: column.text,
  bitacora: column.text,
  tiempo_traslado_min: column.integer,
  bateria_inicio_pct: column.integer,
  selfie_foto_id: column.text,
  check_in_geocerca_ok: column.integer,
  check_out_geocerca_ok: column.integer,
});

const levantamiento = new Table({
  tenant_id: column.text,
  visita_id: column.text,
  marca_id: column.text,
  sos_frentes_propios: column.integer,
  sos_frentes_competencia: column.text,
  estado: column.text,
  foto_antes_id: column.text,
  foto_despues_id: column.text,
  sos_foto_id: column.text,
  // Ancla a la versión de formulario que usó este levantamiento (ADR-0010): el
  // wizard renderiza ESA versión, no la última publicada.
  formulario_version_id: column.text,
});

const levantamiento_sku = new Table({
  tenant_id: column.text,
  levantamiento_id: column.text,
  sku_id: column.text,
  frentes_propios: column.integer,
  frentes_competencia: column.text,
  stock_sistema: column.integer,
  stock_piso: column.integer,
  quiebre: column.integer,
  diferencia: column.integer,
  precio_registrado: column.real,
  hay_promo: column.integer,
  promo_comunicada: column.integer,
  sos_foto_id: column.text,
});

const exhibicion_negociada = new Table({
  tenant_id: column.text,
  marca_id: column.text,
  tienda_id: column.text,
  tipo: column.text,
  sku_ids: column.text,
  cantidad_sugerida: column.integer,
  fecha_inicio: column.text,
  fecha_fin: column.text,
});

const exhibicion = new Table({
  tenant_id: column.text,
  levantamiento_id: column.text,
  exhibicion_negociada_id: column.text,
  tipo_adicional: column.text,
  instalada: column.integer,
  unidades: column.integer,
  completa: column.integer,
  vigente: column.integer,
  foto_id: column.text,
});

const contingencia = new Table({
  tenant_id: column.text,
  visita_id: column.text,
  levantamiento_id: column.text,
  paso: column.text,
  // El id del paso configurable omitido (null en los pasos fijos). Sin esto, los
  // pasos configurables —todos con paso 'campos_extra'— serían indistinguibles.
  paso_config_id: column.text,
  motivo: column.text,
  comentario: column.text,
  registrada_at: column.text,
  foto_id: column.text,
});

// El formulario configurable del levantamiento (ADR-0010). Baja publicado y
// activo (packages/sync); el jsonb `definicion` se replica como texto y se valida
// con Zod al leer (ver lib/formulario.ts).
const formulario_levantamiento = new Table({
  tenant_id: column.text,
  marca_id: column.text,
  nombre: column.text,
  activo: column.integer,
  creado_at: column.text,
});

const formulario_version = new Table({
  tenant_id: column.text,
  formulario_id: column.text,
  version: column.integer,
  definicion: column.text,
  publicada: column.integer,
  creada_at: column.text,
});

const levantamiento_respuesta = new Table({
  tenant_id: column.text,
  levantamiento_id: column.text,
  campo_id: column.text,
  valor: column.text,
});

const solicitud_cambio_ruta = new Table({
  tenant_id: column.text,
  mercaderista_id: column.text,
  rutero_id: column.text,
  fecha: column.text,
  tipo: column.text,
  motivo: column.text,
  estado: column.text,
  comentario_resolucion: column.text,
  resuelta_por: column.text,
  resuelta_at: column.text,
  creada_at: column.text,
});

const profile = new Table({
  rol: column.text,
  tenant_id: column.text,
});

// El resultado de la revisión de sus reportes (MAR-51). Solo lectura: el
// mercaderista no tiene política de escritura sobre esta tabla, y aquí no se
// declara `revisor_id` porque el nombre del supervisor no está en su réplica —
// enseñarle un uuid no aporta nada, y denormalizar el nombre metería una copia
// rancia de un dato de staff en todos los teléfonos. Lo que necesita saber es qué
// se decidió y por qué.
const revision_visita = new Table({
  tenant_id: column.text,
  visita_id: column.text,
  decision: column.text,
  motivo: column.text,
  revisado_at: column.text,
});

export const AppSchema = new Schema({
  tienda,
  cadena,
  marca,
  sku,
  tienda_sku,
  precio_regular,
  promocion,
  rutero,
  rutero_parada,
  visita,
  levantamiento,
  levantamiento_sku,
  exhibicion_negociada,
  exhibicion,
  contingencia,
  solicitud_cambio_ruta,
  profile,
  formulario_levantamiento,
  formulario_version,
  levantamiento_respuesta,
  revision_visita,
});
