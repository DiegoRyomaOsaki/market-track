import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  agregarParada,
  duplicarPeriodo,
  fijarHoraParada,
  publicarRutero,
  quitarParada,
  reordenarParadas,
} from "./acciones-ruteros";
import { perfilesConStaff, supabaseFalso } from "./supabase-falso";

// El gate y la validación de las acciones de planeación. Una server action es un
// endpoint POST: no la protege que el botón viva en `/supervisor`.

const { crearCliente, revalidatePath } = vi.hoisted(() => ({
  crearCliente: vi.fn(),
  revalidatePath: vi.fn(),
}));

vi.mock("next/cache", () => ({ revalidatePath }));
vi.mock("@/lib/supabase/server", () => ({
  createServerSupabaseClient: () => Promise.resolve(crearCliente()),
}));

// Ids con la forma del seed: NO cumplen los bits de versión del RFC 9562. Con
// `z.uuid()` en vez de `z.guid()` las acciones los rechazarían.
const RUTERO = "a0000008-0000-0000-0000-000000000001";
const PARADA = "a0000009-0000-0000-0000-000000000001";
const OTRA_PARADA = "a0000009-0000-0000-0000-000000000002";
const MERCADERISTA = "44444444-4444-4444-4444-444444444444";
const TIENDA = "a0000002-0000-0000-0000-000000000001";

let espia: ReturnType<typeof supabaseFalso>;

function conSupabase(
  rol: string | null,
  opciones: Partial<Parameters<typeof supabaseFalso>[0]> = {},
) {
  espia = supabaseFalso({ perfiles: perfilesConStaff(rol), ...opciones });
  crearCliente.mockReturnValue(espia.cliente);
  return espia;
}

const DUPLICAR_VALIDO = {
  mercaderistaId: MERCADERISTA,
  desde: "2026-08-03",
  hasta: "2026-08-09",
  dias: 7,
};

beforeEach(() => {
  crearCliente.mockReset();
  revalidatePath.mockReset();
});

describe("el gate de staff", () => {
  const llamadas: [string, () => Promise<{ ok: boolean }>][] = [
    [
      "agregarParada",
      () =>
        agregarParada({
          mercaderistaId: MERCADERISTA,
          fecha: "2026-08-03",
          tiendaId: TIENDA,
        }),
    ],
    ["quitarParada", () => quitarParada({ paradaId: PARADA })],
    [
      "reordenarParadas",
      () => reordenarParadas({ ruteroId: RUTERO, paradas: [PARADA] }),
    ],
    ["publicarRutero", () => publicarRutero({ ruteroId: RUTERO })],
    [
      "fijarHoraParada",
      () => fijarHoraParada({ paradaId: PARADA, hora: "08:30" }),
    ],
    ["duplicarPeriodo", () => duplicarPeriodo(DUPLICAR_VALIDO)],
  ];

  it.each(llamadas)(
    "%s rechaza al mercaderista sin tocar nada",
    async (_n, llamar) => {
      conSupabase("mercaderista");
      await expect(llamar()).resolves.toMatchObject({ ok: false });
      expect(espia.rpcsPedidas).toHaveLength(0);
      expect(espia.tablasPedidas).not.toContain("rutero");
      expect(espia.tablasPedidas).not.toContain("rutero_parada");
    },
  );

  it.each(llamadas)("%s rechaza al cliente-marca", async (_n, llamar) => {
    conSupabase("cliente");
    await expect(llamar()).resolves.toMatchObject({ ok: false });
    expect(espia.rpcsPedidas).toHaveLength(0);
  });

  it.each(llamadas)(
    "%s rechaza a quien no tiene sesión",
    async (_n, llamar) => {
      conSupabase("supervisor", { usuarioId: null });
      await expect(llamar()).resolves.toMatchObject({ ok: false });
      expect(espia.rpcsPedidas).toHaveLength(0);
    },
  );
});

describe("agregarParada", () => {
  it("el supervisor la añade y revalida la sección", async () => {
    conSupabase("supervisor");
    await expect(
      agregarParada({
        mercaderistaId: MERCADERISTA,
        fecha: "2026-08-03",
        tiendaId: TIENDA,
      }),
    ).resolves.toEqual({ ok: true });
    expect(espia.rpcsPedidas[0]?.nombre).toBe("agregar_parada_rutero");
    expect(revalidatePath).toHaveBeenCalledWith("/supervisor/ruteros");
  });

  it("una fecha que no es fecha no llega a la base", async () => {
    conSupabase("supervisor");
    await expect(
      agregarParada({
        mercaderistaId: MERCADERISTA,
        fecha: "el jueves",
        tiendaId: TIENDA,
      }),
    ).resolves.toEqual({ ok: false, error: "Datos inválidos" });
    expect(crearCliente).not.toHaveBeenCalled();
  });

  it("si la base falla, lo dice sin filtrar el mensaje de infraestructura", async () => {
    conSupabase("supervisor", {
      rpc: { error: { message: "connection to server at 10.0.0.1 failed" } },
    });
    const r = await agregarParada({
      mercaderistaId: MERCADERISTA,
      fecha: "2026-08-03",
      tiendaId: TIENDA,
    });
    expect(r).toEqual({ ok: false, error: "No se pudo guardar el cambio" });
    expect(revalidatePath).not.toHaveBeenCalled();
  });
});

describe("quitarParada", () => {
  it("pasa por la RPC, no por un delete suelto", async () => {
    // Hacen falta tres cosas en la MISMA transacción: comprobar el estado con
    // bloqueo, dejar el rastro de quién la quitó y borrar. Con el delete por
    // PostgREST, la auditoría sería una escritura aparte que puede quedarse sin
    // su borrado. (El test de las 0 filas que había aquí desaparece con él: ese
    // camino ya no existe.)
    const espia = conSupabase("supervisor");
    await expect(quitarParada({ paradaId: PARADA })).resolves.toEqual({
      ok: true,
    });
    expect(espia.rpcsPedidas).toContainEqual({
      nombre: "quitar_parada_rutero",
      argumentos: { p_parada: PARADA },
    });
  });

  it.each([
    [
      "23503",
      "Esa tienda ya tiene una visita registrada: no se puede quitar de la ruta.",
    ],
    [
      "55000",
      "Ese día ya no admite cambios de ruta. Recarga la pantalla para ver su estado.",
    ],
    ["P0002", "Esa parada ya no existe. Recarga la pantalla."],
    ["42501", "No encontrado o sin permiso"],
  ])(
    "traduce el %s a algo que el supervisor pueda hacer",
    async (code, mensaje) => {
      // Cada uno es una acción distinta para quien está delante: recargar,
      // elegir otra tienda o rendirse. Un genérico no le dice qué hacer.
      conSupabase("supervisor", {
        rpc: { error: { message: "boom", code } },
      });
      await expect(quitarParada({ paradaId: PARADA })).resolves.toEqual({
        ok: false,
        error: mensaje,
      });
      expect(revalidatePath).not.toHaveBeenCalled();
    },
  );

  it("un código desconocido cae al genérico y deja traza", async () => {
    const warn = vi.spyOn(console, "error").mockImplementation(() => {});
    conSupabase("supervisor", {
      rpc: { error: { message: "algo raro", code: "XX999" } },
    });
    await expect(quitarParada({ paradaId: PARADA })).resolves.toEqual({
      ok: false,
      error: "No se pudo guardar el cambio",
    });
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it("el mensaje CRUDO de la base no llega al navegador", async () => {
    // Los mensajes de un driver concatenan el cuerpo de la respuesta: no son
    // seguros para pintarlos tal cual.
    const warn = vi.spyOn(console, "error").mockImplementation(() => {});
    conSupabase("supervisor", {
      rpc: {
        error: {
          message: "duplicate key value violates unique constraint secreto_idx",
          code: "23503",
        },
      },
    });
    const r = await quitarParada({ paradaId: PARADA });
    expect(r).toMatchObject({ ok: false });
    if (!r.ok) expect(r.error).not.toContain("secreto_idx");
    warn.mockRestore();
  });
});

describe("reordenarParadas", () => {
  it("manda la lista al RPC tal cual llega", async () => {
    conSupabase("supervisor");
    await expect(
      reordenarParadas({ ruteroId: RUTERO, paradas: [OTRA_PARADA, PARADA] }),
    ).resolves.toEqual({ ok: true });
    expect(espia.rpcsPedidas[0]?.argumentos).toMatchObject({
      p_paradas: [OTRA_PARADA, PARADA],
    });
  });

  it("una lista con ids repetidos se corta aquí", async () => {
    // Repetir un id cuela el chequeo de tamaño de Postgres y deja una parada sin
    // renumerar. La base también lo rechaza; esto lo para antes de la red.
    conSupabase("supervisor");
    await expect(
      reordenarParadas({ ruteroId: RUTERO, paradas: [PARADA, PARADA] }),
    ).resolves.toEqual({ ok: false, error: "Datos inválidos" });
    expect(crearCliente).not.toHaveBeenCalled();
  });

  it("una lista vacía no reordena nada", async () => {
    conSupabase("supervisor");
    await expect(
      reordenarParadas({ ruteroId: RUTERO, paradas: [] }),
    ).resolves.toMatchObject({ ok: false });
  });

  it("una lista desmesurada se rechaza en vez de mandarse", async () => {
    conSupabase("supervisor");
    const muchas = Array.from(
      { length: 101 },
      (_, i) => `a0000009-0000-0000-0000-${String(i).padStart(12, "0")}`,
    );
    await expect(
      reordenarParadas({ ruteroId: RUTERO, paradas: muchas }),
    ).resolves.toMatchObject({ ok: false });
    expect(crearCliente).not.toHaveBeenCalled();
  });
});

describe("publicarRutero", () => {
  it("el supervisor publica", async () => {
    conSupabase("supervisor");
    await expect(publicarRutero({ ruteroId: RUTERO })).resolves.toEqual({
      ok: true,
    });
  });

  it("publicar algo que ya no es borrador no afecta filas: se avisa", async () => {
    conSupabase("supervisor", { escritura: { data: [], error: null } });
    await expect(publicarRutero({ ruteroId: RUTERO })).resolves.toEqual({
      ok: false,
      error: "No encontrado o sin permiso",
    });
  });
});

describe("duplicarPeriodo", () => {
  it("el supervisor copia el periodo", async () => {
    conSupabase("supervisor");
    await expect(duplicarPeriodo(DUPLICAR_VALIDO)).resolves.toEqual({
      ok: true,
    });
    expect(espia.rpcsPedidas[0]).toMatchObject({
      nombre: "duplicar_periodo_rutero",
      argumentos: { p_dias_desplazamiento: 7 },
    });
  });

  it("un desplazamiento de cero copiaría sobre sí mismo: se rechaza", async () => {
    conSupabase("supervisor");
    await expect(
      duplicarPeriodo({ ...DUPLICAR_VALIDO, dias: 0 }),
    ).resolves.toEqual({ ok: false, error: "Datos inválidos" });
    expect(crearCliente).not.toHaveBeenCalled();
  });

  it("un desplazamiento fraccionario no es un número de días", async () => {
    conSupabase("supervisor");
    await expect(
      duplicarPeriodo({ ...DUPLICAR_VALIDO, dias: 1.5 }),
    ).resolves.toMatchObject({ ok: false });
  });
});

describe("fijarHoraParada", () => {
  // Es la vara con la que se mide la puntualidad del mercaderista, y de ahí sale
  // un bono: quién puede moverla y con qué valores no es un detalle de UI.

  it("una hora válida llega a la base", async () => {
    conSupabase("supervisor");
    await expect(
      fijarHoraParada({ paradaId: PARADA, hora: "08:30" }),
    ).resolves.toEqual({ ok: true });
    expect(espia.rpcsPedidas[0]?.nombre).toBe("fijar_hora_parada");
    expect(espia.rpcsPedidas[0]?.argumentos).toEqual({
      p_parada: PARADA,
      p_hora: "08:30",
    });
    expect(revalidatePath).toHaveBeenCalledWith("/supervisor/ruteros");
  });

  it("la cadena vacía la QUITA omitiendo el parámetro", async () => {
    // El default de la función es NULL: omitirlo es quitarla. Si se mandara
    // `p_hora: undefined`, supabase-js lo serializaría fuera igual, pero el test
    // fija la forma para que un refactor no lo convierta en `"":: time` y falle.
    conSupabase("supervisor");
    await expect(
      fijarHoraParada({ paradaId: PARADA, hora: "" }),
    ).resolves.toEqual({ ok: true });
    expect(espia.rpcsPedidas[0]?.argumentos).toEqual({ p_parada: PARADA });
  });

  it.each(["8:30", "24:00", "08:70", "08:30:00", "ocho y media", "0830"])(
    "%s no llega a la base",
    async (hora) => {
      conSupabase("supervisor");
      await expect(
        fijarHoraParada({ paradaId: PARADA, hora }),
      ).resolves.toEqual({ ok: false, error: "Hora inválida" });
      expect(espia.rpcsPedidas).toHaveLength(0);
    },
  );

  it("un id de parada que no es un uuid tampoco", async () => {
    conSupabase("supervisor");
    await expect(
      fijarHoraParada({ paradaId: "la primera", hora: "08:30" }),
    ).resolves.toEqual({ ok: false, error: "Hora inválida" });
    expect(espia.rpcsPedidas).toHaveLength(0);
  });

  it("un fallo de la base se cuenta, no se traga", async () => {
    conSupabase("supervisor", {
      rpc: { error: { message: "ya salió del borrador" } },
    });
    await expect(
      fijarHoraParada({ paradaId: PARADA, hora: "08:30" }),
    ).resolves.toMatchObject({ ok: false });
    expect(revalidatePath).not.toHaveBeenCalled();
  });
});
