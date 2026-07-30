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
