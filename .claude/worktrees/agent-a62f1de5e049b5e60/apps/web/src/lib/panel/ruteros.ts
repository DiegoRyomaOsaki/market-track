import type { Database } from "@market-track/db";

import { diasDelRango, diasEntre, sumarDias } from "@/lib/fecha-lima";

// La lógica PURA del diseño de ruteros: qué días abarca el periodo que se está
// viendo, y cómo se agrupan por día las filas que devuelve `planeacion_ruteros`.
//
// No hay entidad "semana" ni "mes": `rutero` es por día y las dos vistas son dos
// ventanas sobre las mismas filas. Todo lo de aquí es aritmética de calendario.

type FilaCruda =
  Database["public"]["Functions"]["planeacion_ruteros"]["Returns"][number];

// El generador tipa las columnas de un `returns table` como no-nulas, pero el
// `left join` de la función deja en null todo lo de la parada cuando un día
// tiene rutero y ninguna tienda asignada todavía.
export type FilaPlaneacion = Omit<
  FilaCruda,
  | "parada_id"
  | "orden"
  | "tienda_id"
  | "tienda_nombre"
  | "parada_estado"
  | "hora_planificada"
> & {
  parada_id: string | null;
  orden: number | null;
  tienda_id: string | null;
  tienda_nombre: string | null;
  parada_estado: Database["public"]["Enums"]["estado_parada"] | null;
  // Nula también cuando la parada SÍ existe: fijar la hora es opcional.
  hora_planificada: string | null;
};

export type Vista = "semana" | "mes";

export type Parada = {
  id: string;
  orden: number;
  tiendaId: string;
  tiendaNombre: string;
  /** `HH:MM` de Lima, o null si no se fijó ninguna. */
  hora: string | null;
};

export type DiaPlaneado = {
  fecha: string;
  ruteroId: string | null;
  estado: Database["public"]["Enums"]["estado_rutero"] | null;
  paradas: Parada[];
};

/**
 * `HH:MM` a partir del `HH:MM:SS` que devuelve Postgres para un `time`.
 *
 * `input[type=time]` no acepta los segundos salvo que se le fije el `step`, y con
 * ellos deja el campo vacío en silencio: el supervisor abriría el día y vería la
 * hora en blanco creyendo que no se guardó.
 */
export function horaCorta(hora: string | null): string | null {
  return hora ? hora.slice(0, 5) : null;
}

/** El lunes de la semana de `dia`. La semana laboral peruana empieza en lunes. */
export function inicioDeSemana(dia: string): string {
  // `getUTCDay` sobre el mediodía UTC del día: domingo es 0, así que se le trata
  // como el séptimo y no como el primero.
  const diaSemana = new Date(`${dia}T12:00:00Z`).getUTCDay();
  const desdeElLunes = diaSemana === 0 ? 6 : diaSemana - 1;
  return sumarDias(dia, -desdeElLunes);
}

/** El primer día del mes de `dia`. */
export function inicioDeMes(dia: string): string {
  return `${dia.slice(0, 7)}-01`;
}

/** El último día del mes de `dia`, sin tablas de días por mes. */
export function finDeMes(dia: string): string {
  const [anio, mes] = dia.split("-").map(Number);
  // El día 0 del mes siguiente ES el último del actual, y `Date` resuelve solo
  // los años bisiestos y el salto de diciembre a enero.
  const ultimo = new Date(Date.UTC(anio ?? 0, mes ?? 1, 0));
  return ultimo.toISOString().slice(0, 10);
}

/** El rango que abarca la vista, a partir de cualquier día que caiga dentro. */
export function rangoDeVista(
  vista: Vista,
  dia: string,
): { desde: string; hasta: string } {
  if (vista === "mes") {
    return { desde: inicioDeMes(dia), hasta: finDeMes(dia) };
  }
  const desde = inicioDeSemana(dia);
  return { desde, hasta: sumarDias(desde, 6) };
}

/** El periodo anterior o el siguiente, para navegar. */
export function periodoVecino(
  vista: Vista,
  dia: string,
  direccion: -1 | 1,
): string {
  if (vista === "semana") return sumarDias(dia, 7 * direccion);
  const [anio, mes] = dia.split("-").map(Number);
  // Día 1 a propósito: saltar de mes desde un día 31 se comería un mes entero.
  return new Date(Date.UTC(anio ?? 0, (mes ?? 1) - 1 + direccion, 1))
    .toISOString()
    .slice(0, 10);
}

/**
 * Cuántos días desplazar para duplicar el periodo sobre el siguiente. En la
 * semana son 7 fijos; en el mes depende de cuántos días tenga, porque copiar con
 * 30 fijos descuadraría febrero y los meses de 31.
 */
export function desplazamientoDeDuplicado(vista: Vista, dia: string): number {
  const { desde, hasta } = rangoDeVista(vista, dia);
  return diasEntre(desde, hasta) + 1;
}

/**
 * Agrupa las filas por día, rellenando los días del rango que no tienen rutero.
 * Esos huecos son la mitad de la información en una pantalla de planeación: sin
 * ellos no se ve dónde falta trabajo.
 */
export function agruparPorDia(
  filas: readonly FilaPlaneacion[],
  desde: string,
  hasta: string,
): DiaPlaneado[] {
  const porFecha = new Map<string, DiaPlaneado>();

  for (const f of filas) {
    const dia = porFecha.get(f.fecha) ?? {
      fecha: f.fecha,
      ruteroId: f.rutero_id,
      estado: f.estado,
      paradas: [],
    };
    // Un día con rutero pero sin paradas llega como una fila con todo en null.
    if (f.parada_id !== null && f.orden !== null && f.tienda_id !== null) {
      dia.paradas.push({
        id: f.parada_id,
        orden: f.orden,
        tiendaId: f.tienda_id,
        tiendaNombre: f.tienda_nombre ?? "—",
        hora: horaCorta(f.hora_planificada),
      });
    }
    porFecha.set(f.fecha, dia);
  }

  return diasDelRango(desde, hasta).map(
    (fecha) =>
      porFecha.get(fecha) ?? {
        fecha,
        ruteroId: null,
        estado: null,
        paradas: [],
      },
  );
}

/** El id de las paradas en el orden resultante de mover una un puesto. */
export function moverParada(
  paradas: readonly Parada[],
  id: string,
  direccion: -1 | 1,
): string[] {
  const ids = paradas.map((p) => p.id);
  const i = ids.indexOf(id);
  const destino = i + direccion;
  // En los extremos no se mueve: el botón ya va deshabilitado, pero llamar a
  // esto igual no debe reordenar nada por su cuenta.
  if (i === -1 || destino < 0 || destino >= ids.length) return ids;
  const copia = [...ids];
  [copia[i], copia[destino]] = [copia[destino] as string, copia[i] as string];
  return copia;
}

/** ¿Este rutero ya se puede publicar? Publicar un día vacío no significa nada. */
export function sePuedePublicar(dia: DiaPlaneado): boolean {
  return (
    dia.ruteroId !== null && dia.paradas.length > 0 && dia.estado === "borrador"
  );
}
