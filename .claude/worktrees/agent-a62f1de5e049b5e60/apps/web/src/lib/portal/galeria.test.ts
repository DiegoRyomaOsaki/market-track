import { describe, expect, it } from "vitest";

import type { GaleriaEvidencia } from "@market-track/shared";

import {
  idsFirmables,
  pendientesDeSubida,
  resumen,
  tieneEvidencia,
  urlDe,
} from "./galeria";

const SUBIDA = "2026-08-05T12:00:00.000Z";

function foto(id: string, subida: boolean) {
  return {
    id,
    capturada_at: SUBIDA,
    subida_at: subida ? SUBIDA : null,
  };
}

function galeria(over: Partial<GaleriaEvidencia> = {}): GaleriaEvidencia {
  return {
    visitas_totales: 1,
    truncado: false,
    tiendas: [
      {
        id: "t1",
        nombre: "Plaza Vea Surco",
        direccion: null,
        cadena_nombre: "Plaza Vea",
        visitas: [
          {
            id: "v1",
            check_in_at: SUBIDA,
            check_out_at: null,
            fotos_visita: [{ ...foto("fv", true), tipo: "contingencia" }],
            levantamientos: [
              {
                id: "l1",
                marca_nombre: "Oster",
                estado: "completado",
                sos_frentes_propios: 4,
                quiebres: 1,
                antes: foto("a", true),
                despues: foto("d", false),
                otras: [{ ...foto("o", true), tipo: "sos" }],
              },
            ],
          },
        ],
      },
    ],
    ...over,
  };
}

describe("idsFirmables", () => {
  it("solo firma lo que ya está en R2", () => {
    // Pedir la URL de algo que sigue en el teléfono devolvería un enlace a un
    // objeto inexistente, y la pantalla enseñaría una imagen rota en vez de la
    // verdad.
    expect(idsFirmables(galeria()).sort()).toEqual(["a", "fv", "o"]);
  });

  it("un árbol vacío no pide firmar nada", () => {
    expect(idsFirmables(galeria({ tiendas: [] }))).toEqual([]);
  });
});

describe("tieneEvidencia", () => {
  const lev = galeria().tiendas[0]!.visitas[0]!.levantamientos[0]!;

  it("con alguna foto, sí", () => {
    expect(tieneEvidencia(lev)).toBe(true);
  });

  it("sin ninguna, no", () => {
    expect(
      tieneEvidencia({ ...lev, antes: null, despues: null, otras: [] }),
    ).toBe(false);
  });

  it("una foto sin subir SIGUE siendo evidencia: existe, solo no ha llegado", () => {
    expect(
      tieneEvidencia({
        ...lev,
        antes: null,
        despues: foto("d", false),
        otras: [],
      }),
    ).toBe(true);
  });
});

describe("pendientesDeSubida", () => {
  it("cuenta las que siguen en el teléfono, en toda la visita", () => {
    expect(pendientesDeSubida(galeria().tiendas[0]!.visitas[0]!)).toBe(1);
  });

  it("con todo subido, cero", () => {
    const v = galeria().tiendas[0]!.visitas[0]!;
    const lev = v.levantamientos[0]!;
    expect(
      pendientesDeSubida({
        ...v,
        levantamientos: [{ ...lev, despues: foto("d", true) }],
      }),
    ).toBe(0);
  });
});

describe("resumen", () => {
  it("cuenta tiendas y visitas", () => {
    expect(resumen(galeria())).toEqual({ tiendas: 1, visitas: 1 });
  });

  it("un árbol vacío cuenta cero, no revienta", () => {
    expect(resumen(galeria({ tiendas: [] }))).toEqual({
      tiendas: 0,
      visitas: 0,
    });
  });
});

describe("urlDe", () => {
  const urls = { a: "https://r2/a" };

  it("una foto subida con URL firmada, la devuelve", () => {
    expect(urlDe(foto("a", true), urls)).toBe("https://r2/a");
  });

  it("una foto SIN subir no devuelve URL aunque el mapa traiga su id", () => {
    // La regla vive aquí y no solo en `idsFirmables`: el componente que pinta no
    // debe depender de que un llamante lejano haya filtrado bien.
    expect(urlDe({ ...foto("a", false), id: "a" }, urls)).toBeUndefined();
  });

  it("una ranura vacía tampoco", () => {
    expect(urlDe(null, urls)).toBeUndefined();
  });

  it("una foto subida cuya URL no llegó devuelve undefined, no una cadena rota", () => {
    expect(urlDe(foto("z", true), urls)).toBeUndefined();
  });
});
