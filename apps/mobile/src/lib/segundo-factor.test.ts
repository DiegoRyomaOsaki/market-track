import { describe, expect, it } from "@jest/globals";

import { factorUsable, pasoTras2fa } from "./segundo-factor";

const verificado = { id: "v", factor_type: "phone", status: "verified" };
const aMedias = { id: "m", factor_type: "phone", status: "unverified" };
const totp = { id: "t", factor_type: "totp", status: "verified" };

describe("factorUsable", () => {
  it("prefiere el factor de teléfono verificado", () => {
    expect(factorUsable([aMedias, verificado])?.id).toBe("v");
  });

  it("reutiliza un enrolamiento a medias antes que crear otro", () => {
    // Supabase no deja dos factores de teléfono: si el anterior quedó a medias,
    // se retoma ese en vez de intentar enrolar uno nuevo (que fallaría).
    expect(factorUsable([aMedias])?.id).toBe("m");
  });

  it("ignora factores que no son de teléfono", () => {
    expect(factorUsable([totp])).toBeNull();
  });

  it("sin factores, no hay ninguno usable", () => {
    expect(factorUsable([])).toBeNull();
  });
});

describe("pasoTras2fa", () => {
  it("con un factor usable, va directo a pedir el código", () => {
    expect(pasoTras2fa([verificado])).toBe("codigo");
  });

  it("sin factor, primero hay que enrolar el teléfono", () => {
    expect(pasoTras2fa([])).toBe("telefono");
    expect(pasoTras2fa([totp])).toBe("telefono");
  });
});
