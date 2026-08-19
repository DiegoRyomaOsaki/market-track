// Tests del guardarraíl de secretos de las Edge Functions. Corren con
// `pnpm test:scripts` (Vitest desde la raíz) y en CI: sin red, sin nube.

import { describe, expect, it } from "vitest";

import {
  leerSecretos,
  OBLIGATORIOS,
  revisarSecretos,
  secretosUsadosEnElCodigo,
} from "./verificar-secretos-funciones.mjs";

const REF = "twtoqaqgziwryuaibktt";
const TODOS = Object.keys(OBLIGATORIOS);

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
