import { beforeEach, describe, expect, it, jest } from "@jest/globals";

// Los módulos que tocan almacenamiento nativo se moquean: aquí se prueba la
// DECISIÓN de salir, no los diálogos del sistema. `react-native` NO se moquea —
// el preset `jest-expo` ya lo provee, y sustituirlo entero rompe
// `expo-modules-core` al importar.

// El prefijo `mock` no es estilo: Jest iza los `jest.mock()` por encima de las
// declaraciones, y solo permite que su factory toque variables con ese prefijo.
const mockOlvidar = jest.fn<() => Promise<void>>();
const mockContarRegistros = jest.fn<() => Promise<number>>();
const mockContarFotos = jest.fn<() => Promise<number>>();
const mockSignOut = jest.fn<() => Promise<{ error: unknown }>>();
const mockGetSession = jest.fn<() => Promise<{ data: { session: unknown } }>>();

// Los factories DELEGAN en vez de devolver el doble directamente. No es
// ceremonia: el factory se evalúa al importar el módulo bajo prueba, y para
// entonces estas `const` siguen en su zona muerta temporal — devolverlas ahí
// daría `undefined`. Envueltas en una función, se leen al llamarlas. Es el mismo
// patrón que ya usa `cola-fotos-instancia.test.ts`.
jest.mock("./recordar-dispositivo", () => ({
  olvidarDispositivo: () => mockOlvidar(),
}));
jest.mock("./powersync/estado", () => ({
  contarPendientes: () => mockContarRegistros(),
}));
jest.mock("./cola-fotos-instancia", () => ({
  colaFotos: { contarPendientes: () => mockContarFotos() },
}));
jest.mock("./supabase", () => ({
  supabase: {
    auth: { signOut: () => mockSignOut(), getSession: () => mockGetSession() },
  },
}));

import {
  cerrarSesion,
  type DialogosDeSalida,
  frasePendientes,
  mensajeDeSalida,
} from "./cierre-sesion";

/** Un doble de los diálogos que responde lo que se le diga. */
function dialogos(respuesta: boolean): DialogosDeSalida & {
  vistos: { titulo: string; cuerpo: string }[];
  avisos: { titulo: string; cuerpo: string }[];
} {
  const vistos: { titulo: string; cuerpo: string }[] = [];
  const avisos: { titulo: string; cuerpo: string }[] = [];
  return {
    vistos,
    avisos,
    confirmar: (m) => {
      vistos.push(m);
      return Promise.resolve(respuesta);
    },
    avisar: (m) => void avisos.push(m),
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockOlvidar.mockResolvedValue(undefined);
  mockContarRegistros.mockResolvedValue(0);
  mockContarFotos.mockResolvedValue(0);
  mockSignOut.mockResolvedValue({ error: null });
  mockGetSession.mockResolvedValue({ data: { session: null } });
  jest.spyOn(console, "warn").mockImplementation(() => {});
  jest.spyOn(console, "error").mockImplementation(() => {});
});

describe("frasePendientes", () => {
  it("usa el singular con uno de cada", () => {
    expect(frasePendientes(1, 1)).toBe("1 registro y 1 foto");
  });

  it("usa el plural con varios", () => {
    expect(frasePendientes(3, 5)).toBe("3 registros y 5 fotos");
  });

  it("omite la cola que está vacía", () => {
    expect(frasePendientes(0, 2)).toBe("2 fotos");
    expect(frasePendientes(4, 0)).toBe("4 registros");
  });

  it("sin nada pendiente no dice nada", () => {
    expect(frasePendientes(0, 0)).toBe("");
  });
});

describe("mensajeDeSalida", () => {
  it("dice los DOS números, que es lo que hace que alguien cancele", () => {
    // Un "¿seguro?" genérico no frena a nadie; "3 registros y 5 fotos", sí.
    const m = mensajeDeSalida({ registros: 3, fotos: 5 }, true);
    expect(m.cuerpo).toContain("3 registros y 5 fotos");
  });

  it("advierte de que otro mercaderista en este teléfono borra el trabajo", () => {
    // Criterio de contrato: es la consecuencia que el usuario no puede adivinar.
    const m = mensajeDeSalida({ registros: 1, fotos: 0 }, true);
    expect(m.cuerpo).toContain("otro mercaderista entra en este teléfono");
    expect(m.cuerpo).toContain("no se recupera");
  });

  it("con la cola vacía sigue avisando del coste de volver a entrar", () => {
    // Contradice a propósito la letra del criterio original: volver a entrar
    // exige contraseña y segundo factor CON RED, haya cola o no.
    const m = mensajeDeSalida({ registros: 0, fotos: 0 }, true);
    expect(m.cuerpo).toContain("No te queda trabajo sin enviar");
    expect(m.cuerpo).toContain("contraseña");
  });

  it("sin señal lo dice, porque ahí el encierro es real", () => {
    const m = mensajeDeSalida({ registros: 0, fotos: 0 }, false);
    expect(m.cuerpo).toContain("no hay señal");
  });

  it("si no se pudo contar, NUNCA dice que no hay nada", () => {
    // Decir "0" sería afirmar lo que no se comprobó, y es la diferencia entre
    // salir tranquilo y perder la tarde.
    const m = mensajeDeSalida({ registros: null, fotos: 3 }, true);
    expect(m.cuerpo).toContain("No pudimos comprobar");
    expect(m.cuerpo).not.toContain("No te queda trabajo");
  });
});

describe("cerrarSesion", () => {
  it("cancelar NO deja efectos: ni olvida el dispositivo ni cierra sesión", async () => {
    // El criterio del ticket. Hoy `olvidarDispositivo()` corría antes que nada,
    // así que añadir la confirmación encima sin tocar el orden lo habría dejado
    // corriendo igual al cancelar.
    mockContarRegistros.mockResolvedValue(3);
    mockContarFotos.mockResolvedValue(5);

    expect(await cerrarSesion(dialogos(false))).toBe("cancelada");

    expect(mockOlvidar).not.toHaveBeenCalled();
    expect(mockSignOut).not.toHaveBeenCalled();
  });

  it("confirmar olvida el dispositivo ANTES de cerrar la sesión", async () => {
    // El orden es el contrato: al revés, un `signOut` a medias dejaría al
    // siguiente arranque con sesión y ventana viva, entrando como si nada.
    const orden: string[] = [];
    mockOlvidar.mockImplementation(() => {
      orden.push("olvidar");
      return Promise.resolve();
    });
    mockSignOut.mockImplementation(() => {
      orden.push("signOut");
      return Promise.resolve({ error: null });
    });

    expect(await cerrarSesion(dialogos(true))).toBe("cerrada");
    expect(orden).toEqual(["olvidar", "signOut"]);
  });

  it("con la cola llena la salida NO se bloquea", async () => {
    // La regla de negocio: advertir, nunca bloquear. Una foto atascada en
    // `requiere_atencion` no puede dejar a nadie sin poder cerrar sesión.
    mockContarRegistros.mockResolvedValue(99);
    mockContarFotos.mockResolvedValue(99);
    expect(await cerrarSesion(dialogos(true))).toBe("cerrada");
    expect(mockSignOut).toHaveBeenCalled();
  });

  it("si no se puede contar, se pregunta igual y se puede salir", async () => {
    mockContarRegistros.mockRejectedValue(new Error("db cerrada"));
    const io = dialogos(true);

    expect(await cerrarSesion(io)).toBe("cerrada");
    expect(io.vistos[0]?.cuerpo).toContain("No pudimos comprobar");
  });

  it("un fallo al olvidar el dispositivo no impide salir", async () => {
    // Se pierde el guardarraíl del arranque, no el cierre. La salida manda.
    mockOlvidar.mockRejectedValue(new Error("SecureStore"));
    expect(await cerrarSesion(dialogos(true))).toBe("cerrada");
    expect(mockSignOut).toHaveBeenCalled();
  });

  it("si signOut falla pero la sesión local ya no está, se salió", async () => {
    // auth-js borra la sesión local aunque la llamada de red falle: tratar el
    // error como "sigues dentro" le mentiría al usuario.
    mockSignOut.mockResolvedValue({ error: { message: "red" } });
    mockGetSession.mockResolvedValue({ data: { session: null } });
    expect(await cerrarSesion(dialogos(true))).toBe("cerrada");
  });

  it("si la sesión sobrevive, lo dice en vez de fingir que salió", async () => {
    mockSignOut.mockResolvedValue({ error: { message: "red" } });
    mockGetSession.mockResolvedValue({ data: { session: { user: {} } } });
    const io = dialogos(true);

    expect(await cerrarSesion(io)).toBe("reinicio_pendiente");
    expect(io.avisos[0]?.cuerpo).toContain("vuelve a abrirla");
    // Y se le dice que su trabajo sigue ahí: es lo que más le preocupa.
    expect(io.avisos[0]?.cuerpo).toContain("sigue guardado");
  });

  it("dos toques seguidos abren UN solo diálogo", async () => {
    const io = dialogos(true);
    await Promise.all([cerrarSesion(io), cerrarSesion(io)]);
    expect(io.vistos).toHaveLength(1);
  });

  it("tras cancelar, el botón vuelve a funcionar", async () => {
    // Si el guardarraíl no se liberara, "Salir" quedaría muerto para siempre.
    const io = dialogos(false);
    await cerrarSesion(io);
    await cerrarSesion(io);
    expect(io.vistos).toHaveLength(2);
  });
});
