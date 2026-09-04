import { describe, expect, it } from "vitest";

import { clavesExistentes } from "./existentes";

// Qué códigos del maestro ya están en la base. Lo que más importa: que la
// respuesta sea la del CLIENTE de la importación y no la de cualquiera.

const TENANT = "aaaaaaaa-0000-0000-0000-000000000001";

type Fila = { codigo_externo: string; tenant_id: string };

/** Un cliente que APUNTA los filtros y los aplica, como el de verdad. */
function clienteFalso(filas: Fila[], opciones: { error?: string } = {}) {
  const consultas: { tabla: string; tenant: string; codigos: string[] }[] = [];

  const cliente = {
    from: (tabla: string) => {
      let tenant = "";
      const encadenable = {
        select: () => encadenable,
        eq: (_columna: string, valor: string) => {
          tenant = valor;
          return encadenable;
        },
        in: (_columna: string, codigos: string[]) => {
          consultas.push({ tabla, tenant, codigos });
          if (opciones.error) {
            return Promise.resolve({
              data: null,
              error: { message: opciones.error },
            });
          }
          return Promise.resolve({
            data: filas.filter(
              (f) =>
                f.tenant_id === tenant && codigos.includes(f.codigo_externo),
            ),
            error: null,
          });
        },
      };
      return encadenable;
    },
  };

  return { cliente, consultas };
}

const SIN_REFERENCIAS = {
  marca: [],
  categoria: [],
  cadena: [],
  sku: [],
  tienda: [],
};

describe("clavesExistentes", () => {
  it("NO da por existente un código que es de OTRO cliente", async () => {
    // La RLS deja al admin leer todos los clientes, así que sin el filtro de
    // tenant la validación diría «la marca existe», la vista previa saldría sin
    // errores y la aplicación abortaría después — con el operador sin saber qué
    // corregir. Los códigos se repiten entre clientes con facilidad: «SKU001».
    const { cliente } = clienteFalso([
      { codigo_externo: "COMPARTIDO", tenant_id: "bbbb-otro-cliente" },
    ]);

    const r = await clavesExistentes(cliente as never, TENANT, {
      ...SIN_REFERENCIAS,
      marca: ["COMPARTIDO"],
    });

    expect(r.marca.has("COMPARTIDO")).toBe(false);
  });

  it("sí lo da por existente cuando es del cliente de la importación", async () => {
    const { cliente } = clienteFalso([
      { codigo_externo: "MRC", tenant_id: TENANT },
    ]);

    const r = await clavesExistentes(cliente as never, TENANT, {
      ...SIN_REFERENCIAS,
      marca: ["MRC"],
    });

    expect(r.marca.has("MRC")).toBe(true);
  });

  it("filtra por el tenant en TODAS las tablas, no solo en una", async () => {
    const { cliente, consultas } = clienteFalso([]);

    await clavesExistentes(cliente as never, TENANT, {
      marca: ["A"],
      categoria: ["E"],
      cadena: ["B"],
      sku: ["C"],
      tienda: ["D"],
    });

    // Una por tabla referenciable. El número sale de las claves que se piden, no
    // de un literal: así una tabla nueva entra sola y no deja este test viejo.
    expect(consultas).toHaveLength(5);
    expect(consultas.map((c) => c.tabla).sort()).toEqual([
      "cadena",
      "categoria",
      "marca",
      "sku",
      "tienda",
    ]);
    expect(consultas.every((c) => c.tenant === TENANT)).toBe(true);
  });

  it("trocea las consultas: PostgREST manda el `in` en la URL", async () => {
    // Con cuatrocientos códigos en una sola consulta, la URL revienta por
    // longitud y la lectura falla entera.
    const muchos = Array.from({ length: 250 }, (_, i) => `C${i}`);
    const { cliente, consultas } = clienteFalso([]);

    await clavesExistentes(cliente as never, TENANT, {
      ...SIN_REFERENCIAS,
      sku: muchos,
    });

    expect(consultas).toHaveLength(3);
    expect(consultas.every((c) => c.codigos.length <= 100)).toBe(true);
    // Y no se pierde ninguno por el camino.
    expect(consultas.flatMap((c) => c.codigos)).toHaveLength(250);
  });

  it("no consulta nada si el archivo no referencia nada", async () => {
    const { cliente, consultas } = clienteFalso([]);
    await clavesExistentes(cliente as never, TENANT, SIN_REFERENCIAS);
    expect(consultas).toEqual([]);
  });

  it("un fallo de lectura LANZA: no puede pasar por «no existe ninguno»", async () => {
    // Si se tragara el error, la validación marcaría todas las referencias como
    // rotas y el operador buscaría en su Excel un problema que está en la red.
    const { cliente } = clienteFalso([], { error: "conexión perdida" });

    await expect(
      clavesExistentes(cliente as never, TENANT, {
        ...SIN_REFERENCIAS,
        marca: ["MRC"],
      }),
    ).rejects.toThrow(/no se pudieron leer/i);
  });
});
