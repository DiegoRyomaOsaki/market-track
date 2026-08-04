import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  agregarParada,
  duplicarPeriodo,
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
  it("el supervisor la quita", async () => {
    conSupabase("supervisor");
    await expect(quitarParada({ paradaId: PARADA })).resolves.toEqual({
      ok: true,
    });
  });

  it("0 filas afectadas es 'sin permiso', no éxito", async () => {
    // Un DELETE que la RLS bloquea NO da error: borra 0 filas y devuelve éxito.
    conSupabase("supervisor", { escritura: { data: [], error: null } });
    await expect(quitarParada({ paradaId: PARADA })).resolves.toEqual({
      ok: false,
      error: "No encontrado o sin permiso",
    });
    expect(revalidatePath).not.toHaveBeenCalled();
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
