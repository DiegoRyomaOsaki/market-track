import { useQuery } from "@powersync/react-native";
import {
  etiquetaDePeriodo,
  formatearDeltaPosicion,
  descripcionDeltaPosicion,
  inicioDePeriodo,
  textoDePosicion,
  type PeriodoPuntaje,
} from "@market-track/shared";

// "Mi desempeño": el puntaje del plan de lealtad tal como lo ve su dueño.
//
// Todo sale de la réplica local, nunca de la red — un mercaderista consulta su
// puntaje en el mismo sótano sin señal donde levanta el pedido. Y la réplica solo
// trae SU fila (packages/sync la acota por `auth.user_id()`), así que las
// consultas de aquí no filtran por usuario: no tendrían con qué.
//
// NADA se recalcula en el teléfono. La posición, el denominador y el empate
// vienen ya resueltos del servidor, que es quien ve a todo el cliente. Aquí solo
// se ordena, se compara contra el periodo anterior y se le pone nombre — con las
// MISMAS funciones que usa el panel (`@market-track/shared`), porque dos copias
// dirían "Julio" y "Junio" del mismo periodo.

export type FilaPuntaje = {
  tipo: string;
  periodo_inicio: string;
  total_pct: number | null;
  puntualidad_pct: number | null;
  asistencia_pct: number | null;
  calidad_pct: number | null;
  herramientas_pct: number | null;
  posicion: number | null;
  mercaderistas_evaluados: number | null;
  /** 0/1: PowerSync no tiene booleano. */
  hay_empate: number | null;
  paradas_evaluables: number | null;
  paradas_asistidas: number | null;
  paradas_con_hora: number | null;
  paradas_puntuales: number | null;
  campos_obligatorios: number | null;
  campos_respondidos: number | null;
  fotos_esperadas: number | null;
  fotos_presentes: number | null;
  items_checklist: number | null;
  items_cumplidos: number | null;
  calculado_at: string;
  cerrado_at: string | null;
};

export type FilaConfig = {
  periodicidad: string;
  vigente_desde: string;
};

const PERIODICIDAD_POR_DEFECTO: PeriodoPuntaje = "mensual";

const PERIODOS: readonly PeriodoPuntaje[] = ["mensual", "trimestral", "anual"];

function esPeriodo(v: string): v is PeriodoPuntaje {
  return (PERIODOS as readonly string[]).includes(v);
}

/**
 * Qué periodicidad rige hoy: la de la configuración vigente más reciente que no
 * supere el día dado.
 *
 * Hace falta porque el 1 de enero es inicio de las TRES periodicidades: sin
 * saber cuál rige, el teléfono elegiría una por su cuenta y enseñaría un periodo
 * distinto del que enseña el panel. Sin configuración se cae a «mensual», que es
 * lo mismo que hace el default de la columna en la base.
 */
export function resolverPeriodicidad(
  configs: readonly FilaConfig[],
  diaLima: string,
): PeriodoPuntaje {
  const vigente = configs
    .filter((c) => c.vigente_desde <= diaLima)
    .sort((a, b) => a.vigente_desde.localeCompare(b.vigente_desde))
    .at(-1);
  if (vigente === undefined || !esPeriodo(vigente.periodicidad)) {
    return PERIODICIDAD_POR_DEFECTO;
  }
  return vigente.periodicidad;
}

/** La fila del periodo más reciente de esa periodicidad, o null si no hay. */
export function periodoVigente(
  filas: readonly FilaPuntaje[],
  tipo: PeriodoPuntaje,
): FilaPuntaje | null {
  return (
    filas
      .filter((f) => f.tipo === tipo)
      .sort((a, b) => a.periodo_inicio.localeCompare(b.periodo_inicio))
      .at(-1) ?? null
  );
}

export type PuntoEvolucion = {
  periodo_inicio: string;
  etiqueta: string;
  total_pct: number | null;
  posicion: number | null;
  /** «▲ 2» / «▼ 1» / «=» / «—», ya listo para pintar. */
  delta: string;
  /** El mismo delta EN PALABRAS: el triángulo solo es forma (WCAG 1.4.1). */
  deltaDescripcion: string;
};

/**
 * La serie de periodos, del más reciente al más antiguo, cada uno comparado con
 * el que le precede EN LA SERIE.
 *
 * Se compara con el anterior replicado y no con el periodo calendario anterior a
 * propósito: si un mes no tiene fila (nadie lo calculó, o el mercaderista no
 * trabajó), inventar un hueco no aporta nada — la comparación honesta es contra
 * la última vez que sí hubo puntaje.
 */
export function serieDeEvolucion(
  filas: readonly FilaPuntaje[],
  tipo: PeriodoPuntaje,
): PuntoEvolucion[] {
  const orden = filas
    .filter((f) => f.tipo === tipo)
    .sort((a, b) => a.periodo_inicio.localeCompare(b.periodo_inicio));

  return orden
    .map((f, i) => {
      const previo = i === 0 ? null : orden[i - 1]!;
      return {
        periodo_inicio: f.periodo_inicio,
        etiqueta: etiquetaDePeriodo(tipo, f.periodo_inicio),
        total_pct: f.total_pct,
        posicion: f.posicion,
        delta: formatearDeltaPosicion(f.posicion, previo?.posicion ?? null),
        deltaDescripcion: descripcionDeltaPosicion(
          f.posicion,
          previo?.posicion ?? null,
        ),
      };
    })
    .reverse();
}

/**
 * «3.º de 12», «2.º de 12 (empate)», «Sin comparación» o «Sin datos».
 *
 * «Sin comparación» cuando el cliente tiene un solo evaluado: un «1.º de 1» es
 * ruido con forma de logro. Y un total sin evaluar es «Sin datos», nunca el
 * último puesto.
 */
export function textoDeMiPosicion(
  posicion: number | null,
  evaluados: number | null,
  hayEmpate: boolean,
): string {
  if (posicion === null) return "Sin datos";
  if (evaluados === null || evaluados < 2) return "Sin comparación";
  return `${textoDePosicion(posicion, hayEmpate)} de ${evaluados}`;
}

/**
 * Un porcentaje para la pantalla. NUNCA devuelve «0» para un nulo: un no
 * evaluado pintado como cero le dice al mercaderista que lo hizo fatal.
 */
export function formatearPct(valor: number | null): string {
  if (valor === null) return "Sin datos";
  return valor.toFixed(1).replace(".", ",");
}

export type Variable = {
  clave: "puntualidad" | "asistencia" | "calidad" | "herramientas";
  etiqueta: string;
  pct: number | null;
  /** El detalle que EXPLICA el número: «18 de 20 paradas». */
  detalle: string;
};

/** Record y no switch: si el motor gana una variable, esto no compila. */
const ETIQUETA_VARIABLE: Record<Variable["clave"], string> = {
  puntualidad: "Puntualidad",
  asistencia: "Asistencia",
  calidad: "Calidad del registro",
  herramientas: "Herramientas",
};

function deN(hechos: number | null, total: number | null, unidad: string) {
  if (total === null || total === 0) return "sin nada que evaluar";
  return `${hechos ?? 0} de ${total} ${unidad}`;
}

/**
 * El desglose por variable, con su cobertura al lado. Sin el detalle, un 100
 * sobre dos paradas se lee igual que un 100 sobre cuarenta, y no valen lo mismo.
 *
 * `tiempo_efectivo` no aparece: su peso está fijado a 0 en la base y su valor es
 * siempre NULL. Enseñar una variable que nunca puntúa solo genera preguntas.
 */
export function desglosePorVariable(fila: FilaPuntaje): Variable[] {
  return [
    {
      clave: "puntualidad",
      etiqueta: ETIQUETA_VARIABLE.puntualidad,
      pct: fila.puntualidad_pct,
      detalle: deN(fila.paradas_puntuales, fila.paradas_con_hora, "a tiempo"),
    },
    {
      clave: "asistencia",
      etiqueta: ETIQUETA_VARIABLE.asistencia,
      pct: fila.asistencia_pct,
      detalle: deN(
        fila.paradas_asistidas,
        fila.paradas_evaluables,
        "visitadas",
      ),
    },
    {
      clave: "calidad",
      etiqueta: ETIQUETA_VARIABLE.calidad,
      pct: fila.calidad_pct,
      detalle: deN(
        (fila.campos_respondidos ?? 0) + (fila.fotos_presentes ?? 0),
        (fila.campos_obligatorios ?? 0) + (fila.fotos_esperadas ?? 0),
        "datos y fotos",
      ),
    },
    {
      clave: "herramientas",
      etiqueta: ETIQUETA_VARIABLE.herramientas,
      pct: fila.herramientas_pct,
      detalle: deN(fila.items_cumplidos, fila.items_checklist, "en el maletín"),
    },
  ];
}

/**
 * De cuándo es lo que se está mirando.
 *
 * Se dicen los DOS instantes porque responden a preguntas distintas:
 * `calculado_at` es cuándo el servidor calculó el puntaje, y `ultimaSync` es
 * cuándo este teléfono habló con él. Un puntaje calculado el 1 de agosto en un
 * teléfono sin señal desde el 10 es exacto y aun así puede estar viejo: enseñar
 * solo el primero escondería que puede existir un número más nuevo.
 *
 * `ultimaSync` nula no significa "réplica vacía": el SDK reinicia ese sello al
 * arrancar, así que un arranque en frío sin señal la deja nula con los datos
 * intactos. Por eso tiene su propio texto.
 */
export function textoFrescura(
  calculadoAt: string,
  ultimaSync: Date | null,
  conectado: boolean,
): string {
  const calculado = `Calculado el ${fechaCorta(calculadoAt)}`;
  if (conectado) return calculado;
  if (ultimaSync === null) {
    return `Sin conexión · sin sincronizar en esta sesión · ${calculado}`;
  }
  return `Sin conexión · última sincronización ${fechaCorta(ultimaSync.toISOString())} · ${calculado}`;
}

const MESES_CORTOS = [
  "ene",
  "feb",
  "mar",
  "abr",
  "may",
  "jun",
  "jul",
  "ago",
  "set",
  "oct",
  "nov",
  "dic",
] as const;

/**
 * «12 ago, 14:32» en la zona de Lima. El instante es global pero la jornada es
 * local: el día del negocio es el de Lima, no el del reloj del dispositivo ni el
 * de UTC.
 */
export function fechaCorta(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  const partes = new Intl.DateTimeFormat("es-PE", {
    timeZone: "America/Lima",
    day: "numeric",
    month: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(d);
  const de = (t: string) => partes.find((p) => p.type === t)?.value ?? "";
  const mes = MESES_CORTOS[Number(de("month")) - 1] ?? "";
  return `${Number(de("day"))} ${mes}, ${de("hour")}:${de("minute")}`;
}

// ---------------------------------------------------------------------------
// Los hooks: SQL contra la réplica local. La lógica de arriba es pura para que
// se pueda probar sin el motor nativo; estos solo traen filas.
// ---------------------------------------------------------------------------

const SQL_PUNTAJES = `
  SELECT tipo, periodo_inicio, total_pct, puntualidad_pct, asistencia_pct,
         calidad_pct, herramientas_pct, posicion, mercaderistas_evaluados,
         hay_empate, paradas_evaluables, paradas_asistidas, paradas_con_hora,
         paradas_puntuales, campos_obligatorios, campos_respondidos,
         fotos_esperadas, fotos_presentes, items_checklist, items_cumplidos,
         calculado_at, cerrado_at
  FROM puntaje_merchandiser
  ORDER BY periodo_inicio DESC
`;

const SQL_CONFIG = `
  SELECT periodicidad, vigente_desde FROM config_perfect_merchandiser
`;

export function useMiDesempeno(diaLima: string) {
  const puntajes = useQuery<FilaPuntaje>(SQL_PUNTAJES);
  const configs = useQuery<FilaConfig>(SQL_CONFIG);

  const tipo = resolverPeriodicidad(configs.data ?? [], diaLima);
  const filas = puntajes.data ?? [];

  return {
    tipo,
    /** El periodo que rige AHORA, aunque su fila aún no exista. */
    periodoActual: inicioDePeriodo(tipo, diaLima),
    actual: periodoVigente(filas, tipo),
    evolucion: serieDeEvolucion(filas, tipo),
    cargando: puntajes.isLoading || configs.isLoading,
    // El error NO se traga: una réplica desfasada tras una actualización OTA
    // deja la consulta rota, y una pantalla en blanco parece "aún no tienes
    // puntaje", que es justo la lectura equivocada.
    error: puntajes.error ?? configs.error,
  };
}
