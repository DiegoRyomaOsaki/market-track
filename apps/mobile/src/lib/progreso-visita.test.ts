import type { DefinicionFormulario } from "@market-track/shared";
import { describe, expect, it } from "@jest/globals";

import { construirPasos, PASOS } from "./pasos-levantamiento";
import { estadoDeModulos } from "./progreso-visita";

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
