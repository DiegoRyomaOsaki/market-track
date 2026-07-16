import { Constants } from "@market-track/db";
import { describe, expect, it } from "vitest";

import { puedeAccederA, SEGMENTOS, segmentoDeRuta } from "./authz";

// Los tres roles con sección web (el mercaderista no tiene web).
const ROLES_WEB = ["admin", "supervisor", "cliente"] as const;

describe("puedeAccederA", () => {
  it("cada rol web entra SOLO a su propio segmento (matriz completa)", () => {
    // Cubre explícitamente que admin NO es un super-rol: admin→/supervisor y
    // admin→/cliente deniegan, igual que cualquier cruce entre roles.
    for (const rol of ROLES_WEB) {
      for (const segmento of SEGMENTOS) {
        expect(puedeAccederA(rol, segmento)).toBe(rol === segmento);
      }
    }
  });

  it("un cliente que va a /admin es denegado (criterio de aceptación)", () => {
    expect(puedeAccederA("cliente", "admin")).toBe(false);
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

  it("exige coincidencia EXACTA, no por prefijo", () => {
    // Si esto se rompe (p. ej. un refactor a startsWith), `/administrador` caería
    // en el gate de admin: un agujero de enrutado silencioso.
    expect(segmentoDeRuta("/administrador")).toBeNull();
    expect(segmentoDeRuta("/clientes")).toBeNull();
  });

  it("devuelve null para rutas fuera de control por rol", () => {
    expect(segmentoDeRuta("/")).toBeNull();
    expect(segmentoDeRuta("")).toBeNull();
    expect(segmentoDeRuta("/login")).toBeNull();
    expect(segmentoDeRuta("/otra-cosa")).toBeNull();
  });
});
