// Tests del guardarraíl de secretos de las Edge Functions. Corren con
// `pnpm test:scripts` (Vitest desde la raíz) y en CI: sin red, sin nube.

import { describe, expect, it } from "vitest";

import {
  leerSecretos,
  resumirPayload,
  OBLIGATORIOS,
  revisarSecretos,
  secretosUsadosEnElCodigo,
} from "./verificar-secretos-funciones.mjs";

const REF = "twtoqaqgziwryuaibktt";

/**
 * Los obligatorios, ESCRITOS A MANO. Derivarlos de `OBLIGATORIOS` haría estos
 * tests autoconsistentes en vez de fijar nada: borrar las cuatro `R2_*` de la
 * lista dejaría la suite entera en verde y el guardarraíl mudo sobre R2. Y el
 * escáner de código tampoco las cubre —`leerConfigR2` las lee con
 * `Deno.env.toObject()`, que el regex no ve—, así que esta lista es lo único
 * que las sostiene. Es un contrato de seguridad: se fija a mano, a propósito.
 */
const OBLIGATORIOS_ESPERADOS = [
  "ALERTA_WEBHOOK_SECRET",
  "FOTO_VERIFICACION_SECRET",
  "PASE_HASH_SECRET",
  "R2_ACCESS_KEY_ID",
  "R2_ACCOUNT_ID",
  "R2_BUCKET",
  "R2_SECRET_ACCESS_KEY",
  "SEND_SMS_HOOK_SECRET",
];

const TODOS = OBLIGATORIOS_ESPERADOS;

/**
 * La salida de `supabase secrets list`: nombres y digests, sin valores.
 *
 * @param {string[]} nombres
 * @returns {string}
 */
function respuesta(nombres) {
  return JSON.stringify({
    secrets: nombres.map((/** @type {string} */ name) => ({
      name,
      value: "d1ge5t",
      updated_at: "2026-08-18T00:00:00Z",
    })),
  });
}

describe("la lista de obligatorios", () => {
  it("es exactamente esta, y cambiarla exige cambiar el test", () => {
    expect(Object.keys(OBLIGATORIOS).sort()).toEqual(
      [...OBLIGATORIOS_ESPERADOS].sort(),
    );
  });

  it.each(OBLIGATORIOS_ESPERADOS)("exige %s cuando falta", (secreto) => {
    const problemas = revisarSecretos({
      presentes: OBLIGATORIOS_ESPERADOS.filter((n) => n !== secreto),
      usados: [],
      projectRef: REF,
    });

    expect(problemas).toHaveLength(1);
    expect(problemas[0]).toContain(secreto);
  });
});

describe("revisarSecretos", () => {
  it("no dice nada de un entorno con todo cargado", () => {
    expect(
      revisarSecretos({ presentes: TODOS, usados: [], projectRef: REF }),
    ).toEqual([]);
  });

  it("nombra el secreto que falta, por qué importa y el comando que lo carga", () => {
    const problemas = revisarSecretos({
      presentes: TODOS.filter((n) => n !== "SEND_SMS_HOOK_SECRET"),
      usados: [],
      projectRef: REF,
    });

    expect(problemas).toHaveLength(1);
    expect(problemas[0]).toContain("SEND_SMS_HOOK_SECRET");
    expect(problemas[0]).toContain("2FA");
    expect(problemas[0]).toContain(`supabase secrets set --project-ref ${REF}`);
  });

  it("los lista todos cuando el entorno está sin aprovisionar", () => {
    // El estado real de producción al 18 ago 2026: ni uno cargado.
    const problemas = revisarSecretos({
      presentes: ["SUPABASE_DB_URL"],
      usados: [],
      projectRef: "ifkkbxjmrtslinzmzpqs",
    });

    expect(problemas).toHaveLength(TODOS.length);
  });

  it("exige clasificar un secreto nuevo que el código empiece a leer", () => {
    // La anti-deriva: sin esto, la lista de obligatorios envejece en silencio y
    // el siguiente secreto se vuelve a descubrir por casualidad.
    const problemas = revisarSecretos({
      presentes: TODOS,
      usados: ["TWILIO_AUTH_TOKEN"],
      projectRef: REF,
    });

    expect(problemas).toHaveLength(1);
    expect(problemas[0]).toContain("TWILIO_AUTH_TOKEN");
    expect(problemas[0]).toContain("Clasifícalo");
  });

  it("no se queja de los que ya están clasificados ni de los que inyecta Supabase", () => {
    expect(
      revisarSecretos({
        presentes: TODOS,
        usados: [
          "RESEND_API_KEY",
          "OTP_DRY_RUN",
          "SUPABASE_URL",
          "SUPABASE_SERVICE_ROLE_KEY",
          "ALERTA_WEBHOOK_SECRET",
        ],
        projectRef: REF,
      }),
    ).toEqual([]);
  });
});

describe("secretosUsadosEnElCodigo", () => {
  it("encuentra los que las Edge Functions leen de verdad", () => {
    // Contra el árbol real: si alguien añade un `Deno.env.get` nuevo, este test
    // no falla, pero `revisarSecretos` sí lo exigirá clasificar.
    const usados = secretosUsadosEnElCodigo();

    expect(usados).toContain("SEND_SMS_HOOK_SECRET");
    expect(usados).toContain("ALERTA_WEBHOOK_SECRET");
    expect(usados).toContain("FOTO_VERIFICACION_SECRET");
    expect(usados).toContain("PASE_HASH_SECRET");
  });

  it("NO ve las R2_*, que se leen con toObject: por eso van declaradas a mano", () => {
    // Fija la limitación conocida en vez de dejarla solo en un comentario. Si
    // algún día `leerConfigR2` pasara a `Deno.env.get`, este test avisa de que
    // el escáner ya las cubre y la declaración a mano puede revisarse.
    const usados = secretosUsadosEnElCodigo();

    expect(usados).not.toContain("R2_ACCOUNT_ID");
    expect(usados).not.toContain("R2_BUCKET");
  });

  it("todo lo que el código lee está clasificado", () => {
    // El test que mantiene honesta la lista: si entra un secreto nuevo sin
    // clasificar, esto se pone rojo en CI antes de llegar a un despliegue.
    expect(
      revisarSecretos({
        presentes: Object.keys(OBLIGATORIOS),
        usados: secretosUsadosEnElCodigo(),
        projectRef: REF,
      }),
    ).toEqual([]);
  });
});

describe("leerSecretos", () => {
  it("saca los nombres de la salida envuelta del CLI", () => {
    expect(leerSecretos(respuesta(["A", "B"]))).toEqual(["A", "B"]);
  });

  it("saca los nombres del array pelado que devuelve `-o json`", () => {
    // Las dos formas son reales: `-o json` da un array, la salida por defecto lo
    // envuelve. Asumir solo una puso rojo el primer intento contra staging.
    const pelado = JSON.stringify([
      { name: "A", value: "d1ge5t", updated_at: "2026-08-18T00:00:00Z" },
      { name: "B", value: "d1ge5t", updated_at: "2026-08-18T00:00:00Z" },
    ]);

    expect(leerSecretos(pelado)).toEqual(["A", "B"]);
  });

  it("lanza si no llegó nada", () => {
    expect(() => leerSecretos("  ")).toThrow(/no devolvió nada/);
  });

  it("lanza si la salida no es JSON, y enseña lo que llegó", () => {
    expect(() => leerSecretos("failed to connect")).toThrow(/no es JSON/);
    expect(() => leerSecretos("failed to connect")).toThrow(
      /failed to connect/,
    );
  });

  it("lanza si la forma no es la esperada", () => {
    expect(() => leerSecretos(JSON.stringify({ otra: 1 }))).toThrow(
      /no es ni una lista/,
    );
    expect(() => leerSecretos(JSON.stringify({ secrets: [{ x: 1 }] }))).toThrow(
      /`name`/,
    );
  });
});

describe("resumirPayload", () => {
  it("tacha el digest de cada secreto antes de que llegue al log", () => {
    // `secrets list` trae un `value` por secreto que es su digest SHA-256. No es
    // reversible con un secreto de alta entropía, pero tampoco hay motivo para
    // publicarlo en el log de un runner.
    const crudo = JSON.stringify([
      { name: "PASE_HASH_SECRET", value: "f2ddcee9dc892bae", updated_at: "x" },
    ]);
    const salida = resumirPayload(crudo);

    expect(salida).not.toContain("f2ddcee9dc892bae");
    expect(salida).toContain("PASE_HASH_SECRET");
    expect(salida).toContain("digest tachado");
  });

  it("recorta lo largo en vez de volcar el log entero", () => {
    expect(resumirPayload("x".repeat(2000)).length).toBeLessThan(450);
  });
});
