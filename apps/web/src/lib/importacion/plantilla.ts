// El formato del Excel del maestro comercial: qué hojas hay y qué columnas trae
// cada una. UN SOLO DUEÑO — el parseo lo lee, la validación lo lee, y la pantalla
// que genere la plantilla descargable (MAR-45) también. Con una segunda copia, el
// día que se añada una columna el archivo que descarga el cliente y el que el
// importador espera dejan de coincidir.
//
// El mapeo flexible de columnas del Excel PROPIO del cliente es otro ticket
// (MAR-46). Aquí se asume esta plantilla.

/** Las entidades del maestro, en el orden en que hay que escribirlas. */
export const HOJAS = [
  "marca",
  "cadena",
  "sku",
  "tienda",
  "tienda_sku",
  "precio_regular",
  "promocion",
] as const;

export type Hoja = (typeof HOJAS)[number];

/**
 * Las columnas de cada hoja, en orden.
 *
 * `codigo_externo` es obligatorio en TODAS las maestras aunque la columna sea
 * nullable en la base. Es la clave natural del upsert: sin ella, `unique
 * (tenant_id, codigo_externo)` no colisiona —en SQL dos NULL son distintos— y el
 * segundo import duplicaría el catálogo entero. La columna sigue nullable porque
 * el alta manual del panel sí permite crear sin código; la obligatoriedad es de
 * la plantilla, no del esquema.
 */
export const COLUMNAS: Record<Hoja, readonly string[]> = {
  marca: ["codigo_externo", "nombre", "tolerancia_precio_pct"],
  cadena: ["codigo_externo", "nombre", "tipo_tienda"],
  sku: [
    "codigo_externo",
    "marca_codigo_externo",
    "codigo",
    "nombre",
    "presentacion",
    "codigo_barras",
  ],
  tienda: [
    "codigo_externo",
    "cadena_codigo_externo",
    "nombre",
    "direccion",
    "lat",
    "lon",
    "radio_geocerca_m",
    "cluster",
  ],
  tienda_sku: ["tienda_codigo_externo", "sku_codigo_externo"],
  precio_regular: [
    "sku_codigo_externo",
    "cadena_codigo_externo",
    "tipo_tienda",
    "precio",
    // Parte de la clave natural: sin ella, reimportar mañana crearía una fila
    // nueva en vez de actualizar, y el import "duplicaría".
    "vigente_desde",
  ],
  promocion: [
    "sku_codigo_externo",
    "precio_promo",
    "fecha_inicio",
    "fecha_fin",
    "comunicada",
  ],
};

/** Las columnas obligatorias por hoja: sin ellas la fila no se puede resolver. */
export const OBLIGATORIAS: Record<Hoja, readonly string[]> = {
  marca: ["codigo_externo", "nombre"],
  cadena: ["codigo_externo", "nombre"],
  sku: ["codigo_externo", "marca_codigo_externo", "codigo", "nombre"],
  tienda: ["codigo_externo", "cadena_codigo_externo", "nombre"],
  tienda_sku: ["tienda_codigo_externo", "sku_codigo_externo"],
  precio_regular: [
    "sku_codigo_externo",
    "cadena_codigo_externo",
    "precio",
    "vigente_desde",
  ],
  promocion: [
    "sku_codigo_externo",
    "precio_promo",
    "fecha_inicio",
    "fecha_fin",
  ],
};

/**
 * Topes del archivo.
 *
 * Un .xlsx es un zip: la descompresión ocurre antes de poder contar filas, así
 * que el tope de bytes es la única defensa contra un archivo que se expande a
 * gigas. El de filas acota el trabajo una vez leído.
 */
export const TOPE_BYTES = 2 * 1024 * 1024;
export const TOPE_FILAS_POR_HOJA = 5_000;

/**
 * Cuántos errores se devuelven como máximo.
 *
 * Un archivo con la cabecera mal puesta genera un error por fila: mandar cinco
 * mil a la pantalla no ayuda a nadie y hincha la fila `importacion`. El resto se
 * cuenta en el resumen para que el operador sepa que hay más.
 */
export const TOPE_ERRORES = 200;
