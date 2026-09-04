import { describe, expect, it } from "vitest";

import {
  leerFiltros,
  leerFiltrosAlerta,
  leerTipoFoto,
  serializarFiltros,
} from "./filtros";

const UUID = "aaaaaaaa-0000-0000-0000-000000000001";

describe("leerFiltros", () => {
  it("lee fechas ISO y uuids válidos", () => {
    expect(
      leerFiltros({
        desde: "2026-07-01",
        hasta: "2026-07-30",
        cadena: UUID,
        tienda: UUID,
      }),
    ).toEqual({
      desde: "2026-07-01",
      hasta: "2026-07-30",
      cadena: UUID,
      tienda: UUID,
    });
  });

  it("descarta valores con forma inválida (nunca llegan a una query)", () => {
    expect(
      leerFiltros({
        desde: "julio",
        hasta: "2026/07/30",
        cadena: "x",
        tienda: "no-es-uuid",
      }),
    ).toEqual({ desde: null, hasta: null, cadena: null, tienda: null });
  });

  it("acepta un uuid en mayúsculas (la validación no distingue caso)", () => {
    expect(leerFiltros({ cadena: UUID.toUpperCase() }).cadena).toBe(
      UUID.toUpperCase(),
    );
  });

  it("toma el primer valor de un parámetro repetido", () => {
    expect(leerFiltros({ desde: ["2026-07-01", "2026-01-01"] }).desde).toBe(
      "2026-07-01",
    );
  });

  it("sin parámetros, todo es null", () => {
    expect(leerFiltros({})).toEqual({
      desde: null,
      hasta: null,
      cadena: null,
      tienda: null,
    });
  });
});

describe("serializarFiltros", () => {
  it("arma el querystring y omite los vacíos", () => {
    expect(serializarFiltros({ desde: "2026-07-01", cadena: UUID })).toBe(
      `?desde=2026-07-01&cadena=${UUID}`,
    );
  });

  it("sin filtros devuelve cadena vacía", () => {
    expect(serializarFiltros({})).toBe("");
  });

  it("es la inversa de leerFiltros con los cuatro campos poblados", () => {
    const filtros = {
      desde: "2026-07-01",
      hasta: "2026-07-30",
      cadena: "aaaaaaaa-0000-0000-0000-000000000001",
      tienda: "bbbbbbbb-0000-0000-0000-000000000002",
    };
    const params = Object.fromEntries(
      new URLSearchParams(serializarFiltros(filtros)),
    );
    expect(leerFiltros(params)).toEqual(filtros);
  });
});

describe("leerTipoFoto", () => {
  it("acepta un tipo del enum", () => {
    expect(leerTipoFoto({ tipo: "antes" })).toBe("antes");
  });

  it("RECHAZA la selfie: no es evidencia de tienda, es la cara de un empleado", () => {
    expect(leerTipoFoto({ tipo: "selfie" })).toBeNull();
  });

  it("una cadena desconocida se descarta antes de llegar a Postgres", () => {
    // Sin esto moriría con `22P02 invalid input value for enum`, que el usuario
    // vería como "no pudimos cargar la evidencia".
    expect(leerTipoFoto({ tipo: "'; drop table foto; --" })).toBeNull();
  });

  it("sin parámetro, sin filtro", () => {
    expect(leerTipoFoto({})).toBeNull();
  });

  it("de un array toma el primero", () => {
    expect(leerTipoFoto({ tipo: ["despues", "antes"] })).toBe("despues");
  });
});

describe("leerFiltrosAlerta", () => {
  it("lee los tres filtros de la bandeja cuando son válidos", () => {
    expect(
      leerFiltrosAlerta({
        tipo: "contingencia",
        severidad: "critica",
        estado: "resuelta",
      }),
    ).toEqual({
      tipo: "contingencia",
      severidad: "critica",
      estado: "resuelta",
      pagina: 1,
    });
  });

  it("descarta lo que no está en el enum en vez de pasarlo a la base", () => {
    // La URL la escribe cualquiera: sin esto, un valor inventado llegaría al
    // parámetro tipado de la RPC y moriría en un error de cast.
    expect(
      leerFiltrosAlerta({
        tipo: "inventado",
        severidad: "urgentisima",
        estado: "archivada",
      }),
    ).toMatchObject({ tipo: null, severidad: null, estado: null });
  });

  it("un parámetro repetido no cuela un segundo valor", () => {
    expect(leerFiltrosAlerta({ tipo: ["quiebre", "contingencia"] }).tipo).toBe(
      "quiebre",
    );
  });

  it("la página es siempre un entero desde 1", () => {
    expect(leerFiltrosAlerta({ pagina: "3" }).pagina).toBe(3);
    for (const v of ["0", "-2", "abc", "1.5", "", undefined]) {
      expect(leerFiltrosAlerta({ pagina: v }).pagina).toBe(1);
    }
  });

  it("sin parámetros no filtra nada y arranca en la primera página", () => {
    expect(leerFiltrosAlerta({})).toEqual({
      tipo: null,
      severidad: null,
      estado: null,
      pagina: 1,
    });
  });
});
