// Un doble del cliente de Supabase para los tests de las server actions del panel.
//
// Existe por un fallo concreto: las tres primeras pantallas resolvían el rol con
// `select('rol').maybeSingle()` SIN filtrar por el id del usuario, y sus tests lo
// daban por bueno porque el mock devolvía una fila viniera la consulta como
// viniese. En producción `profile` le deja al staff leer la tabla entera, así que
// esa consulta traía varias filas y `maybeSingle()` la rechazaba.
//
// Por eso este doble guarda FILAS y aplica los `.eq(...)`: una consulta sin filtro
// devuelve todas, y entonces `maybeSingle()` falla igual que la de verdad. Un mock
// que ignore los filtros vuelve a dar el mismo falso verde.

type Fila = Record<string, unknown>;

export type RespuestaLista = {
  data: Fila[] | null;
  error: { message: string } | null;
};

/** El mismo error de PostgREST cuando se pide una fila y llegan varias. */
const MULTIPLES_FILAS = {
  message: "JSON object requested, multiple (or no) rows returned",
};

function consultaSobre(filas: Fila[]) {
  const filtros: [string, unknown][] = [];
  const encajan = () =>
    filas.filter((f) => filtros.every(([col, val]) => f[col] === val));

  const encadenable = {
    select: () => encadenable,
    eq: (columna: string, valor: unknown) => {
      filtros.push([columna, valor]);
      return encadenable;
    },
    order: () => encadenable,
    maybeSingle: () => {
      const encontradas = encajan();
      if (encontradas.length > 1) {
        return Promise.resolve({ data: null, error: MULTIPLES_FILAS });
      }
      return Promise.resolve({ data: encontradas[0] ?? null, error: null });
    },
    // Una lectura de LISTA se resuelve con `await` directo, sin `maybeSingle`.
    // También aplica los filtros: un doble que devolviera siempre las mismas
    // filas pasaría igual con la consulta acotada o sin acotar.
    then: (resolver: (r: { data: Fila[]; error: null }) => unknown) =>
      Promise.resolve({ data: encajan(), error: null }).then(resolver),
  };
  return encadenable;
}

function escrituraSobre(
  resultado: RespuestaLista,
  filtros: [string, unknown][],
) {
  const encadenable = {
    update: () => encadenable,
    delete: () => encadenable,
    // Los filtros se APUNTAN, igual que en la lectura. Un doble que ignora el
    // `.eq(...)` deja pasar una escritura que apunta a la fila equivocada: el
    // test sigue verde porque el doble devuelve lo mismo venga como venga la
    // consulta. Es el mismo falso verde que motivó este archivo, en el otro
    // sentido.
    eq: (columna: string, valor: unknown) => {
      filtros.push([columna, valor]);
      return encadenable;
    },
    select: () => Promise.resolve(resultado),
  };
  return encadenable;
}

export type OpcionesFalso = {
  /** El id del usuario con sesión. `null` = sin sesión. */
  usuarioId?: string | null;
  /** Lo que hay en `profile`. Se consulta de verdad, con sus filtros. */
  perfiles?: Fila[];
  /** Lo que devuelve cualquier escritura sobre otra tabla. */
  escritura?: RespuestaLista;
  /** Lo que devuelve cada `rpc(...)`. */
  rpc?: { data?: unknown; error: { message: string } | null };
};

/**
 * Un cliente falso con `auth.getUser()`, un `profile` consultable y una tabla de
 * escritura. Devuelve también los espías para afirmar sobre lo que se llamó.
 */
export function supabaseFalso({
  usuarioId = "u1",
  perfiles = [],
  escritura = { data: [{ id: "x" }], error: null },
  rpc = { error: null },
}: OpcionesFalso = {}) {
  const tablasPedidas: string[] = [];
  const rpcsPedidas: { nombre: string; argumentos: unknown }[] = [];
  /** Los `.eq(...)` de la última escritura, para afirmar A QUÉ FILA apuntó. */
  const filtrosDeEscritura: [string, unknown][] = [];

  const cliente = {
    auth: {
      getUser: () =>
        Promise.resolve({
          data: { user: usuarioId === null ? null : { id: usuarioId } },
          error: null,
        }),
    },
    from: (tabla: string) => {
      tablasPedidas.push(tabla);
      return tabla === "profile"
        ? consultaSobre(perfiles)
        : escrituraSobre(escritura, filtrosDeEscritura);
    },
    rpc: (nombre: string, argumentos: unknown) => {
      rpcsPedidas.push({ nombre, argumentos });
      return Promise.resolve({ data: rpc.data ?? null, error: rpc.error });
    },
  };

  return { cliente, tablasPedidas, rpcsPedidas, filtrosDeEscritura };
}

/** Los perfiles del seed: varios, que es justo lo que rompía el gate sin filtro. */
export function perfilesConStaff(rolDelQueLlama: string | null): Fila[] {
  const otros = [
    { id: "otro-1", rol: "mercaderista", nombre: "José Quispe" },
    { id: "otro-2", rol: "cliente", nombre: "Luis Paredes" },
  ];
  if (rolDelQueLlama === null) return otros;
  return [{ id: "u1", rol: rolDelQueLlama, nombre: "Carla" }, ...otros];
}
