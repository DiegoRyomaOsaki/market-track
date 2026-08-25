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
  // La hora esperada de llegada, `HH:MM:SS` de Lima. El stream baja la tabla
  // entera, pero una columna que no se declara aquí no existe en la réplica.
  hora_planificada: column.text,
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
  // Ancla a la versión del formulario de check-in que se mostró al fichar
  // (MAR-98): dice qué ítems se pidieron aunque no se contestara ninguno.
  formulario_version_id: column.text,
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
  // 'levantamiento' o 'check_in' (MAR-98). Null en una réplica anterior a la
  // migración que lo añadió: se interpreta como 'levantamiento' al resolver.
  ambito: column.text,
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

// Las respuestas del checklist de check-in (MAR-98): como
// `levantamiento_respuesta`, pero colgando de la VISITA.
const visita_respuesta = new Table({
  tenant_id: column.text,
  visita_id: column.text,
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

// La METADATA de la foto. El binario nunca entra aquí: va por la cola de disco a
// R2 (ADR-0003). `subida_at` es la única señal de "ya está en la nube" — la
// escribe el subidor tras confirmar el PUT, y el panel la lee para saber qué
// evidencia sigue en el teléfono.
//
// A propósito NO se declaran `verificada_at`, `bytes_r2` ni
// `verificacion_intento_at`: las escribe solo el servidor y un trigger rechaza
// cualquier valor que venga de la app. Si estuvieran aquí, el upsert de fila
// entera con que el conector reintenta las mandaría, el servidor lo rechazaría
// y `esRechazoPermanente()` descartaría la foto. El SDK descarta las columnas
// que bajan y no están declaradas, así que el stream `SELECT * FROM foto` no
// las trae a la réplica.
const foto = new Table({
  tenant_id: column.text,
  visita_id: column.text,
  levantamiento_id: column.text,
  tipo: column.text,
  hash: column.text,
  capturada_at: column.text,
  // EWKT (`SRID=4326;POINT(lon lat)`), como `visita.check_in_geo`.
  geo: column.text,
  subida_at: column.text,
});

// El plan de lealtad: SOLO la fila propia (packages/sync lo acota por
// `auth.user_id()`, y eso es lo que cumple la decisión del cliente — la RLS no
// interviene en la bajada).
//
// `posicion`, `mercaderistas_evaluados` y `hay_empate` vienen CALCULADAS del
// servidor y no se derivan aquí: con una sola fila no hay rango que calcular, y
// recalcularlo dejaría al panel diciendo "2.º" y al teléfono "3.º".
//
// El `id` no se declara —es la PK implícita de PowerSync—, pero en esta tabla es
// una columna SUSTITUTA: la clave real es `(mercaderista_id, tipo,
// periodo_inicio)`. Sin ella, todos los periodos de una persona colapsarían en
// una fila local y la evolución desaparecería.
//
// A propósito NO se declaran `nivel_bono_id` ni el monto del bono: el ticket no
// los pide y el stream tampoco los baja.
const puntaje_merchandiser = new Table({
  mercaderista_id: column.text,
  tenant_id: column.text,
  tipo: column.text,
  periodo_inicio: column.text,
  total_pct: column.real,
  puntualidad_pct: column.real,
  asistencia_pct: column.real,
  calidad_pct: column.real,
  herramientas_pct: column.real,
  posicion: column.integer,
  mercaderistas_evaluados: column.integer,
  // Booleano → 0/1: PowerSync no tiene tipo booleano.
  hay_empate: column.integer,
  paradas_evaluables: column.integer,
  paradas_asistidas: column.integer,
  paradas_con_hora: column.integer,
  paradas_puntuales: column.integer,
  campos_obligatorios: column.integer,
  campos_respondidos: column.integer,
  fotos_esperadas: column.integer,
  fotos_presentes: column.integer,
  items_checklist: column.integer,
  items_cumplidos: column.integer,
  calculado_at: column.text,
  cerrado_at: column.text,
});

// El Perfect Store de SUS levantamientos: lo que deja a "Mi día" decir cómo
// quedó la tienda la última vez. Aquí el `id` de PowerSync ES el
// `levantamiento_id` (lo aliasa la sync rule, la relación es 1:1), así que se
// une por `puntaje_perfect_store.id = levantamiento.id`.
//
// Solo lectura: la app nunca escribe esta tabla ni la anterior. El puntaje lo
// produce el servidor, y el `grant` de la base rechazaría cualquier intento.
const puntaje_perfect_store = new Table({
  tenant_id: column.text,
  levantamiento_id: column.text,
  total_pct: column.real,
  calculado_at: column.text,
});

// De la configuración del plan solo baja la PERIODICIDAD — los pesos son la
// política laboral del cliente. Sin ella el móvil tendría que adivinar qué
// `tipo` de periodo mirar, y el 1 de enero es inicio de los tres.
const config_perfect_merchandiser = new Table({
  tenant_id: column.text,
  periodicidad: column.text,
  vigente_desde: column.text,
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
  visita_respuesta,
  revision_visita,
  foto,
  puntaje_merchandiser,
  puntaje_perfect_store,
  config_perfect_merchandiser,
});
