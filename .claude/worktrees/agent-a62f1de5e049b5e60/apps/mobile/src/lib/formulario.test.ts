import { TOPES_RESPUESTA, type CampoFormulario } from "@market-track/shared";
import { describe, expect, it } from "@jest/globals";

import {
  coercionValorRespuesta,
  crudoDesdeValor,
  estaContestado,
  faltanObligatorios,
  fotosPorEncolar,
  parseDefinicionFormulario,
  resolverVersionAnclada,
} from "./formulario";

const DEF_VALIDA = JSON.stringify({
  pasos: [
    {
      id: "p1",
      titulo: "Datos extra",
      orden: 0,
      campos: [{ id: "temp", tipo: "decimal", etiqueta: "Temperatura" }],
    },
  ],
});

describe("parseDefinicionFormulario", () => {
  it("parsea y valida una definición correcta", () => {
    const d = parseDefinicionFormulario(DEF_VALIDA);
    expect(d?.pasos[0]?.campos[0]?.id).toBe("temp");
  });

  it("devuelve null ante null o cadena vacía", () => {
    expect(parseDefinicionFormulario(null)).toBeNull();
    expect(parseDefinicionFormulario("   ")).toBeNull();
  });

  it("devuelve null ante JSON roto (degrada a pasos fijos, no revienta)", () => {
    expect(parseDefinicionFormulario("{pasos:")).toBeNull();
  });

  it("devuelve null ante una definición inválida (selección sin opciones)", () => {
    const invalida = JSON.stringify({
      pasos: [
        {
          id: "p1",
          titulo: "X",
          orden: 0,
          campos: [{ id: "c", tipo: "seleccion", etiqueta: "Estado" }],
        },
      ],
    });
    expect(parseDefinicionFormulario(invalida)).toBeNull();
  });
});

describe("resolverVersionAnclada", () => {
  const marca = "m1";
  const paraLev = { ambito: "levantamiento", marcaId: marca } as const;
  const formEspecifico = { id: "fe", marca_id: marca, creado_at: "2026-07-02" };
  const formTodas = { id: "ft", marca_id: null, creado_at: "2026-07-01" };

  it("prefiere el formulario específico de la marca sobre el de todas", () => {
    const v = resolverVersionAnclada(
      [formTodas, formEspecifico],
      [
        { id: "vt", formulario_id: "ft", version: 3 },
        { id: "ve", formulario_id: "fe", version: 1 },
      ],
      paraLev,
    );
    expect(v).toBe("ve");
  });

  it("usa el de todas las marcas cuando no hay uno específico", () => {
    const v = resolverVersionAnclada(
      [formTodas],
      [{ id: "vt", formulario_id: "ft", version: 1 }],
      paraLev,
    );
    expect(v).toBe("vt");
  });

  it("a igual especificidad, gana el formulario más reciente (no la versión más alta)", () => {
    const viejo = { id: "viejo", marca_id: marca, creado_at: "2026-07-01" };
    const nuevo = { id: "nuevo", marca_id: marca, creado_at: "2026-07-10" };
    const v = resolverVersionAnclada(
      [viejo, nuevo],
      [
        { id: "v_viejo", formulario_id: "viejo", version: 99 },
        { id: "v_nuevo", formulario_id: "nuevo", version: 1 },
      ],
      paraLev,
    );
    expect(v).toBe("v_nuevo");
  });

  it("elige la versión publicada más alta del formulario elegido", () => {
    const v = resolverVersionAnclada(
      [formTodas],
      [
        { id: "vt1", formulario_id: "ft", version: 1 },
        { id: "vt2", formulario_id: "ft", version: 2 },
      ],
      paraLev,
    );
    expect(v).toBe("vt2");
  });

  it("cae al de todas las marcas si el específico no tiene versión publicada", () => {
    const v = resolverVersionAnclada(
      [formTodas, formEspecifico],
      [{ id: "vt", formulario_id: "ft", version: 1 }],
      paraLev,
    );
    expect(v).toBe("vt");
  });

  it("devuelve null si no hay formulario para la marca", () => {
    expect(resolverVersionAnclada([], [], paraLev)).toBeNull();
  });

  it("el ámbito levantamiento IGNORA los formularios de check-in", () => {
    // Sin este filtro, un checklist de check-in (marca_id null) entraría al
    // levantamiento como candidato "de todas las marcas".
    const checkIn = {
      id: "fc",
      marca_id: null,
      creado_at: "2026-08-01",
      ambito: "check_in",
    };
    const v = resolverVersionAnclada(
      [checkIn, { ...formTodas, ambito: "levantamiento" }],
      [
        { id: "vc", formulario_id: "fc", version: 5 },
        { id: "vt", formulario_id: "ft", version: 1 },
      ],
      paraLev,
    );
    expect(v).toBe("vt");
  });

  it("el ámbito check_in elige el checklist más reciente e ignora los del levantamiento", () => {
    const viejo = {
      id: "c1",
      marca_id: null,
      creado_at: "2026-08-01",
      ambito: "check_in",
    };
    const nuevo = {
      id: "c2",
      marca_id: null,
      creado_at: "2026-08-10",
      ambito: "check_in",
    };
    const v = resolverVersionAnclada(
      [{ ...formTodas, ambito: "levantamiento" }, viejo, nuevo],
      [
        { id: "vt", formulario_id: "ft", version: 9 },
        { id: "v1", formulario_id: "c1", version: 3 },
        { id: "v2", formulario_id: "c2", version: 1 },
      ],
      { ambito: "check_in" },
    );
    expect(v).toBe("v2");
  });

  it("un formulario con ámbito NULO (réplica anterior a la migración) cuenta como levantamiento", () => {
    // PowerSync solo reenvía una fila cuando cambia: un teléfono con la réplica
    // de antes de la migración trae `ambito` null indefinidamente. Sin este
    // fallback, el primer arranque tras actualizar la app perdería TODOS los
    // formularios de levantamiento existentes.
    const sinAmbito = { id: "ft", marca_id: null, creado_at: "2026-07-01" };
    expect(
      resolverVersionAnclada(
        [sinAmbito],
        [{ id: "vt", formulario_id: "ft", version: 1 }],
        paraLev,
      ),
    ).toBe("vt");
    expect(
      resolverVersionAnclada(
        [sinAmbito],
        [{ id: "vt", formulario_id: "ft", version: 1 }],
        { ambito: "check_in" },
      ),
    ).toBeNull();
  });
});

function campo(over: Partial<CampoFormulario> = {}): CampoFormulario {
  return { id: "c", tipo: "texto", etiqueta: "C", obligatorio: false, ...over };
}

describe("coercionValorRespuesta", () => {
  it("recorta el texto", () => {
    expect(coercionValorRespuesta(campo({ tipo: "texto" }), "  hola ")).toBe(
      "hola",
    );
  });

  it("trunca y acota un entero a su rango", () => {
    expect(
      coercionValorRespuesta(campo({ tipo: "entero", max: 10 }), "12.9"),
    ).toBe(10);
    expect(
      coercionValorRespuesta(campo({ tipo: "entero", min: 0 }), "-3"),
    ).toBe(0);
  });

  it("trunca el texto libre a su tope", () => {
    // Es la única cota entre el teclado del mercaderista y una tabla que se
    // replica a todos los teléfonos del cliente. Sin esto, una sesión
    // comprometida guarda megabytes por campo.
    const largo = "x".repeat(TOPES_RESPUESTA.textoChars + 500);
    const r = coercionValorRespuesta(campo({ tipo: "texto" }), largo);
    expect(typeof r === "string" && r.length).toBe(TOPES_RESPUESTA.textoChars);
  });

  it("el párrafo tiene su propio tope, más alto que el del texto", () => {
    const largo = "x".repeat(TOPES_RESPUESTA.parrafoChars + 500);
    const r = coercionValorRespuesta(campo({ tipo: "parrafo" }), largo);
    expect(typeof r === "string" && r.length).toBe(
      TOPES_RESPUESTA.parrafoChars,
    );
  });

  it("recorta espacios ANTES de medir: no se gasta el tope en blancos", () => {
    const conEspacios = "  " + "x".repeat(TOPES_RESPUESTA.textoChars) + "  ";
    const r = coercionValorRespuesta(campo({ tipo: "texto" }), conEspacios);
    expect(typeof r === "string" && r.length).toBe(TOPES_RESPUESTA.textoChars);
  });

  it("un texto dentro del tope no se toca", () => {
    expect(coercionValorRespuesta(campo({ tipo: "texto" }), "Todo bien")).toBe(
      "Todo bien",
    );
  });

  it("un texto de exactamente el tope no se recorta", () => {
    const justo = "x".repeat(TOPES_RESPUESTA.textoChars);
    expect(coercionValorRespuesta(campo({ tipo: "texto" }), justo)).toBe(justo);
  });

  it("un párrafo de acentos cabe en la base: se mide en bytes, no caracteres", () => {
    // 10.000 caracteres acentuados son 20.012 bytes —medido contra Postgres— y
    // el `check` de la tabla permite 16 KB. Recortando por caracteres, la app
    // guardaría algo que la base rechaza al sincronizar, y el mercaderista lo
    // descubriría horas después y fuera de la tienda.
    const acentos = "ñ".repeat(TOPES_RESPUESTA.parrafoChars);
    const r = coercionValorRespuesta(
      campo({ tipo: "parrafo" }),
      acentos,
    ) as string;
    expect(Buffer.byteLength(r, "utf8")).toBeLessThanOrEqual(
      TOPES_RESPUESTA.bytes,
    );
  });

  it("no parte un emoji por la mitad", () => {
    // Cortar por unidades UTF-16 dejaría un surrogate suelto, que al serializar
    // se vuelve U+FFFD: la respuesta no se cortaría, se corrompería en su último
    // carácter.
    const emojis = "😀".repeat(TOPES_RESPUESTA.parrafoChars);
    const r = coercionValorRespuesta(
      campo({ tipo: "parrafo" }),
      emojis,
    ) as string;
    expect([...r].every((c) => c === "😀")).toBe(true);
    expect(Buffer.byteLength(r, "utf8")).toBeLessThanOrEqual(
      TOPES_RESPUESTA.bytes,
    );
  });

  it("la selección múltiple no admite la misma opción repetida", () => {
    const c = campo({ tipo: "seleccion_multiple", opciones: ["A", "B"] });
    expect(coercionValorRespuesta(c, ["A", "A", "A", "B"])).toEqual(["A", "B"]);
  });

  it("un entero no numérico cae a 0", () => {
    expect(coercionValorRespuesta(campo({ tipo: "entero" }), "abc")).toBe(0);
  });

  it("con un rango invertido nunca devuelve por encima del máximo", () => {
    // {min:10, max:5} ya no se puede publicar —el esquema estricto lo rechaza—
    // pero puede venir en una definición guardada antes de esa verja. Antes se
    // devolvía 10: por encima del máximo que declara el propio campo, o sea un
    // dato que contradice al formulario que lo pidió.
    expect(
      coercionValorRespuesta(campo({ tipo: "entero", min: 10, max: 5 }), "3"),
    ).toBe(5);
    expect(
      coercionValorRespuesta(
        campo({ tipo: "decimal", min: 10, max: 5 }),
        "7.5",
      ),
    ).toBe(5);
  });

  it("el decimal conserva los decimales y acota al rango", () => {
    expect(coercionValorRespuesta(campo({ tipo: "decimal" }), "4.5")).toBe(4.5);
    expect(
      coercionValorRespuesta(campo({ tipo: "decimal", max: 10 }), "12.5"),
    ).toBe(10);
    expect(coercionValorRespuesta(campo({ tipo: "decimal" }), "abc")).toBe(0);
  });

  it("interpreta el booleano desde bool, cadena 'true' o 1", () => {
    expect(coercionValorRespuesta(campo({ tipo: "booleano" }), true)).toBe(
      true,
    );
    expect(coercionValorRespuesta(campo({ tipo: "booleano" }), false)).toBe(
      false,
    );
    expect(coercionValorRespuesta(campo({ tipo: "booleano" }), "true")).toBe(
      true,
    );
    expect(coercionValorRespuesta(campo({ tipo: "booleano" }), 1)).toBe(true);
    expect(coercionValorRespuesta(campo({ tipo: "booleano" }), "no")).toBe(
      false,
    );
  });

  it("descarta una selección fuera de las opciones", () => {
    const c = campo({ tipo: "seleccion", opciones: ["A", "B"] });
    expect(coercionValorRespuesta(c, "B")).toBe("B");
    expect(coercionValorRespuesta(c, "Z")).toBe("");
  });

  it("acota la selección múltiple a las opciones válidas", () => {
    const c = campo({ tipo: "seleccion_multiple", opciones: ["A", "B"] });
    expect(coercionValorRespuesta(c, ["A", "Z", "B"])).toEqual(["A", "B"]);
  });

  it("la respuesta de una foto es su uuid, devuelto tal cual", () => {
    const c = campo({ tipo: "foto" });
    const id = "b3e9c2a1-4f6d-4b8e-9c2a-1f6d4b8e9c2a";
    expect(coercionValorRespuesta(c, id)).toBe(id);
  });

  it("acepta un uuid de seed sin bits de versión (z.guid, no z.uuid)", () => {
    // Postgres no exige los bits de versión/variante del RFC 9562; los ids del
    // seed del proyecto no los cumplen y aun así son uuid válidos para la base.
    const c = campo({ tipo: "foto" });
    const seed = "11111111-1111-1111-1111-111111111111";
    expect(coercionValorRespuesta(c, seed)).toBe(seed);
  });

  it("texto arbitrario en un campo foto no pasa por referencia", () => {
    // Un valor que no es uuid no apunta a ninguna fila `foto`: guardarlo dejaría
    // el campo "contestado" con una referencia que la app no puede resolver.
    const c = campo({ tipo: "foto" });
    expect(coercionValorRespuesta(c, "foto.jpg")).toBe("");
    expect(coercionValorRespuesta(c, "si")).toBe("");
  });

  it("un no-string en un campo foto cae a vacío", () => {
    const c = campo({ tipo: "foto" });
    expect(coercionValorRespuesta(c, 42)).toBe("");
    expect(coercionValorRespuesta(c, true)).toBe("");
    expect(coercionValorRespuesta(c, null)).toBe("");
    expect(coercionValorRespuesta(c, ["a"])).toBe("");
    expect(coercionValorRespuesta(c, {})).toBe("");
  });
});

describe("estaContestado / faltanObligatorios", () => {
  it("un texto en blanco no cuenta como contestado", () => {
    expect(estaContestado("  ")).toBe(false);
    expect(estaContestado("x")).toBe(true);
  });

  it("una lista vacía no cuenta; un booleano sí (presente)", () => {
    expect(estaContestado([])).toBe(false);
    expect(estaContestado(["A"])).toBe(true);
    expect(estaContestado(false)).toBe(true);
  });

  it("falta un obligatorio sin contestar, pero no si es opcional", () => {
    const campos = [
      campo({ id: "req", obligatorio: true }),
      campo({ id: "opt", obligatorio: false }),
    ];
    expect(faltanObligatorios(campos, {})).toBe(true);
    expect(faltanObligatorios(campos, { req: "listo" })).toBe(false);
  });

  it("una foto obligatoria falta hasta que hay captura, y su uuid la satisface", () => {
    const campos = [campo({ id: "f", tipo: "foto", obligatorio: true })];
    expect(faltanObligatorios(campos, {})).toBe(true);
    expect(faltanObligatorios(campos, { f: "" })).toBe(true);
    expect(
      faltanObligatorios(campos, {
        f: "b3e9c2a1-4f6d-4b8e-9c2a-1f6d4b8e9c2a",
      }),
    ).toBe(false);
  });

  it("una foto opcional sin capturar no bloquea el paso", () => {
    const campos = [campo({ id: "f", tipo: "foto", obligatorio: false })];
    expect(faltanObligatorios(campos, {})).toBe(false);
  });
});

describe("crudoDesdeValor", () => {
  it("el uuid de una foto guardada vuelve tal cual (round-trip)", () => {
    const id = "b3e9c2a1-4f6d-4b8e-9c2a-1f6d4b8e9c2a";
    expect(crudoDesdeValor(JSON.stringify(id))).toBe(id);
  });

  it("números y booleanos vuelven a su forma de edición", () => {
    expect(crudoDesdeValor("4.5")).toBe("4.5");
    expect(crudoDesdeValor("true")).toBe(true);
    expect(crudoDesdeValor('["A","B"]')).toEqual(["A", "B"]);
  });

  it("un JSON roto o de forma inesperada cae a sin-contestar, no revienta", () => {
    expect(crudoDesdeValor("{roto")).toBeUndefined();
    expect(crudoDesdeValor('{"un":"objeto"}')).toBeUndefined();
    expect(crudoDesdeValor("null")).toBeUndefined();
  });
});

describe("fotosPorEncolar", () => {
  const ID_A = "aaaaaaaa-0000-0000-0000-000000000001";
  const ID_B = "bbbbbbbb-0000-0000-0000-000000000002";
  const campos = [
    campo({ id: "f1", tipo: "foto" }),
    campo({ id: "texto", tipo: "texto" }),
    campo({ id: "f2", tipo: "foto" }),
  ];

  it("devuelve solo los campos foto con captura pendiente, en orden", () => {
    const r = fotosPorEncolar(
      campos,
      { f1: ID_A, texto: "hola", f2: ID_B },
      { [ID_A]: "fotoA", [ID_B]: "fotoB" },
    );
    expect(r).toEqual([
      { campoId: "f1", id: ID_A, foto: "fotoA" },
      { campoId: "f2", id: ID_B, foto: "fotoB" },
    ]);
  });

  it("un uuid sin entrada pendiente no se re-encola (reintento tras fallo parcial)", () => {
    // La primera foto se encoló y su entrada se limpió; la segunda falló. Al
    // reintentar, solo la segunda debe volver a la cola.
    const r = fotosPorEncolar(
      campos,
      { f1: ID_A, f2: ID_B },
      { [ID_B]: "fotoB" },
    );
    expect(r).toEqual([{ campoId: "f2", id: ID_B, foto: "fotoB" }]);
  });

  it("un campo foto sin capturar y una entrada huérfana no producen nada", () => {
    // La entrada huérfana (uuid que ya no está en valores) fue reemplazada por
    // una recaptura: no debe encolarse.
    expect(fotosPorEncolar(campos, {}, { [ID_A]: "huerfana" })).toEqual([]);
  });
});
