import {
  TOPES_FORMULARIO,
  excedeTamano,
  type CampoFormulario,
  type DefinicionFormulario,
  type TipoCampoFormulario,
} from "@market-track/shared";

import type { DefinicionBorrador } from "./schema";

// La lógica pura del constructor de formularios: convertir entre lo que el
// panel EDITA (estado mutable, con opciones/mín/máx como texto libre) y lo que
// se GUARDA (la `definicion` jsonb). Vive fuera de la UI para poder probarla y
// para que el componente solo ensamble la pantalla. Ver ADR-0010 y MAR-79.

/** El campo tal como se edita: opciones y rangos son texto mientras se teclea. */
export type CampoEditable = {
  id: string;
  tipo: TipoCampoFormulario;
  etiqueta: string;
  obligatorio: boolean;
  ayuda: string;
  // Una opción por línea; solo aplica a los tipos de selección.
  opcionesTexto: string;
  // "" = sin límite; solo aplica a los tipos numéricos.
  min: string;
  max: string;
};

export type PasoEditable = {
  id: string;
  titulo: string;
  campos: CampoEditable[];
};

const TIPOS_SELECCION: readonly TipoCampoFormulario[] = [
  "seleccion",
  "seleccion_multiple",
];
const TIPOS_NUMERO: readonly TipoCampoFormulario[] = ["entero", "decimal"];

export function esSeleccion(tipo: TipoCampoFormulario): boolean {
  return TIPOS_SELECCION.includes(tipo);
}

export function esNumero(tipo: TipoCampoFormulario): boolean {
  return TIPOS_NUMERO.includes(tipo);
}

/** El texto de opciones (una por línea) a la lista, sin vacíos ni espacios. */
export function opcionesDeTexto(texto: string): string[] {
  return texto
    .split("\n")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

function textoDeOpciones(opciones: string[] | undefined): string {
  return (opciones ?? []).join("\n");
}

function numeroTexto(valor: number | undefined): string {
  return valor == null ? "" : String(valor);
}

/** ¿El texto es un número finito? "" no lo es (significa "sin límite"). */
function esNumeroFinito(texto: string): boolean {
  return texto.trim() !== "" && Number.isFinite(Number(texto));
}

function construirCampo(c: CampoEditable): CampoFormulario {
  const base = {
    id: c.id,
    tipo: c.tipo,
    etiqueta: c.etiqueta.trim(),
    obligatorio: c.obligatorio,
    ...(c.ayuda.trim() ? { ayuda: c.ayuda.trim() } : {}),
  };
  if (esSeleccion(c.tipo)) {
    return { ...base, opciones: opcionesDeTexto(c.opcionesTexto) };
  }
  if (esNumero(c.tipo)) {
    return {
      ...base,
      ...(esNumeroFinito(c.min) ? { min: Number(c.min) } : {}),
      ...(esNumeroFinito(c.max) ? { max: Number(c.max) } : {}),
    };
  }
  return base;
}

/** Ensambla la `definicion` a guardar. `orden` sale del índice, nunca se duplica. */
export function construirDefinicion(
  pasos: PasoEditable[],
): DefinicionFormulario {
  return {
    pasos: pasos.map((p, i) => ({
      id: p.id,
      titulo: p.titulo.trim(),
      orden: i,
      campos: p.campos.map(construirCampo),
    })),
  };
}

function campoADraft(c: CampoFormulario): CampoEditable {
  return {
    id: c.id,
    tipo: c.tipo,
    etiqueta: c.etiqueta,
    obligatorio: c.obligatorio,
    ayuda: c.ayuda ?? "",
    opcionesTexto: textoDeOpciones(c.opciones),
    min: numeroTexto(c.min),
    max: numeroTexto(c.max),
  };
}

/** Siembra el editor desde una definición guardada (borrador o publicada). */
export function definicionADraft(
  definicion: DefinicionBorrador,
): PasoEditable[] {
  return [...definicion.pasos]
    .sort((a, b) => a.orden - b.orden)
    .map((p) => ({
      id: p.id,
      titulo: p.titulo,
      campos: p.campos.map(campoADraft),
    }));
}

/**
 * Los problemas que impiden PUBLICAR, en lenguaje del admin. Es la misma verja
 * que el esquema estricto del servidor (`definicionFormularioSchema`), pero con
 * mensajes de dominio ("un campo sin etiqueta") en vez de rutas de Zod. Lista
 * vacía = se puede publicar.
 */
export function problemasDeDefinicion(pasos: PasoEditable[]): string[] {
  const problemas: string[] = [];

  if (pasos.length === 0) {
    problemas.push("Agrega al menos un paso.");
  }
  if (pasos.length > TOPES_FORMULARIO.pasos) {
    problemas.push(
      `El formulario no puede tener más de ${TOPES_FORMULARIO.pasos} pasos.`,
    );
  }

  const idsVistos = new Set<string>();

  pasos.forEach((paso, i) => {
    const nombrePaso = paso.titulo.trim() || `Paso ${i + 1}`;
    if (paso.titulo.trim() === "") {
      problemas.push(`El paso ${i + 1} necesita un título.`);
    }

    if (paso.campos.length > TOPES_FORMULARIO.camposPorPaso) {
      problemas.push(
        `«${nombrePaso}» supera los ${TOPES_FORMULARIO.camposPorPaso} campos.`,
      );
    }

    paso.campos.forEach((campo) => {
      const nombreCampo = campo.etiqueta.trim() || "un campo";
      if (campo.etiqueta.trim() === "") {
        problemas.push(`Hay un campo sin etiqueta en «${nombrePaso}».`);
      }
      if (campo.etiqueta.trim().length > TOPES_FORMULARIO.etiquetaChars) {
        problemas.push(
          `La etiqueta de «${nombreCampo}» supera los ${TOPES_FORMULARIO.etiquetaChars} caracteres.`,
        );
      }
      if (campo.ayuda.trim().length > TOPES_FORMULARIO.ayudaChars) {
        problemas.push(
          `La ayuda de «${nombreCampo}» supera los ${TOPES_FORMULARIO.ayudaChars} caracteres.`,
        );
      }
      if (idsVistos.has(campo.id)) {
        problemas.push(`El campo «${nombreCampo}» está repetido.`);
      }
      idsVistos.add(campo.id);

      if (esSeleccion(campo.tipo)) {
        const opciones = opcionesDeTexto(campo.opcionesTexto);
        if (opciones.length === 0) {
          problemas.push(
            `El campo «${nombreCampo}» es de selección y necesita al menos una opción.`,
          );
        }
        if (opciones.length > TOPES_FORMULARIO.opcionesPorCampo) {
          problemas.push(
            `«${nombreCampo}» supera las ${TOPES_FORMULARIO.opcionesPorCampo} opciones.`,
          );
        }
        if (opciones.some((o) => o.length > TOPES_FORMULARIO.opcionChars)) {
          problemas.push(
            `Una opción de «${nombreCampo}» supera los ${TOPES_FORMULARIO.opcionChars} caracteres.`,
          );
        }
      }
      if (esNumero(campo.tipo)) {
        if (campo.min.trim() !== "" && !esNumeroFinito(campo.min)) {
          problemas.push(`El mínimo de «${nombreCampo}» no es un número.`);
        }
        if (campo.max.trim() !== "" && !esNumeroFinito(campo.max)) {
          problemas.push(`El máximo de «${nombreCampo}» no es un número.`);
        }
        if (
          esNumeroFinito(campo.min) &&
          esNumeroFinito(campo.max) &&
          Number(campo.min) > Number(campo.max)
        ) {
          problemas.push(
            `En «${nombreCampo}» el mínimo es mayor que el máximo.`,
          );
        }
      }
    });
  });

  if (problemas.length === 0 && excedeTamano(construirDefinicion(pasos))) {
    problemas.push(
      "El formulario es demasiado grande para sincronizarse al teléfono.",
    );
  }

  return problemas;
}
