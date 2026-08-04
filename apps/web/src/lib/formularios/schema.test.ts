import { TOPES_FORMULARIO } from "@market-track/shared";
import { describe, expect, it } from "vitest";

import {
  altaFormularioSchema,
  borradorDefinicionSchema,
  publicarSchema,
} from "./schema";

const TENANT = "aaaaaaaa-0000-0000-0000-000000000001";
const MARCA = "bbbbbbbb-0000-0000-0000-000000000002";

describe("altaFormularioSchema", () => {
  it("acepta un formulario con nombre y cliente, sin marca", () => {
    const r = altaFormularioSchema.parse({
      nombre: "Levantamiento base",
      tenant_id: TENANT,
    });
    expect(r.marca_id).toBeNull();
  });

  it("una marca vacía viaja como null: aplica a todas las marcas del cliente", () => {
    const r = altaFormularioSchema.parse({
      nombre: "X",
      tenant_id: TENANT,
      marca_id: "",
    });
    expect(r.marca_id).toBeNull();
  });

  it("conserva la marca cuando se elige", () => {
    const r = altaFormularioSchema.parse({
      nombre: "X",
      tenant_id: TENANT,
      marca_id: MARCA,
    });
    expect(r.marca_id).toBe(MARCA);
  });

  it("exige un cliente y que sea un uuid", () => {
    expect(altaFormularioSchema.safeParse({ nombre: "X" }).success).toBe(false);
    expect(
      altaFormularioSchema.safeParse({ nombre: "X", tenant_id: "no-uuid" })
        .success,
    ).toBe(false);
  });

  it("rechaza un nombre vacío", () => {
    expect(
      altaFormularioSchema.safeParse({ nombre: "  ", tenant_id: TENANT })
        .success,
    ).toBe(false);
  });
});

describe("borradorDefinicionSchema", () => {
  it("acepta un borrador vacío: se guarda a medio construir", () => {
    expect(borradorDefinicionSchema.parse({ pasos: [] }).pasos).toHaveLength(0);
  });

  it("acepta un campo sin etiqueta y un paso sin campos (aún en borrador)", () => {
    const r = borradorDefinicionSchema.parse({
      pasos: [
        {
          id: "p1",
          titulo: "",
          orden: 0,
          campos: [{ id: "c1", tipo: "texto", etiqueta: "" }],
        },
      ],
    });
    expect(r.pasos[0]?.campos[0]?.obligatorio).toBe(false);
  });

  it("rechaza un tipo de campo desconocido", () => {
    expect(
      borradorDefinicionSchema.safeParse({
        pasos: [
          {
            id: "p1",
            titulo: "",
            orden: 0,
            campos: [{ id: "c1", tipo: "color", etiqueta: "X" }],
          },
        ],
      }).success,
    ).toBe(false);
  });
});

describe("topes del borrador", () => {
  // El borrador relaja los MÍNIMOS (se guarda a medio editar), pero no los
  // topes: son lo que impide que una fila crezca sin límite, y eso no depende
  // de si el trabajo está terminado.

  it("rechaza un borrador con más pasos de los permitidos", () => {
    const pasos = Array.from(
      { length: TOPES_FORMULARIO.pasos + 1 },
      (_, i) => ({
        id: `p${i}`,
        titulo: "",
        orden: i,
        campos: [],
      }),
    );
    expect(borradorDefinicionSchema.safeParse({ pasos }).success).toBe(false);
  });

  it("rechaza una etiqueta desmesurada aunque el borrador permita vacías", () => {
    expect(
      borradorDefinicionSchema.safeParse({
        pasos: [
          {
            id: "p1",
            titulo: "",
            orden: 0,
            campos: [{ id: "c", tipo: "texto", etiqueta: "x".repeat(121) }],
          },
        ],
      }).success,
    ).toBe(false);
  });

  it("sigue aceptando el borrador a medio editar", () => {
    expect(
      borradorDefinicionSchema.safeParse({
        pasos: [
          {
            id: "p1",
            titulo: "",
            orden: 0,
            campos: [{ id: "c", tipo: "texto", etiqueta: "" }],
          },
        ],
      }).success,
    ).toBe(true);
  });

  it("aplica al borrador el resto de topes, no solo pasos y etiqueta", () => {
    const demasiadasOpciones = Array.from(
      { length: TOPES_FORMULARIO.opcionesPorCampo + 1 },
      (_, i) => `O${i}`,
    );
    const casos: Record<string, unknown>[] = [
      {
        id: "x".repeat(TOPES_FORMULARIO.idChars + 1),
        tipo: "texto",
        etiqueta: "",
      },
      {
        id: "c",
        tipo: "texto",
        etiqueta: "",
        ayuda: "x".repeat(TOPES_FORMULARIO.ayudaChars + 1),
      },
      {
        id: "c",
        tipo: "seleccion",
        etiqueta: "",
        opciones: demasiadasOpciones,
      },
      {
        id: "c",
        tipo: "seleccion",
        etiqueta: "",
        opciones: ["x".repeat(TOPES_FORMULARIO.opcionChars + 1)],
      },
    ];
    for (const campo of casos) {
      expect(
        borradorDefinicionSchema.safeParse({
          pasos: [{ id: "p1", titulo: "", orden: 0, campos: [campo] }],
        }).success,
      ).toBe(false);
    }
  });

  it("rechaza un borrador con más campos de los permitidos en un paso", () => {
    const campos = Array.from(
      { length: TOPES_FORMULARIO.camposPorPaso + 1 },
      (_, i) => ({ id: `c${i}`, tipo: "texto", etiqueta: "" }),
    );
    expect(
      borradorDefinicionSchema.safeParse({
        pasos: [{ id: "p1", titulo: "", orden: 0, campos }],
      }).success,
    ).toBe(false);
  });

  it("un rango invertido SÍ se puede guardar como borrador", () => {
    // El admin puede teclear el máximo antes que el mínimo; bloquearlo aquí
    // haría imposible escribir. La verja está al publicar.
    expect(
      borradorDefinicionSchema.safeParse({
        pasos: [
          {
            id: "p1",
            titulo: "",
            orden: 0,
            campos: [
              { id: "n", tipo: "entero", etiqueta: "N", min: 10, max: 5 },
            ],
          },
        ],
      }).success,
    ).toBe(true);
  });
});

describe("publicarSchema", () => {
  const definicionValida = {
    pasos: [
      {
        id: "p1",
        titulo: "Datos extra",
        orden: 0,
        campos: [{ id: "temp", tipo: "decimal", etiqueta: "Temperatura" }],
      },
    ],
  };

  it("acepta una definición completa", () => {
    expect(
      publicarSchema.safeParse({
        nombre: "Base",
        activo: true,
        definicion: definicionValida,
      }).success,
    ).toBe(true);
  });

  it("rechaza publicar sin pasos", () => {
    expect(
      publicarSchema.safeParse({
        nombre: "Base",
        activo: true,
        definicion: { pasos: [] },
      }).success,
    ).toBe(false);
  });

  it("rechaza publicar un rango invertido: el portero no depende del navegador", () => {
    // El constructor ya lo comprobaba para apagar el botón "Publicar". Esta es
    // la comprobación que protege a quien no pasa por ese botón.
    expect(
      publicarSchema.safeParse({
        nombre: "Base",
        activo: true,
        definicion: {
          pasos: [
            {
              id: "p1",
              titulo: "X",
              orden: 0,
              campos: [
                { id: "n", tipo: "entero", etiqueta: "N", min: 10, max: 5 },
              ],
            },
          ],
        },
      }).success,
    ).toBe(false);
  });

  it("rechaza publicar un campo de selección sin opciones", () => {
    expect(
      publicarSchema.safeParse({
        nombre: "Base",
        activo: true,
        definicion: {
          pasos: [
            {
              id: "p1",
              titulo: "X",
              orden: 0,
              campos: [{ id: "c1", tipo: "seleccion", etiqueta: "Estado" }],
            },
          ],
        },
      }).success,
    ).toBe(false);
  });
});
