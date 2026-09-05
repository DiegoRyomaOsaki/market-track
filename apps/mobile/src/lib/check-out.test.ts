import { describe, expect, it, jest } from "@jest/globals";

// La verja consulta el predicado de `incidencias.ts`, que vive junto a los hooks
// que leen la réplica. Se moquean sus dependencias nativas para que Jest pueda
// cargar el módulo; ninguna participa aquí — la regla es pura.
jest.mock("@powersync/react-native", () => ({ useQuery: jest.fn() }));
jest.mock("./powersync/db", () => ({ db: {} }));
jest.mock("./cola-fotos-instancia", () => ({ encolarFoto: jest.fn() }));

import {
  incidenciasQueFrenan,
  type LecturaIncidencias,
  puedeCerrarVisita,
  visitaListaParaCheckOut,
} from "./check-out";
import type { IncidenciaLocal } from "./incidencias";
import { minutosDeTraslado } from "./transito";

describe("visitaListaParaCheckOut", () => {
  it("está lista si toda marca quedó completada u omitida", () => {
    expect(visitaListaParaCheckOut(["completado", "omitido"])).toBe(true);
  });

  it("no está lista si una marca sigue en curso", () => {
    expect(visitaListaParaCheckOut(["completado", "en_curso"])).toBe(false);
  });

  it("no está lista si una marca sigue pendiente (null)", () => {
    expect(visitaListaParaCheckOut(["completado", null])).toBe(false);
  });

  it("no está lista sin marcas", () => {
    expect(visitaListaParaCheckOut([])).toBe(false);
  });
});

describe("minutosDeTraslado", () => {
  it("redondea los minutos entre dos instantes", () => {
    expect(
      minutosDeTraslado("2026-07-27T10:00:00.000Z", "2026-07-27T10:12:30.000Z"),
    ).toBe(13);
  });

  it("nunca es negativo si los relojes se desordenan", () => {
    expect(
      minutosDeTraslado("2026-07-27T10:12:00.000Z", "2026-07-27T10:00:00.000Z"),
    ).toBe(0);
  });
});

describe("la verja de incidencias", () => {
  const hallazgo = (p: Partial<IncidenciaLocal> = {}): IncidenciaLocal => ({
    id: "i1",
    visita_id: "v1",
    levantamiento_id: "lev-oster",
    sku_id: "sku-1",
    exhibicion_negociada_id: null,
    marca_id: "m1",
    marca_nombre: "Oster",
    sku_nombre: "Licuadora X",
    origen: "quiebre",
    estado: "pendiente",
    detalle: null,
    accion_tomada: null,
    motivo: null,
    creado_at: "2026-09-05T10:00:00.000Z",
    derivada: false,
    atendidaSinSincronizar: false,
    ...p,
  });

  const TODAS_AUDITADAS = ["completado", "omitido"];
  const LEIDAS: LecturaIncidencias = { cargando: false, error: null };

  it("sin incidencias, la visita se puede cerrar", () => {
    expect(incidenciasQueFrenan([])).toEqual([]);
    expect(puedeCerrarVisita(TODAS_AUDITADAS, [], LEIDAS)).toBe(true);
  });

  it("todas RESUELTAS: no frena ninguna", () => {
    const cerradas = [
      hallazgo({ estado: "resuelta", accion_tomada: "Repuse desde bodega" }),
      hallazgo({
        id: "i2",
        estado: "resuelta",
        accion_tomada: "Cambié el precio",
      }),
    ];
    expect(incidenciasQueFrenan(cerradas)).toEqual([]);
    expect(puedeCerrarVisita(TODAS_AUDITADAS, cerradas, LEIDAS)).toBe(true);
  });

  it("todas JUSTIFICADAS: tampoco frena ninguna", () => {
    // `no_resuelta` es una incidencia atendida: el mercaderista la miró y dijo
    // por qué no pudo. Exigir que la resolviera sería encerrarlo en la tienda.
    const justificadas = [
      hallazgo({ estado: "no_resuelta", motivo: "El encargado no autorizó" }),
    ];
    expect(incidenciasQueFrenan(justificadas)).toEqual([]);
    expect(puedeCerrarVisita(TODAS_AUDITADAS, justificadas, LEIDAS)).toBe(true);
  });

  it("con una PENDIENTE, la verja no deja salir", () => {
    expect(puedeCerrarVisita(TODAS_AUDITADAS, [hallazgo()], LEIDAS)).toBe(
      false,
    );
  });

  it("y dice CUÁLES faltan, agrupadas por marca", () => {
    // "Una validación previa cuando ya vas a cerrar tu checkout, pero rápida,
    // muy visual": la pantalla necesita los nombres, no un booleano.
    const grupos = incidenciasQueFrenan([
      hallazgo(),
      hallazgo({ id: "i2", marca_id: "m2", marca_nombre: "Sharpie" }),
      hallazgo({ id: "i3", estado: "resuelta", accion_tomada: "Repuse" }),
    ]);
    expect(grupos.map((g) => g.marcaNombre)).toEqual(["Oster", "Sharpie"]);
    expect(grupos.flatMap((g) => g.incidencias).map((i) => i.id)).toEqual([
      "i1",
      "i2",
    ]);
  });

  it("una atendida SIN SINCRONIZAR no frena: el mercaderista ya hizo su parte", () => {
    // Seguir contándola lo dejaría encerrado en la tienda hasta que hubiera
    // señal, que es la trampa que ADR-0012 existe para no construir.
    const atendida = [hallazgo({ atendidaSinSincronizar: true })];
    expect(incidenciasQueFrenan(atendida)).toEqual([]);
    expect(puedeCerrarVisita(TODAS_AUDITADAS, atendida, LEIDAS)).toBe(true);
  });

  it("una marca sin auditar frena aunque no haya incidencias", () => {
    // Las dos condiciones son independientes: la verja vieja sigue viva.
    expect(puedeCerrarVisita(["completado", "en_curso"], [], LEIDAS)).toBe(
      false,
    );
  });

  it("la verja NO mira si la foto ya subió a R2", () => {
    // La subida ocurre después y no bloquea la salida. Una resolución con su
    // foto todavía en la cola de disco cierra igual.
    const conFotoEnCola = [
      hallazgo({ estado: "resuelta", accion_tomada: "Repuse desde bodega" }),
    ];
    expect(puedeCerrarVisita(TODAS_AUDITADAS, conFotoEnCola, LEIDAS)).toBe(
      true,
    );
  });

  it("MIENTRAS CARGA no deja salir: una lista vacía todavía no dice nada", () => {
    // Vacía significa dos cosas opuestas —«no hay hallazgos» y «aún no sé»— y
    // solo el estado de la lectura las distingue.
    expect(
      puedeCerrarVisita(TODAS_AUDITADAS, [], { cargando: true, error: null }),
    ).toBe(false);
  });

  it("con ERROR de la consulta tampoco: es cuando menos se puede confiar", () => {
    // Medido contra `@powersync/react`: al fallar, el hook devuelve
    // `isLoading: false` Y `data: []`. Sin mirar el error, un fallo de la réplica
    // es indistinguible de una visita limpia y la verja se abre sola.
    expect(
      puedeCerrarVisita(TODAS_AUDITADAS, [], {
        cargando: false,
        error: "la réplica está bloqueada",
      }),
    ).toBe(false);
  });
});
