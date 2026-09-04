import { describe, expect, it } from "vitest";

import { esVigenteEn, etiquetaVigencia } from "./vigencia";

const HOY = "2026-09-04";

describe("esVigenteEn", () => {
  it("un periodo sin fin sigue vigente", () => {
    expect(esVigenteEn("2026-01-01", null, HOY)).toBe(true);
  });

  it("el día del cierre TODAVÍA está dentro: `vigente_hasta` es inclusivo", () => {
    // El borde que decide si un reporte de hoy cuenta el precio de hoy.
    expect(esVigenteEn("2026-01-01", HOY, HOY)).toBe(true);
  });

  it("el día siguiente al cierre ya está fuera", () => {
    expect(esVigenteEn("2026-01-01", "2026-09-03", HOY)).toBe(false);
  });

  it("un periodo que empieza mañana todavía no rige", () => {
    expect(esVigenteEn("2026-09-05", null, HOY)).toBe(false);
  });

  it("el día del arranque ya rige: `vigente_desde` también es inclusivo", () => {
    expect(esVigenteEn(HOY, null, HOY)).toBe(true);
  });
});

describe("etiquetaVigencia", () => {
  it("distingue los tres estados con TEXTO, no solo con color", () => {
    expect(etiquetaVigencia("2026-01-01", null, HOY)).toBe("Vigente");
    expect(etiquetaVigencia("2027-01-01", null, HOY)).toBe("Programado");
    expect(etiquetaVigencia("2026-01-01", "2026-06-30", HOY)).toBe("Cerrado");
  });

  it("un periodo futuro NO dice «Vigente»", () => {
    // Diría que rige algo que aún no ha empezado, que es justo la confusión que
    // este módulo existe para evitar.
    expect(etiquetaVigencia("2026-12-01", "2026-12-31", HOY)).not.toBe(
      "Vigente",
    );
  });
});
