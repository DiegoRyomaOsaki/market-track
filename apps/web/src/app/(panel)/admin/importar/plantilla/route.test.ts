import { beforeEach, describe, expect, it, vi } from "vitest";

import { GET } from "./route";

const { sesion } = vi.hoisted(() => ({
  sesion: { actual: null as { perfil: { rol: string } } | null },
}));

vi.mock("@/lib/panel/sesion", () => ({
  sesionDeStaff: () => Promise.resolve(sesion.actual),
}));

// Un route handler es un endpoint por sí mismo: que el enlace solo se pinte en
// `/admin` no lo protege. Lo que se comprueba aquí es el gate, no el .xlsx —de
// que el archivo sea el que el importador espera se encarga
// `plantilla-archivo.test.ts`, contra el parseo de verdad.

beforeEach(() => {
  sesion.actual = { perfil: { rol: "admin" } };
});

describe("GET /admin/importar/plantilla", () => {
  it("un supervisor no se la lleva", async () => {
    sesion.actual = { perfil: { rol: "supervisor" } };
    expect((await GET()).status).toBe(403);
  });

  it("sin sesión tampoco", async () => {
    sesion.actual = null;
    expect((await GET()).status).toBe(403);
  });

  it("al admin le devuelve un .xlsx con nombre de archivo", async () => {
    const res = await GET();

    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toContain("spreadsheetml.sheet");
    expect(res.headers.get("Content-Disposition")).toContain(".xlsx");
  });

  it("no se cachea: se genera desde las columnas en cada petición", async () => {
    // Cachearla es exactamente el desfase que la generación evita.
    expect((await GET()).headers.get("Cache-Control")).toBe("no-store");
  });

  it("el cuerpo es un zip de verdad, no un error serializado", async () => {
    const bytes = Buffer.from(await (await GET()).arrayBuffer());

    expect(bytes.byteLength).toBeGreaterThan(0);
    // "PK": la firma de un zip, que es lo que un .xlsx es por dentro.
    expect(bytes.subarray(0, 2).toString()).toBe("PK");
  });
});
