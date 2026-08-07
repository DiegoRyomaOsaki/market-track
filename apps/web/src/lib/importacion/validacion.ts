import {
  type ErrorImportacion,
  filaCadenaSchema,
  filaMarcaSchema,
  filaPrecioRegularSchema,
  filaPromocionSchema,
  filaSkuSchema,
  filaTiendaSchema,
  filaTiendaSkuSchema,
  type LoteImportacion,
} from "@market-track/shared";
import type { ZodType } from "zod";

import {
  COLUMNAS,
  type Hoja,
  HOJAS,
  OBLIGATORIAS,
  TOPE_ERRORES,
  TOPE_FILAS_POR_HOJA,
} from "./plantilla";

// La validación del maestro: de una matriz de celdas a un lote listo para aplicar,
// o a una lista de errores fila por fila.
//
// PURA a propósito: recibe lo que ya existe en la base como argumento en vez de
// consultarlo. Así se puede probar entera sin base de datos, que es donde vive la
// lógica de negocio de este ticket.

/** Lo que el parseo entrega: por hoja, una matriz de celdas con su cabecera. */
export type HojasCrudas = Partial<Record<Hoja, unknown[][]>>;

/** Los `codigo_externo` que ya existen en la base, por entidad. */
export type ClavesExistentes = {
  marca: ReadonlySet<string>;
  cadena: ReadonlySet<string>;
  sku: ReadonlySet<string>;
  tienda: ReadonlySet<string>;
};

export type Validacion = {
  lote: LoteImportacion;
  errores: ErrorImportacion[];
  /** Cuántos errores se dejaron fuera al llegar al tope. */
  erroresOmitidos: number;
};

const SCHEMA: Record<Hoja, ZodType> = {
  marca: filaMarcaSchema,
  cadena: filaCadenaSchema,
  sku: filaSkuSchema,
  tienda: filaTiendaSchema,
  tienda_sku: filaTiendaSkuSchema,
  precio_regular: filaPrecioRegularSchema,
  promocion: filaPromocionSchema,
};

/** Las referencias que cada hoja hace a otra entidad, por columna. */
const REFERENCIAS: Partial<
  Record<Hoja, { columna: string; a: keyof ClavesExistentes }[]>
> = {
  sku: [{ columna: "marca_codigo_externo", a: "marca" }],
  tienda: [{ columna: "cadena_codigo_externo", a: "cadena" }],
  tienda_sku: [
    { columna: "tienda_codigo_externo", a: "tienda" },
    { columna: "sku_codigo_externo", a: "sku" },
  ],
  precio_regular: [
    { columna: "sku_codigo_externo", a: "sku" },
    { columna: "cadena_codigo_externo", a: "cadena" },
  ],
  promocion: [{ columna: "sku_codigo_externo", a: "sku" }],
};

/** La clave con la que se detecta un duplicado dentro del propio archivo. */
const CLAVE_EN_ARCHIVO: Record<Hoja, readonly string[]> = {
  marca: ["codigo_externo"],
  cadena: ["codigo_externo"],
  sku: ["codigo_externo"],
  tienda: ["codigo_externo"],
  tienda_sku: ["tienda_codigo_externo", "sku_codigo_externo"],
  precio_regular: [
    "sku_codigo_externo",
    "cadena_codigo_externo",
    "tipo_tienda",
    "vigente_desde",
  ],
  promocion: ["sku_codigo_externo", "fecha_inicio"],
};

const VACIO: LoteImportacion = {
  marca: [],
  cadena: [],
  sku: [],
  tienda: [],
  tienda_sku: [],
  precio_regular: [],
  promocion: [],
};

/** Una celda a texto. `null`/`undefined` y los espacios cuentan como vacío. */
function comoTexto(celda: unknown): string {
  if (celda === null || celda === undefined) return "";
  if (celda instanceof Date) return celda.toISOString().slice(0, 10);
  // Solo lo que ya es un valor de celda. Un objeto se convertiría en
  // "[object Object]" y acabaría guardado como si fuera un dato del cliente.
  if (typeof celda === "string") return celda.trim();
  if (typeof celda === "number" || typeof celda === "boolean") {
    return String(celda);
  }
  return "";
}

/**
 * Una celda a número.
 *
 * Devuelve `null` si está vacía y `NaN` si tiene algo que no es un número: son
 * casos distintos —"no lo mandó" contra "mandó basura"— y solo el segundo es un
 * error de fila.
 */
function comoNumero(celda: unknown): number | null {
  const t = comoTexto(celda);
  if (t === "") return null;
  // El cliente escribe "12,90" en un Excel en español.
  return Number(t.replace(",", "."));
}

function comoBooleano(celda: unknown): boolean {
  const t = comoTexto(celda).toLowerCase();
  return ["si", "sí", "true", "1", "x", "verdadero"].includes(t);
}

const NUMERICAS = new Set([
  "tolerancia_precio_pct",
  "lat",
  "lon",
  "radio_geocerca_m",
  "precio",
  "precio_promo",
]);
const BOOLEANAS = new Set(["comunicada"]);

/** Convierte una fila de celdas al objeto que el schema espera. */
function aObjeto(hoja: Hoja, cabecera: string[], celdas: unknown[]) {
  const fila: Record<string, unknown> = {};
  for (const columna of COLUMNAS[hoja]) {
    const i = cabecera.indexOf(columna);
    const celda = i === -1 ? null : celdas[i];

    if (NUMERICAS.has(columna)) fila[columna] = comoNumero(celda);
    else if (BOOLEANAS.has(columna)) fila[columna] = comoBooleano(celda);
    else {
      const t = comoTexto(celda);
      // Las obligatorias van tal cual para que el schema las rechace con su
      // propio mensaje; las opcionales vacías son `null`, no cadena vacía.
      fila[columna] = OBLIGATORIAS[hoja].includes(columna)
        ? t
        : t === ""
          ? null
          : t;
    }
  }
  return fila;
}

/** Una clave compuesta sin delimitadores: una celda puede contener cualquier cosa. */
function claveDe(fila: Record<string, unknown>, columnas: readonly string[]) {
  return JSON.stringify(columnas.map((c) => fila[c] ?? null));
}

export function validarMaestro(
  hojas: HojasCrudas,
  existentes: ClavesExistentes,
): Validacion {
  const lote: LoteImportacion = { ...VACIO };
  const errores: ErrorImportacion[] = [];
  let erroresOmitidos = 0;

  const anotar = (e: ErrorImportacion) => {
    if (errores.length < TOPE_ERRORES) errores.push(e);
    else erroresOmitidos += 1;
  };

  // Lo que el propio archivo aporta cuenta como existente: un SKU puede
  // referenciar una marca que se crea en este mismo import.
  const enArchivo: Record<keyof ClavesExistentes, Set<string>> = {
    marca: new Set(),
    cadena: new Set(),
    sku: new Set(),
    tienda: new Set(),
  };

  for (const hoja of HOJAS) {
    const matriz = hojas[hoja];
    if (matriz === undefined || matriz.length === 0) continue;

    const cabecera = (matriz[0] ?? []).map((c) => comoTexto(c));
    const faltantes = OBLIGATORIAS[hoja].filter((c) => !cabecera.includes(c));
    if (faltantes.length > 0) {
      // Sin cabecera no se puede leer NINGUNA fila: un error de archivo, no de
      // fila. Reportar una por fila enterraría el problema real.
      anotar({
        hoja,
        fila: 1,
        columna: faltantes[0] ?? null,
        valor: null,
        mensaje: `Faltan columnas obligatorias: ${faltantes.join(", ")}`,
      });
      continue;
    }

    const cuerpo = matriz.slice(1);
    if (cuerpo.length > TOPE_FILAS_POR_HOJA) {
      anotar({
        hoja,
        fila: TOPE_FILAS_POR_HOJA + 2,
        columna: null,
        valor: null,
        mensaje: `La hoja tiene más de ${TOPE_FILAS_POR_HOJA} filas. Divídela en varios archivos.`,
      });
      continue;
    }

    const vistas = new Set<string>();
    const aceptadas: unknown[] = [];

    cuerpo.forEach((celdas, i) => {
      // +2: la cabecera es la fila 1 y el Excel cuenta desde 1. Es el número que
      // el operador ve en su pantalla.
      const numeroDeFila = i + 2;

      // Una fila completamente vacía es el relleno que deja Excel al final, no un
      // error del cliente.
      if (celdas.every((c) => comoTexto(c) === "")) return;

      const fila = aObjeto(hoja, cabecera, celdas);
      const parsed = SCHEMA[hoja].safeParse(fila);
      if (!parsed.success) {
        for (const issue of parsed.error.issues.slice(0, 3)) {
          const columna =
            issue.path[0] === undefined ? null : String(issue.path[0]);
          anotar({
            hoja,
            fila: numeroDeFila,
            columna,
            valor:
              columna === null ? null : comoTexto(fila[columna]).slice(0, 120),
            mensaje: issue.message,
          });
        }
        return;
      }

      const clave = claveDe(fila, CLAVE_EN_ARCHIVO[hoja]);
      if (vistas.has(clave)) {
        // Sin esto, el upsert muere con «cannot affect row a second time» y el
        // operador recibe un error de Postgres en vez de la fila culpable.
        anotar({
          hoja,
          fila: numeroDeFila,
          columna: CLAVE_EN_ARCHIVO[hoja][0] ?? null,
          valor: comoTexto(fila[CLAVE_EN_ARCHIVO[hoja][0] ?? ""]).slice(0, 120),
          mensaje: "Esta fila está repetida en el archivo",
        });
        return;
      }
      vistas.add(clave);

      let referenciaRota = false;
      for (const ref of REFERENCIAS[hoja] ?? []) {
        const valor = comoTexto(fila[ref.columna]);
        if (!existentes[ref.a].has(valor) && !enArchivo[ref.a].has(valor)) {
          // El fallo más caro si no se detecta: el join del upsert descartaría la
          // fila EN SILENCIO y el import diría "aplicado" con datos faltando.
          anotar({
            hoja,
            fila: numeroDeFila,
            columna: ref.columna,
            valor: valor.slice(0, 120),
            mensaje: `No existe ninguna ${ref.a} con el código «${valor}»`,
          });
          referenciaRota = true;
        }
      }
      if (referenciaRota) return;

      if (hoja in enArchivo) {
        enArchivo[hoja as keyof ClavesExistentes].add(
          comoTexto(fila.codigo_externo),
        );
      }
      aceptadas.push(parsed.data);
    });

    // El cast es seguro: cada elemento salió del `safeParse` de SU schema, y el
    // tipo del lote se indexa con la misma clave.
    (lote[hoja] as unknown[]) = aceptadas;
  }

  // Con cualquier error no se aplica nada, así que el lote parcial no vale: se
  // devuelve vacío para que nadie lo mande por descuido.
  if (errores.length > 0) return { lote: VACIO, errores, erroresOmitidos };

  return { lote, errores, erroresOmitidos };
}

/**
 * Qué códigos de otras entidades menciona el archivo.
 *
 * Se consulta solo esto, no el catálogo entero: un cliente con miles de SKUs no
 * tiene por qué viajar por la red para validar diez filas.
 */
export function codigosReferenciados(
  hojas: HojasCrudas,
): Record<keyof ClavesExistentes, string[]> {
  const encontrados: Record<keyof ClavesExistentes, Set<string>> = {
    marca: new Set(),
    cadena: new Set(),
    sku: new Set(),
    tienda: new Set(),
  };

  for (const hoja of HOJAS) {
    const matriz = hojas[hoja];
    if (matriz === undefined || matriz.length === 0) continue;

    const cabecera = (matriz[0] ?? []).map((c) => comoTexto(c));
    for (const ref of REFERENCIAS[hoja] ?? []) {
      const i = cabecera.indexOf(ref.columna);
      if (i === -1) continue;
      for (const celdas of matriz.slice(1)) {
        const v = comoTexto(celdas[i]);
        if (v !== "") encontrados[ref.a].add(v);
      }
    }
  }

  return {
    marca: [...encontrados.marca],
    cadena: [...encontrados.cadena],
    sku: [...encontrados.sku],
    tienda: [...encontrados.tienda],
  };
}
