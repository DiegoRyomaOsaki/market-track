import {
  type CampoFormulario,
  type DefinicionFormulario,
  definicionFormularioSchema,
  recortarRespuesta,
} from "@market-track/shared";

// La lógica pura del formulario configurable en el móvil (MAR-80, ADR-0010):
//   - parsear la `definicion` sincronizada (texto en SQLite) con Zod al LEER,
//   - resolver QUÉ versión publicada usa una marca,
//   - coercionar y validar las respuestas de los campos libres.
// Vive fuera de la UI para poder probarla y para no repetir el JSON.parse a pelo.

/** Una respuesta de campo libre, ya en su forma canónica para guardar. */
export type ValorRespuesta = string | number | boolean | string[];

/**
 * Parsea la `definicion` (texto jsonb) validándola con el esquema canónico. Ante
 * cualquier problema devuelve `null` —definición ausente, JSON roto o inválida—
 * para DEGRADAR a los pasos fijos en vez de romper el flujo de campo. Falla
 * visible (log), nunca en silencio.
 */
export function parseDefinicionFormulario(
  raw: string | null | undefined,
): DefinicionFormulario | null {
  if (raw == null || raw.trim() === "") return null;

  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch (err) {
    console.warn(
      "[formulario] definición ilegible",
      err instanceof Error ? err.message : String(err),
    );
    return null;
  }

  const parsed = definicionFormularioSchema.safeParse(json);
  if (!parsed.success) {
    console.warn("[formulario] definición inválida", parsed.error.issues);
    return null;
  }
  return parsed.data;
}

type FormularioActivo = {
  id: string;
  marca_id: string | null;
  creado_at: string;
};
type VersionPublicada = { id: string; formulario_id: string; version: number };

/**
 * Resuelve la versión publicada que ANCLA un levantamiento. Precedencia: el
 * formulario específico de la marca gana al de "todas las marcas"; a igualdad, el
 * más reciente. Dentro del elegido, la versión publicada más alta. Si el
 * preferido no tiene versión publicada, cae al siguiente candidato. Ninguna →
 * `null` (el wizard usa solo los 5 pasos fijos).
 *
 * `formularios` ya viene filtrado a los ACTIVOS y `versiones` a las PUBLICADAS
 * (las sync rules solo bajan esas).
 */
export function resolverVersionAnclada(
  formularios: FormularioActivo[],
  versiones: VersionPublicada[],
  marcaId: string,
): string | null {
  const candidatos = formularios
    .filter((f) => f.marca_id === marcaId || f.marca_id === null)
    .sort((a, b) => {
      const preferido = (f: FormularioActivo) =>
        f.marca_id === marcaId ? 1 : 0;
      const dif = preferido(b) - preferido(a);
      return dif !== 0 ? dif : b.creado_at.localeCompare(a.creado_at);
    });

  for (const formulario of candidatos) {
    const ultima = versiones
      .filter((v) => v.formulario_id === formulario.id)
      .sort((a, b) => b.version - a.version)[0];
    if (ultima) return ultima.id;
  }
  return null;
}

// El techo se aplica SIEMPRE al final, aunque el suelo ya haya subido el valor.
// Con un rango invertido —{min:10, max:5}, que el esquema estricto ya rechaza al
// publicar pero que puede venir en una definición guardada antes de esa verja—
// la versión anterior devolvía 10: por encima del máximo declarado por el propio
// campo. Ningún rango imposible tiene una respuesta buena, pero devolver algo que
// supera el techo es la peor de todas, porque el dato guardado contradice al
// formulario que lo pidió.
const clamp = (n: number, min?: number, max?: number): number => {
  const conSuelo = min != null && n < min ? min : n;
  return max != null && conSuelo > max ? max : conSuelo;
};

/** Un tipo de la unión que no debería llegar aquí: fuerza la exhaustividad. */
function tipoNoManejado(tipo: never): never {
  throw new Error(`Tipo de campo no manejado: ${String(tipo)}`);
}

/**
 * Lleva el valor crudo de un control a su forma canónica para guardar, según el
 * tipo del campo. Los números respetan min/max, la selección múltiple se acota a
 * las opciones válidas y el texto libre se trunca a su tope.
 *
 * El truncado no es cosmético: es la única cota entre el teclado y una tabla que
 * se replica a todos los teléfonos del cliente. El campo de la pantalla ya limita
 * lo que se puede escribir, así que aquí solo llega texto sobre el tope si algo
 * se saltó la UI — y en ese caso vale más guardar los primeros 2.000 caracteres
 * que rechazar el levantamiento entero de un mercaderista que está en tienda.
 */
export function coercionValorRespuesta(
  campo: CampoFormulario,
  raw: unknown,
): ValorRespuesta {
  switch (campo.tipo) {
    case "texto":
    case "parrafo":
    case "foto":
      return typeof raw === "string"
        ? recortarRespuesta(raw.trim(), campo.tipo)
        : "";
    case "entero": {
      const n = Number(raw);
      return Number.isFinite(n)
        ? clamp(Math.trunc(n), campo.min, campo.max)
        : 0;
    }
    case "decimal": {
      const n = Number(raw);
      return Number.isFinite(n) ? clamp(n, campo.min, campo.max) : 0;
    }
    case "booleano":
      return raw === true || raw === "true" || raw === 1;
    case "seleccion": {
      const v = typeof raw === "string" ? raw : "";
      return campo.opciones?.includes(v) ? v : "";
    }
    case "seleccion_multiple": {
      // Sin `Set` una lista con la misma opción válida repetida mil veces pasaría
      // el filtro entera. No puede haber más respuestas que opciones ofrecidas.
      const lista = Array.isArray(raw) ? raw.map(String) : [];
      return [...new Set(lista)].filter((o) => campo.opciones?.includes(o));
    }
    default:
      return tipoNoManejado(campo.tipo);
  }
}

// El valor CRUDO de un control mientras se edita (antes de coercionar): texto y
// números viajan como string, sí/no como boolean, selección múltiple como lista.
// `undefined` = el control no se ha tocado.
export type RespuestaCruda = string | boolean | string[] | undefined;

/** ¿El campo está contestado? Un número en blanco ("") NO cuenta —por eso el
 * gate mira el crudo y no el coercionado, que convertiría "" en 0. */
export function estaContestado(valor: RespuestaCruda): boolean {
  if (valor === undefined) return false;
  if (typeof valor === "string") return valor.trim() !== "";
  if (Array.isArray(valor)) return valor.length > 0;
  return true;
}

/**
 * ¿Falta contestar algún campo obligatorio? Gobierna el botón "Continuar" de un
 * paso configurable. Los campos `foto` obligatorios cuentan como faltantes
 * mientras no se soporte la captura (el paso se pasa por contingencia).
 */
export function faltanObligatorios(
  campos: CampoFormulario[],
  valores: Record<string, RespuestaCruda>,
): boolean {
  return campos.some((c) => c.obligatorio && !estaContestado(valores[c.id]));
}
