import type {
  CampoFormulario,
  DefinicionFormulario,
} from "@market-track/shared";
import { afterEach, describe, expect, it, jest } from "@jest/globals";

// check-in.ts importa el hook de PowerSync solo para `useFormularioCheckIn`; se
// moquea para probar las funciones puras (mismo patrón que rutero.test.ts).
jest.mock("@powersync/react-native", () => ({
  useQuery: jest.fn(() => ({ data: [] })),
}));

import {
  camposDeCheckIn,
  formularioCheckInDesde,
  puedeConfirmarCheckIn,
  respuestasDeCheckIn,
  resultadoDelChecklist,
} from "./check-in";

const UUID = "b3e9c2a1-4f6d-4b8e-9c2a-1f6d4b8e9c2a";

function campo(over: Partial<CampoFormulario> = {}): CampoFormulario {
  return {
    id: "c",
    tipo: "booleano",
    etiqueta: "C",
    obligatorio: false,
    ...over,
  };
}

describe("puedeConfirmarCheckIn", () => {
  it("el checklist NUNCA participa del gate: sin contestar nada, deja confirmar", () => {
    // La decisión del ticket: el check-in no se bloquea por el checklist. Se
    // registra lo que haya, y la ausencia descuenta en el puntaje, no en el
    // flujo. Por eso la función ni siquiera recibe el checklist como argumento.
    expect(
      puedeConfirmarCheckIn({
        ubicacionOk: true,
        selfieTomada: true,
        guardando: false,
      }),
    ).toBe(true);
  });

  it("sigue exigiendo ubicación y selfie, y bloquea mientras guarda", () => {
    expect(
      puedeConfirmarCheckIn({
        ubicacionOk: false,
        selfieTomada: true,
        guardando: false,
      }),
    ).toBe(false);
    expect(
      puedeConfirmarCheckIn({
        ubicacionOk: true,
        selfieTomada: false,
        guardando: false,
      }),
    ).toBe(false);
    expect(
      puedeConfirmarCheckIn({
        ubicacionOk: true,
        selfieTomada: true,
        guardando: true,
      }),
    ).toBe(false);
  });
});

describe("camposDeCheckIn", () => {
  it("aplana los pasos por su orden, no por el orden del array", () => {
    const definicion: DefinicionFormulario = {
      pasos: [
        { id: "p2", titulo: "B", orden: 1, campos: [campo({ id: "b" })] },
        { id: "p1", titulo: "A", orden: 0, campos: [campo({ id: "a" })] },
      ],
    };
    expect(camposDeCheckIn(definicion).map((c) => c.id)).toEqual(["a", "b"]);
  });

  it("sin definición no hay checklist", () => {
    expect(camposDeCheckIn(null)).toEqual([]);
  });
});

describe("respuestasDeCheckIn", () => {
  it("una fila por campo contestado, con el valor ya coercionado", () => {
    const campos = [
      campo({ id: "botas", tipo: "booleano", etiqueta: "Botas" }),
      campo({ id: "casco", tipo: "booleano", etiqueta: "Casco" }),
      campo({ id: "notas", tipo: "texto", etiqueta: "Notas" }),
    ];
    const r = respuestasDeCheckIn(campos, {
      botas: true,
      casco: false,
      notas: "  ",
    });
    // El texto en blanco no cuenta como contestado; los sí/no siempre.
    expect(r).toEqual([
      { campo_id: "botas", valor: true },
      { campo_id: "casco", valor: false },
    ]);
  });

  it("un campo foto sin capturar NO produce fila: la ausencia es un dato derivable", () => {
    // La visita ancla `formulario_version_id`: se sabe qué se pidió. Guardar un
    // "" centinela obligaría al puntaje a distinguir "no contestó" de "contestó
    // vacío", que es la misma cosa dicha dos veces.
    const campos = [campo({ id: "foto", tipo: "foto", etiqueta: "Foto" })];
    expect(respuestasDeCheckIn(campos, {})).toEqual([]);
    expect(respuestasDeCheckIn(campos, { foto: "" })).toEqual([]);
  });

  it("un campo foto capturado guarda su uuid", () => {
    const campos = [campo({ id: "foto", tipo: "foto", etiqueta: "Foto" })];
    expect(respuestasDeCheckIn(campos, { foto: UUID })).toEqual([
      { campo_id: "foto", valor: UUID },
    ]);
  });
});

describe("resultadoDelChecklist", () => {
  it("si el checklist no se guardó, avisa y NO navega (el aviso debe leerse)", () => {
    const r = resultadoDelChecklist({
      checklistGuardado: false,
      fotosPerdidas: false,
    });
    expect(r.navegar).toBe(false);
    expect(r.aviso).toContain("el checklist no se pudo guardar");
    expect(r.aviso).toContain("El check-in quedó registrado");
  });

  it("si solo se perdió la foto, avisa eso y tampoco navega", () => {
    const r = resultadoDelChecklist({
      checklistGuardado: true,
      fotosPerdidas: true,
    });
    expect(r.navegar).toBe(false);
    expect(r.aviso).toContain("la foto del checklist no se pudo guardar");
  });

  it("con todo guardado, navega sin aviso", () => {
    expect(
      resultadoDelChecklist({ checklistGuardado: true, fotosPerdidas: false }),
    ).toEqual({ aviso: "", navegar: true });
  });
});

describe("formularioCheckInDesde", () => {
  const checklistActivo = {
    id: "f1",
    marca_id: null,
    creado_at: "2026-08-01",
    ambito: "check_in",
  };

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("avisa cuando hay un checklist activo sin versión publicada (config a medias)", () => {
    const warn = jest.spyOn(console, "warn").mockImplementation(() => {});

    const r = formularioCheckInDesde([checklistActivo], []);

    expect(r.versionId).toBeNull();
    expect(r.campos).toEqual([]);
    expect(warn).toHaveBeenCalledWith(
      "[check-in] hay un checklist activo sin versión publicada",
    );
  });

  it("sin checklist configurado no avisa: no hay nada a medias", () => {
    const warn = jest.spyOn(console, "warn").mockImplementation(() => {});
    expect(formularioCheckInDesde([], []).versionId).toBeNull();
    expect(warn).not.toHaveBeenCalled();
  });

  it("resuelve la versión publicada y aplana sus campos", () => {
    const definicion = JSON.stringify({
      pasos: [
        {
          id: "p1",
          titulo: "Herramientas",
          orden: 0,
          campos: [{ id: "botas", tipo: "booleano", etiqueta: "Botas" }],
        },
      ],
    });
    const r = formularioCheckInDesde(
      [checklistActivo],
      [{ id: "v1", formulario_id: "f1", version: 1, definicion }],
    );

    expect(r.versionId).toBe("v1");
    expect(r.campos.map((c) => c.id)).toEqual(["botas"]);
  });

  it("una definición ilegible degrada a sin-checklist, no revienta", () => {
    jest.spyOn(console, "warn").mockImplementation(() => {});
    const r = formularioCheckInDesde(
      [checklistActivo],
      [{ id: "v1", formulario_id: "f1", version: 1, definicion: "{roto" }],
    );
    expect(r).toEqual({ versionId: null, campos: [] });
  });
});
