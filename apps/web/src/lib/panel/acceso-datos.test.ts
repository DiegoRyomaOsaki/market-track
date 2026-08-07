import { beforeEach, describe, expect, it, vi } from "vitest";

import { datosDeAcceso } from "./acceso-datos";

// Lo que la pantalla de acceso carga. Lo que más importa: a QUIÉN se le puede
// emitir un pase, porque esa lista lleva el nombre y el DNI de personas reales.

type SesionFalsa = { supabase: unknown; perfil: unknown } | null;

const { sesion, consulta } = vi.hoisted(() => ({
  sesion: { actual: null as SesionFalsa },
  consulta: { filtros: [] as [string, unknown][] },
}));

vi.mock("@/lib/panel/sesion", () => ({
  sesionDeStaff: () => Promise.resolve(sesion.actual),
}));

const MERCADERISTAS = [
  {
    id: "m1",
    nombre: "José Quispe",
    dni: "10000004",
    rol: "mercaderista",
    activo: true,
    supervisor_id: "sup-1",
  },
  {
    id: "m2",
    nombre: "Ajeno",
    dni: "10000009",
    rol: "mercaderista",
    activo: true,
    supervisor_id: "sup-2",
  },
  {
    id: "m3",
    nombre: "De baja",
    dni: "10000010",
    rol: "mercaderista",
    activo: false,
    supervisor_id: "sup-1",
  },
];

/** Un cliente mínimo que APUNTA los filtros y los aplica, como el de verdad. */
function clienteFalso(opciones: {
  config?: { data: unknown; error: { message: string } | null };
  rpc?: { data: unknown; error: { message: string } | null };
  perfilesError?: { message: string } | null;
}) {
  const consultaProfile = () => {
    const filtros: [string, unknown][] = [];
    const encadenable = {
      select: () => encadenable,
      eq: (col: string, val: unknown) => {
        filtros.push([col, val]);
        consulta.filtros = filtros;
        return encadenable;
      },
      order: () => encadenable,
      then: (resolver: (r: unknown) => unknown) =>
        Promise.resolve({
          data: opciones.perfilesError
            ? null
            : MERCADERISTAS.filter((m) =>
                filtros.every(
                  ([col, val]) => (m as Record<string, unknown>)[col] === val,
                ),
              ),
          error: opciones.perfilesError ?? null,
        }).then(resolver),
    };
    return encadenable;
  };

  const config = () => {
    const encadenable = {
      select: () => encadenable,
      eq: () => encadenable,
      maybeSingle: () =>
        Promise.resolve(
          opciones.config ?? {
            data: { otp_canales_habilitados: ["correo", "sms"] },
            error: null,
          },
        ),
    };
    return encadenable;
  };

  return {
    from: (tabla: string) =>
      tabla === "profile" ? consultaProfile() : config(),
    rpc: () =>
      Promise.resolve(opciones.rpc ?? { data: [{ id: "p1" }], error: null }),
  };
}

function conSesion(
  rol: "admin" | "supervisor",
  opciones: Parameters<typeof clienteFalso>[0] = {},
) {
  sesion.actual = {
    supabase: clienteFalso(opciones),
    perfil: { id: "sup-1", rol, nombre: "Quien mira" },
  };
}

beforeEach(() => {
  sesion.actual = null;
  consulta.filtros = [];
  vi.restoreAllMocks();
});

describe("datosDeAcceso", () => {
  it("el supervisor SOLO ve a los mercaderistas de su equipo", async () => {
    // `profile_staff_lee_todo` deja a cualquier staff leer la plantilla entera,
    // así que sin este filtro la pantalla le enseñaría el nombre y el DNI de los
    // mercaderistas de otros supervisores — y de otros clientes.
    conSesion("supervisor");

    const { elegibles } = await datosDeAcceso();

    expect(elegibles.map((e) => e.id)).toEqual(["m1"]);
    expect(consulta.filtros).toContainEqual(["supervisor_id", "sup-1"]);
  });

  it("el admin los ve todos: no se le acota por equipo", async () => {
    conSesion("admin");

    const { elegibles } = await datosDeAcceso();

    expect(elegibles.map((e) => e.id)).toEqual(["m1", "m2"]);
    expect(consulta.filtros).not.toContainEqual(["supervisor_id", "sup-1"]);
  });

  it("nunca ofrece a alguien dado de baja: su pase no serviría", async () => {
    conSesion("admin");
    const { elegibles } = await datosDeAcceso();
    expect(elegibles.map((e) => e.id)).not.toContain("m3");
  });

  it("solo mercaderistas: el pase es su rescate, no el de un supervisor", async () => {
    conSesion("admin");
    await datosDeAcceso();
    expect(consulta.filtros).toContainEqual(["rol", "mercaderista"]);
    expect(consulta.filtros).toContainEqual(["activo", true]);
  });

  it("sin sesión de staff no devuelve datos de nadie", async () => {
    sesion.actual = null;
    const r = await datosDeAcceso();
    expect(r.elegibles).toEqual([]);
    expect(r.pases).toEqual([]);
    expect(r.error).not.toBeNull();
  });

  it("un fallo de CUALQUIERA de las tres cargas se dice, no se disfraza de vacío", async () => {
    // Enseñar «no hay pases» cuando la consulta falló haría creer al operador
    // que nadie emitió ninguno.
    const error = vi.spyOn(console, "error").mockImplementation(() => {});

    for (const opciones of [
      { config: { data: null, error: { message: "config caída" } } },
      { rpc: { data: null, error: { message: "rpc caída" } } },
      { perfilesError: { message: "perfiles caídos" } },
    ]) {
      conSesion("admin", opciones);
      const r = await datosDeAcceso();
      expect(r.error).not.toBeNull();
      expect(r.pases).toEqual([]);
    }
    expect(error).toHaveBeenCalledTimes(3);
  });

  it("si la configuración no existe todavía, el correo sigue siendo el canal", async () => {
    conSesion("admin", { config: { data: null, error: null } });
    expect((await datosDeAcceso()).canales).toEqual(["correo"]);
  });
});
