import type { DefinicionFormulario } from "@market-track/shared";
import { describe, expect, it, jest } from "@jest/globals";

// `estadoDeModulos` es pura, pero vive junto a los hooks que leen la réplica y a
// la escritura del módulo cerrado. Se moquean sus dependencias nativas para que
// Jest pueda cargar el módulo; ninguna de ellas participa en estos tests.
jest.mock("@powersync/react-native", () => ({ useQuery: jest.fn() }));
jest.mock("expo-crypto", () => ({ randomUUID: jest.fn() }));
jest.mock("./powersync/db", () => ({ db: {} }));

import { construirPasos, PASOS } from "./pasos-levantamiento";
import {
  armarMenuDeVisita,
  estadoDeModulos,
  marcaCompleta,
} from "./progreso-visita";

// El progreso de cada módulo dentro de una marca. Es la lógica que decide qué
// pinta el menú de visita, y con navegación libre es lo único que impide que el
// mercaderista rehaga un módulo ya terminado o dé por hecho uno que no abrió.

const definicionCon = (...ids: string[]): DefinicionFormulario => ({
  pasos: ids.map((id, orden) => ({
    id,
    titulo: `Paso ${id}`,
    orden,
    campos: [],
  })),
});

describe("estadoDeModulos", () => {
  it("un módulo sin fila en ninguna de las dos tablas está pendiente", () => {
    const estados = estadoDeModulos([...PASOS], [], []);
    expect(estados.get("quiebres")?.estado).toBe("pendiente");
    expect(estados.size).toBe(PASOS.length);
  });

  it("un módulo con fila en levantamiento_paso está completado", () => {
    const estados = estadoDeModulos(
      [...PASOS],
      [{ paso: "quiebres", paso_config_id: null }],
      [],
    );
    expect(estados.get("quiebres")?.estado).toBe("completado");
    expect(estados.get("precios")?.estado).toBe("pendiente");
  });

  it("un módulo con contingencia está omitido, y el motivo llega al menú", () => {
    const estados = estadoDeModulos(
      [...PASOS],
      [],
      [
        {
          paso: "quiebres",
          paso_config_id: null,
          motivo: "El encargado no me dejó entrar a la trastienda",
        },
      ],
    );
    expect(estados.get("quiebres")?.estado).toBe("omitido");
    expect(estados.get("quiebres")?.motivoOmision).toBe(
      "El encargado no me dejó entrar a la trastienda",
    );
  });

  // La decisión que da sentido al ticket: "el mercaderista no puede quedarse
  // trabado — si no lo dejan entrar a la trastienda, sigue y vuelve después".
  // Si al volver lo completa, el módulo está HECHO: pintarlo "Omitido" negaría
  // el trabajo que acaba de hacer. La contingencia no se borra —es la prueba de
  // que pasó, y su alerta al supervisor ya salió— y por eso el motivo sobrevive
  // en `motivoOmision`.
  it("completar un módulo que se había omitido lo deja completado, conservando el motivo", () => {
    const estados = estadoDeModulos(
      [...PASOS],
      [{ paso: "quiebres", paso_config_id: null }],
      [
        {
          paso: "quiebres",
          paso_config_id: null,
          motivo: "No me dejaban entrar; volví al final del turno",
        },
      ],
    );
    expect(estados.get("quiebres")?.estado).toBe("completado");
    expect(estados.get("quiebres")?.motivoOmision).toBe(
      "No me dejaban entrar; volví al final del turno",
    );
  });

  it("un paso configurable se casa por paso_config_id, no por el enum que comparten", () => {
    const pasos = construirPasos(definicionCon("extra_uno", "extra_dos"));
    const estados = estadoDeModulos(
      pasos,
      [{ paso: "campos_extra", paso_config_id: "extra_uno" }],
      [],
    );
    expect(estados.get("extra_uno")?.estado).toBe("completado");
    // El segundo comparte el enum `campos_extra` y NO puede contaminarse.
    expect(estados.get("extra_dos")?.estado).toBe("pendiente");
  });

  it("una contingencia de un paso configurable no omite a los demás configurables", () => {
    const pasos = construirPasos(definicionCon("extra_uno", "extra_dos"));
    const estados = estadoDeModulos(
      pasos,
      [],
      [
        {
          paso: "campos_extra",
          paso_config_id: "extra_dos",
          motivo: "No aplica en esta tienda",
        },
      ],
    );
    expect(estados.get("extra_dos")?.estado).toBe("omitido");
    expect(estados.get("extra_uno")?.estado).toBe("pendiente");
  });

  // Una fila de un paso fijo lleva `paso_config_id` nulo. Si el emparejamiento
  // solo mirase el enum, la fila de un configurable omitido (`campos_extra`)
  // no tendría con qué distinguirse — y al revés.
  it("una fila de paso fijo no marca a un configurable, ni al contrario", () => {
    const pasos = construirPasos(definicionCon("extra_uno"));
    const estados = estadoDeModulos(
      pasos,
      [{ paso: "quiebres", paso_config_id: null }],
      [],
    );
    expect(estados.get("quiebres")?.estado).toBe("completado");
    expect(estados.get("extra_uno")?.estado).toBe("pendiente");
  });

  it("una definición descartada por ids inválidos deja el mapa con los cinco fijos", () => {
    // `construirPasos` degrada a los fijos cuando un id configurable choca con
    // uno fijo. El mapa tiene que seguir siendo consistente con lo que se pinta.
    const pasos = construirPasos(definicionCon("quiebres"));
    const estados = estadoDeModulos(pasos, [], []);
    expect(estados.size).toBe(PASOS.length);
    expect([...estados.keys()]).toEqual(PASOS.map((p) => p.id));
  });

  it("ignora filas de módulos que la definición de esta marca no tiene", () => {
    // El formulario se puede republicar: una fila vieja de un paso que ya no
    // existe no puede colarse en el mapa ni contar para el cierre.
    const estados = estadoDeModulos(
      [...PASOS],
      [{ paso: "campos_extra", paso_config_id: "paso_que_ya_no_existe" }],
      [],
    );
    expect(estados.size).toBe(PASOS.length);
    expect([...estados.values()].every((e) => e.estado === "pendiente")).toBe(
      true,
    );
  });
});

describe("marcaCompleta", () => {
  // Decide cuándo se cierra el levantamiento de una marca, así que un fallo aquí
  // se escribe en la base: cerrarla de más da una visita por terminada con
  // trabajo sin hacer, y de menos no deja llegar nunca al check-out.
  const conEstados = (...estados: ("pendiente" | "completado" | "omitido")[]) =>
    new Map(estados.map((estado, i) => [`m${i}`, { estado }]));

  it("no está completa mientras quede un módulo pendiente", () => {
    expect(marcaCompleta(conEstados("completado", "pendiente"))).toBe(false);
  });

  it("está completa con todos los módulos cerrados", () => {
    expect(marcaCompleta(conEstados("completado", "completado"))).toBe(true);
  });

  it("un módulo OMITIDO cuenta como cerrado: el bypass no bloquea el cierre", () => {
    // Compromiso de la propuesta aceptada: el levantamiento es secuencial pero
    // no un bloqueo absoluto. Una marca con un paso omitido tiene que poder
    // llegar al check-out.
    expect(marcaCompleta(conEstados("completado", "omitido"))).toBe(true);
  });

  it("una marca sin módulos NO está completa", () => {
    // Un mapa vacío significa que la definición aún no cargó, no que no haya
    // nada que hacer. Darla por completa cerraría la marca sin auditar nada.
    expect(marcaCompleta(new Map())).toBe(false);
  });
});

const marcaAuditable = (id: string, nombre: string, lev: string | null) => ({
  id,
  nombre,
  logo_url: null,
  levantamiento_id: lev,
  levantamiento_estado: "en_curso" as string | null,
});

const OSTER = marcaAuditable("m1", "Oster", "lev-oster");
const SHARPIE = marcaAuditable("m2", "Sharpie", "lev-sharpie");
const SIN_DEFINICION = new Map<string, DefinicionFormulario | null>();

describe("armarMenuDeVisita", () => {
  // El pivote que da nombre al ticket. Antes la lista de primer nivel eran las
  // marcas y había que terminar una entera para pasar a la siguiente.
  it("agrupa por MÓDULO, con las marcas dentro", () => {
    const menu = armarMenuDeVisita([OSTER, SHARPIE], SIN_DEFINICION, [], []);

    expect(menu.modulos.map((m) => m.modulo.id)).toEqual(
      PASOS.map((p) => p.id),
    );
    for (const entrada of menu.modulos) {
      expect(entrada.marcas.map((x) => x.marca.id)).toEqual(["m1", "m2"]);
    }
  });

  it("cada marca solo ve SUS módulos cerrados, nunca los de la otra", () => {
    // Es la garantía de "lo capturado no se pierde al cambiar de marca" a nivel
    // de datos: el menú lee las filas de toda la visita en una sola consulta, y
    // repartirlas mal daría marcas con módulos cerrados que nunca cerraron.
    const menu = armarMenuDeVisita(
      [OSTER, SHARPIE],
      SIN_DEFINICION,
      [
        {
          levantamiento_id: "lev-oster",
          paso: "quiebres",
          paso_config_id: null,
        },
      ],
      [],
    );

    const quiebres = menu.modulos.find((m) => m.modulo.id === "quiebres");
    expect(
      quiebres?.marcas.find((x) => x.marca.id === "m1")?.progreso.estado,
    ).toBe("completado");
    expect(
      quiebres?.marcas.find((x) => x.marca.id === "m2")?.progreso.estado,
    ).toBe("pendiente");
  });

  it("una marca sin levantamiento todavía no hereda las filas de nadie", () => {
    const reciente = marcaAuditable("m3", "Nueva", null);
    const menu = armarMenuDeVisita(
      [reciente],
      SIN_DEFINICION,
      [
        {
          levantamiento_id: "lev-oster",
          paso: "quiebres",
          paso_config_id: null,
        },
      ],
      [],
    );

    const quiebres = menu.modulos.find((m) => m.modulo.id === "quiebres");
    expect(quiebres?.marcas[0]?.progreso.estado).toBe("pendiente");
  });

  it("no está todo listo mientras una sola marca tenga un módulo pendiente", () => {
    const cerradosDeOster = PASOS.map((p) => ({
      levantamiento_id: "lev-oster",
      paso: p.paso,
      paso_config_id: null,
    }));
    const menu = armarMenuDeVisita(
      [OSTER, SHARPIE],
      SIN_DEFINICION,
      cerradosDeOster,
      [],
    );

    expect(menu.todoListo).toBe(false);
  });

  it("con todas las marcas cerradas, el check-out ya se puede ofrecer", () => {
    const cerrados = ["lev-oster", "lev-sharpie"].flatMap((lev) =>
      PASOS.map((p) => ({
        levantamiento_id: lev,
        paso: p.paso,
        paso_config_id: null,
      })),
    );
    const menu = armarMenuDeVisita(
      [OSTER, SHARPIE],
      SIN_DEFINICION,
      cerrados,
      [],
    );

    expect(menu.todoListo).toBe(true);
  });

  it("una visita sin marcas no está lista: no hay nada auditado", () => {
    expect(armarMenuDeVisita([], SIN_DEFINICION, [], []).todoListo).toBe(false);
  });

  it("un módulo configurable de UNA marca aparece solo en esa marca", () => {
    // `useDefinicionesDeVisita` documenta que la definición puede diferir entre
    // marcas. Si el pivote agrupara mal, el menú ofrecería a Sharpie un módulo
    // que su formulario no tiene.
    const definiciones = new Map<string, DefinicionFormulario | null>([
      ["m1", definicionCon("extra_solo_oster")],
      ["m2", null],
    ]);
    const menu = armarMenuDeVisita([OSTER, SHARPIE], definiciones, [], []);

    const extra = menu.modulos.find((m) => m.modulo.id === "extra_solo_oster");
    expect(extra?.marcas.map((x) => x.marca.id)).toEqual(["m1"]);
  });

  it("el motivo del bypass llega al menú por la marca que lo registró", () => {
    const menu = armarMenuDeVisita(
      [OSTER, SHARPIE],
      SIN_DEFINICION,
      [],
      [
        {
          levantamiento_id: "lev-sharpie",
          paso: "quiebres",
          paso_config_id: null,
          motivo: "No me dejaron entrar",
        },
      ],
    );

    const quiebres = menu.modulos.find((m) => m.modulo.id === "quiebres");
    const sharpie = quiebres?.marcas.find((x) => x.marca.id === "m2");
    expect(sharpie?.progreso.estado).toBe("omitido");
    expect(sharpie?.progreso.motivoOmision).toBe("No me dejaron entrar");
    expect(
      quiebres?.marcas.find((x) => x.marca.id === "m1")?.progreso.motivoOmision,
    ).toBeUndefined();
  });
});
