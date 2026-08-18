// Tests del guardarraíl de migraciones. Corren con `pnpm test:scripts` (Vitest
// desde la raíz) y en CI: sin disco, sin git, sin red — solo la función pura.

import { describe, expect, it } from "vitest";

import { revisarMigraciones, versionDe } from "./verificar-migraciones.mjs";

const BASE = ["20260814100000_motor.sql", "20260815100000_panel_metricas.sql"];

describe("versionDe", () => {
  it("saca los 14 dígitos de un nombre válido", () => {
    expect(versionDe("20260817120000_autenticidad_de_foto.sql")).toBe(
      "20260817120000",
    );
  });

  it("devuelve null para lo que el CLI de Supabase saltaría en silencio", () => {
    expect(versionDe(".gitkeep")).toBeNull();
    expect(versionDe("arreglo_urgente.sql")).toBeNull();
    // Trece dígitos: se parece, pero el CLI no lo reconoce.
    expect(versionDe("2026081712000_corto.sql")).toBeNull();
    expect(versionDe("20260817120000-guion.sql")).toBeNull();
    expect(versionDe("20260817120000_sin_extension")).toBeNull();
  });
});

describe("revisarMigraciones", () => {
  it("no se queja de un conjunto sano", () => {
    expect(
      revisarMigraciones({
        locales: [...BASE, "20260816100000_nueva.sql", ".gitkeep"],
        enLaBase: BASE,
      }),
    ).toEqual([]);
  });

  it("ignora lo que no es .sql, incluido el .gitkeep de la carpeta", () => {
    expect(
      revisarMigraciones({ locales: [".gitkeep", "README.md"], enLaBase: [] }),
    ).toEqual([]);
  });

  it("delata un .sql con nombre inválido, que no se aplicaría nunca", () => {
    const problemas = revisarMigraciones({
      locales: [...BASE, "arreglo_a_mano.sql"],
      enLaBase: BASE,
    });
    expect(problemas).toHaveLength(1);
    expect(problemas[0]).toContain("arreglo_a_mano.sql");
    expect(problemas[0]).toMatch(/SALTA/);
  });

  it("delata dos migraciones que dicen ser la misma versión (el choque de dos ramas)", () => {
    const problemas = revisarMigraciones({
      locales: [
        ...BASE,
        "20260817100000_canje_de_pase.sql",
        "20260817100000_trabajo_de_campo.sql",
      ],
      enLaBase: BASE,
    });
    expect(problemas).toHaveLength(1);
    expect(problemas[0]).toContain("20260817100000");
    expect(problemas[0]).toContain("canje_de_pase");
    expect(problemas[0]).toContain("trabajo_de_campo");
  });

  it("delata una añadida que ordena antes de la última de la base", () => {
    // El caso real: 20260814120000 llegó cuando 20260815100000 ya estaba.
    const problemas = revisarMigraciones({
      locales: [...BASE, "20260814120000_ventanas_lima.sql"],
      enLaBase: BASE,
    });
    expect(problemas).toHaveLength(1);
    expect(problemas[0]).toContain("20260814120000_ventanas_lima.sql");
    expect(problemas[0]).toContain("20260815100000");
  });

  it("delata también la que EMPATA con la última de la base, por las dos vías", () => {
    // Empatar es a la vez duplicar una versión y no ordenar por encima de la
    // base, así que sale por partida doble. Es correcto: renumerar arregla las
    // dos, y decirlo dos veces es mejor que callarse una.
    const problemas = revisarMigraciones({
      locales: [...BASE, "20260815100000_otra_cosa.sql"],
      enLaBase: BASE,
    });
    expect(problemas).toHaveLength(2);
    expect(problemas.join("\n")).toContain("20260815100000_otra_cosa.sql");
    expect(problemas.join("\n")).toMatch(/Renumera todas menos una/);
    expect(problemas.join("\n")).toMatch(/ordena antes de|Renumérala/);
  });

  it("no acusa a las que YA estaban en la base, por desordenadas que estén", () => {
    // La base ya vive con su desorden histórico; este guardarraíl mira lo que
    // añade la rama, no reabre lo mergeado.
    const conDesorden = [...BASE, "20260814120000_ventanas_lima.sql"];
    expect(
      revisarMigraciones({ locales: conDesorden, enLaBase: conDesorden }),
    ).toEqual([]);
  });

  it("sin rama base solo comprueba nombres y duplicados, no el orden", () => {
    expect(
      revisarMigraciones({
        locales: [...BASE, "20260101000000_antiquisima.sql"],
        enLaBase: [],
      }),
    ).toEqual([]);
  });

  it("acumula los problemas de varias familias a la vez", () => {
    const problemas = revisarMigraciones({
      locales: [
        ...BASE,
        "suelta.sql",
        "20260817100000_a.sql",
        "20260817100000_b.sql",
        "20260814120000_vieja.sql",
      ],
      enLaBase: BASE,
    });
    expect(problemas).toHaveLength(3);
    expect(problemas.join("\n")).toContain("suelta.sql");
    expect(problemas.join("\n")).toContain("20260817100000");
    expect(problemas.join("\n")).toContain("20260814120000_vieja.sql");
  });
});
