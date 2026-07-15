import { Constants } from "@market-track/db";
import { describe, expect, it } from "vitest";

import { puedeAccederA, SEGMENTOS, segmentoDeRuta } from "./authz";

describe("puedeAccederA", () => {
  it("admin entra a /admin", () => {
    expect(puedeAccederA("admin", "admin")).toBe(true);
  });

  it("un cliente que va a /admin es denegado (403)", () => {
    expect(puedeAccederA("cliente", "admin")).toBe(false);
  });

  it("el cliente entra a su portal", () => {
    expect(puedeAccederA("cliente", "cliente")).toBe(true);
  });

  it("el supervisor entra a /supervisor pero no al portal del cliente", () => {
    expect(puedeAccederA("supervisor", "supervisor")).toBe(true);
    expect(puedeAccederA("supervisor", "cliente")).toBe(false);
  });

  it("el mercaderista no entra a ninguna sección web", () => {
    for (const segmento of SEGMENTOS) {
      expect(puedeAccederA("mercaderista", segmento)).toBe(false);
    }
  });

  it("rol null (sin sesión o rol ilegible) deniega todo — fail-closed", () => {
    for (const segmento of SEGMENTOS) {
      expect(puedeAccederA(null, segmento)).toBe(false);
    }
  });

  it("todo rol del enum de la base está mapeado (contrato exhaustivo)", () => {
    // El Record<RolUsuario,...> ya rompe la compilación si falta un rol; este test
    // recorre el enum REAL de la base: si los tipos generados quedaran viejos, un
    // rol sin entrada haría explotar el índice aquí en vez de pasar en silencio.
    for (const rol of Constants.public.Enums.rol_usuario) {
      expect(typeof puedeAccederA(rol, "admin")).toBe("boolean");
    }
  });
});

describe("segmentoDeRuta", () => {
  it("extrae el segmento controlado de la ruta", () => {
    expect(segmentoDeRuta("/admin")).toBe("admin");
    expect(segmentoDeRuta("/supervisor/visitas/123")).toBe("supervisor");
    expect(segmentoDeRuta("/cliente")).toBe("cliente");
  });

  it("devuelve null para rutas fuera de control por rol", () => {
    expect(segmentoDeRuta("/")).toBeNull();
    expect(segmentoDeRuta("/login")).toBeNull();
    expect(segmentoDeRuta("/otra-cosa")).toBeNull();
  });
});
