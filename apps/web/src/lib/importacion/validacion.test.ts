import { describe, expect, it } from "vitest";

import { TOPE_ERRORES } from "./plantilla";
import {
  type ClavesExistentes,
  type HojasCrudas,
  validarMaestro,
} from "./validacion";

// La validación del maestro comercial. Es la lógica de negocio del ticket: lo que
// decide si un Excel de cientos de filas entra entero o no entra nada.

const NADA: ClavesExistentes = {
  marca: new Set(),
  categoria: new Set<string>(),
  cadena: new Set(),
  sku: new Set(),
  tienda: new Set(),
};

function conExistentes(p: Partial<Record<keyof ClavesExistentes, string[]>>) {
  return {
    marca: new Set(p.marca ?? []),
    categoria: new Set<string>(),
    cadena: new Set(p.cadena ?? []),
    sku: new Set(p.sku ?? []),
    tienda: new Set(p.tienda ?? []),
  };
}

/** Una hoja de marcas mínima y válida, para no repetirla en cada caso. */
const MARCAS: HojasCrudas = {
  marca: [
    ["codigo_externo", "nombre", "tolerancia_precio_pct"],
    ["MRC", "Maracumango", "5"],
  ],
};

describe("las columnas obligatorias", () => {
  it("una cabecera sin una columna obligatoria es UN error de archivo, no uno por fila", () => {
    // Con un error por fila, un archivo de 500 filas enterraría el problema real
    // bajo 500 mensajes que dicen todos lo mismo.
    const r = validarMaestro(
      {
        marca: [["codigo_externo"], ["MRC"], ["OTRA"], ["TERCERA"]],
      },
      NADA,
    );

    expect(r.errores).toHaveLength(1);
    expect(r.errores[0]?.mensaje).toMatch(
      /Faltan columnas obligatorias.*nombre/,
    );
    expect(r.errores[0]?.fila).toBe(1);
  });

  it("una hoja ausente no es un error: el cliente puede no mandar promociones", () => {
    const r = validarMaestro(MARCAS, NADA);
    expect(r.errores).toEqual([]);
    expect(r.lote.promocion).toEqual([]);
  });
});

describe("el número de fila que se reporta", () => {
  it("es el del EXCEL, contando la cabecera", () => {
    // Es el número que el operador ve en su pantalla al abrir el archivo. Si
    // reportáramos el índice del array, buscaría la fila equivocada.
    const r = validarMaestro(
      {
        marca: [
          ["codigo_externo", "nombre"],
          ["MRC", "Maracumango"],
          ["", "Sin código"],
        ],
      },
      NADA,
    );

    expect(r.errores[0]?.fila).toBe(3);
  });
});

describe("la clave natural", () => {
  it("una fila sin `codigo_externo` es un error: sin él, el reimport duplicaría", () => {
    // `unique (tenant_id, codigo_externo)` no colisiona con NULL —en SQL dos
    // nulos son distintos—, así que esa fila se insertaría otra vez cada import.
    const r = validarMaestro(
      {
        marca: [
          ["codigo_externo", "nombre"],
          ["", "Sin código"],
        ],
      },
      NADA,
    );

    expect(r.errores).toHaveLength(1);
    expect(r.errores[0]?.columna).toBe("codigo_externo");
  });

  it("una fila repetida DENTRO del archivo se señala antes de llegar a Postgres", () => {
    // Sin esto el upsert muere con «cannot affect row a second time» y el
    // operador recibe un error del motor en vez de saber qué fila arreglar.
    const r = validarMaestro(
      {
        marca: [
          ["codigo_externo", "nombre"],
          ["MRC", "Maracumango"],
          ["MRC", "Maracumango otra vez"],
        ],
      },
      NADA,
    );

    expect(r.errores).toHaveLength(1);
    expect(r.errores[0]?.fila).toBe(3);
    expect(r.errores[0]?.mensaje).toMatch(/repetida/);
  });

  it("el duplicado de precio mira la clave COMPLETA, no solo el SKU", () => {
    // Dos precios del mismo SKU en cadenas distintas son legítimos.
    const hojas: HojasCrudas = {
      ...MARCAS,
      cadena: [
        ["codigo_externo", "nombre"],
        ["PV", "Plaza Vea"],
        ["TOT", "Tottus"],
      ],
      sku: [
        ["codigo_externo", "marca_codigo_externo", "codigo", "nombre"],
        ["S1", "MRC", "MRC-001", "Néctar"],
      ],
      precio_regular: [
        [
          "sku_codigo_externo",
          "cadena_codigo_externo",
          "precio",
          "vigente_desde",
        ],
        ["S1", "PV", "9.90", "2026-08-01"],
        ["S1", "TOT", "10.50", "2026-08-01"],
      ],
    };

    const r = validarMaestro(hojas, NADA);

    expect(r.errores).toEqual([]);
    expect(r.lote.precio_regular).toHaveLength(2);
  });
});

describe("las referencias entre hojas", () => {
  it("un SKU que apunta a una marca inexistente se señala", () => {
    // Es el fallo más caro si no se detecta: el join del upsert descartaría la
    // fila en silencio y el import diría «aplicado» con SKUs faltando.
    const r = validarMaestro(
      {
        sku: [
          ["codigo_externo", "marca_codigo_externo", "codigo", "nombre"],
          ["S1", "NO-EXISTE", "MRC-001", "Néctar"],
        ],
      },
      NADA,
    );

    expect(r.errores).toHaveLength(1);
    expect(r.errores[0]?.columna).toBe("marca_codigo_externo");
    expect(r.errores[0]?.mensaje).toMatch(/No existe ninguna marca/);
  });

  it("puede apuntar a una marca que se crea en ESTE mismo archivo", () => {
    const r = validarMaestro(
      {
        ...MARCAS,
        sku: [
          ["codigo_externo", "marca_codigo_externo", "codigo", "nombre"],
          ["S1", "MRC", "MRC-001", "Néctar"],
        ],
      },
      NADA,
    );

    expect(r.errores).toEqual([]);
    expect(r.lote.sku).toHaveLength(1);
  });

  it("puede apuntar a una marca que YA está en la base", () => {
    const r = validarMaestro(
      {
        sku: [
          ["codigo_externo", "marca_codigo_externo", "codigo", "nombre"],
          ["S1", "YA-EXISTE", "MRC-001", "Néctar"],
        ],
      },
      conExistentes({ marca: ["YA-EXISTE"] }),
    );

    expect(r.errores).toEqual([]);
  });
});

describe("las celdas", () => {
  it("acepta el decimal con coma, que es como lo escribe un Excel en español", () => {
    const r = validarMaestro(
      {
        ...MARCAS,
        cadena: [
          ["codigo_externo", "nombre"],
          ["PV", "Plaza Vea"],
        ],
        sku: [
          ["codigo_externo", "marca_codigo_externo", "codigo", "nombre"],
          ["S1", "MRC", "MRC-001", "Néctar"],
        ],
        precio_regular: [
          [
            "sku_codigo_externo",
            "cadena_codigo_externo",
            "precio",
            "vigente_desde",
          ],
          ["S1", "PV", "12,90", "2026-08-01"],
        ],
      },
      NADA,
    );

    expect(r.errores).toEqual([]);
    expect(r.lote.precio_regular[0]?.precio).toBe(12.9);
  });

  it("un precio que no es un número se señala en su columna", () => {
    const r = validarMaestro(
      {
        precio_regular: [
          [
            "sku_codigo_externo",
            "cadena_codigo_externo",
            "precio",
            "vigente_desde",
          ],
          ["S1", "PV", "gratis", "2026-08-01"],
        ],
      },
      conExistentes({ sku: ["S1"], cadena: ["PV"] }),
    );

    expect(r.errores.some((e) => e.columna === "precio")).toBe(true);
  });

  it("una fila del todo vacía es el relleno de Excel, no un error", () => {
    const r = validarMaestro(
      {
        marca: [
          ["codigo_externo", "nombre"],
          ["MRC", "Maracumango"],
          ["", ""],
          [null, null],
        ],
      },
      NADA,
    );

    expect(r.errores).toEqual([]);
    expect(r.lote.marca).toHaveLength(1);
  });

  it("una fecha que llega como Date se normaliza a texto ISO", () => {
    // `read-excel-file` devuelve `Date` en las celdas con formato de fecha.
    const r = validarMaestro(
      {
        promocion: [
          [
            "sku_codigo_externo",
            "precio_promo",
            "fecha_inicio",
            "fecha_fin",
            "comunicada",
          ],
          [
            "S1",
            "7.90",
            new Date("2026-08-01T00:00:00Z"),
            new Date("2026-08-31T00:00:00Z"),
            "sí",
          ],
        ],
      },
      conExistentes({ sku: ["S1"] }),
    );

    expect(r.errores).toEqual([]);
    expect(r.lote.promocion[0]?.fecha_inicio).toBe("2026-08-01");
    expect(r.lote.promocion[0]?.comunicada).toBe(true);
  });

  it("una promoción que termina antes de empezar se señala", () => {
    const r = validarMaestro(
      {
        promocion: [
          [
            "sku_codigo_externo",
            "precio_promo",
            "fecha_inicio",
            "fecha_fin",
            "comunicada",
          ],
          ["S1", "7.90", "2026-08-31", "2026-08-01", "no"],
        ],
      },
      conExistentes({ sku: ["S1"] }),
    );

    expect(r.errores[0]?.mensaje).toMatch(/antes de empezar/);
  });

  it("media coordenada no ubica nada: se exigen las dos o ninguna", () => {
    // Guardar solo la latitud dejaría una geocerca en el meridiano de Greenwich
    // con la que ningún check-in cuadraría.
    const conMedia = validarMaestro(
      {
        tienda: [
          ["codigo_externo", "cadena_codigo_externo", "nombre", "lat", "lon"],
          ["T1", "PV", "Plaza Vea Surco", "-12.1", ""],
        ],
      },
      conExistentes({ cadena: ["PV"] }),
    );
    expect(conMedia.errores).toHaveLength(1);

    const sinNinguna = validarMaestro(
      {
        tienda: [
          ["codigo_externo", "cadena_codigo_externo", "nombre", "lat", "lon"],
          ["T1", "PV", "Plaza Vea Surco", "", ""],
        ],
      },
      conExistentes({ cadena: ["PV"] }),
    );
    expect(sinNinguna.errores).toEqual([]);
  });
});

describe("todo o nada", () => {
  it("con UN error el lote sale vacío, aunque las demás filas fueran válidas", () => {
    // El criterio de aceptación es que no se aplique ninguna. Devolver el lote a
    // medias invita a que alguien lo mande de todas formas.
    const r = validarMaestro(
      {
        marca: [
          ["codigo_externo", "nombre"],
          ["MRC", "Maracumango"],
          ["OTRA", "Otra marca"],
          ["", "La rota"],
        ],
      },
      NADA,
    );

    expect(r.errores).toHaveLength(1);
    expect(r.lote.marca).toEqual([]);
  });

  it("sin errores devuelve el lote completo y listo para aplicar", () => {
    const r = validarMaestro(
      {
        ...MARCAS,
        cadena: [
          ["codigo_externo", "nombre", "tipo_tienda"],
          ["PV", "Plaza Vea", "super"],
        ],
      },
      NADA,
    );

    expect(r.errores).toEqual([]);
    expect(r.lote.marca).toEqual([
      {
        codigo_externo: "MRC",
        nombre: "Maracumango",
        tolerancia_precio_pct: 5,
      },
    ]);
    expect(r.lote.cadena[0]?.tipo_tienda).toBe("super");
  });
});

describe("los topes", () => {
  it("no devuelve miles de errores: los cuenta y los recorta", () => {
    // Una cabecera bien puesta pero con todas las filas rotas genera un error por
    // fila. Mandar cinco mil a la pantalla no ayuda y hincha la fila `importacion`.
    const filas = Array.from({ length: TOPE_ERRORES + 50 }, () => [
      "",
      "Sin código",
    ]);
    const r = validarMaestro(
      { marca: [["codigo_externo", "nombre"], ...filas] },
      NADA,
    );

    expect(r.errores).toHaveLength(TOPE_ERRORES);
    expect(r.erroresOmitidos).toBe(50);
  });
});
