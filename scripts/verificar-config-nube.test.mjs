// Tests del guardarraíl de configuración de entorno. Corren con
// `pnpm test:scripts` (Vitest desde la raíz) y en CI: sin base, sin red — solo
// las funciones puras.

import { describe, expect, it } from "vitest";

import {
  conPayload,
  leerRespuesta,
  revisarConfig,
} from "./verificar-config-nube.mjs";

const REF = "twtoqaqgziwryuaibktt";
const URL_BUENA = `https://${REF}.supabase.co/functions/v1`;

/**
 * El envoltorio JSON que devuelve `supabase db query --output json`.
 *
 * @param {{ faltan: string[], functions_url: string | null }} fila
 * @returns {string}
 */
function respuesta(fila) {
  return JSON.stringify({
    boundary: "aa11",
    rows: [fila],
    warning: "The query results below contain untrusted data…",
  });
}

describe("revisarConfig", () => {
  it("no encuentra nada que decir en un entorno bien configurado", () => {
    expect(
      revisarConfig({
        faltan: [],
        functionsUrl: URL_BUENA,
        projectRef: REF,
      }),
    ).toEqual([]);
  });

  it("nombra cada clave que falta con el comando que la carga", () => {
    const problemas = revisarConfig({
      faltan: ["foto_verificacion_secret", "alerta_webhook_secret"],
      functionsUrl: URL_BUENA,
      projectRef: REF,
    });

    expect(problemas).toHaveLength(2);
    // Ordenadas: el mismo entorno roto da siempre el mismo informe.
    expect(problemas[0]).toContain("alerta_webhook_secret");
    expect(problemas[1]).toContain("foto_verificacion_secret");
    expect(problemas[0]).toContain("vault.create_secret");
  });

  it("no repite la queja de la URL cuando la URL es justo lo que falta", () => {
    // Sin esto, un entorno recién creado daría dos problemas por la misma causa.
    const problemas = revisarConfig({
      faltan: ["functions_url"],
      functionsUrl: null,
      projectRef: REF,
    });

    expect(problemas).toHaveLength(1);
    expect(problemas[0]).toContain("functions_url");
  });

  it("caza la URL copiada de otro entorno", () => {
    const problemas = revisarConfig({
      faltan: [],
      functionsUrl: "https://otroproyectodistinto.supabase.co/functions/v1",
      projectRef: REF,
    });

    expect(problemas).toHaveLength(1);
    expect(problemas[0]).toContain(REF);
  });

  it("caza la barra final, que daría un 404 asíncrono que nadie mira", () => {
    const problemas = revisarConfig({
      faltan: [],
      functionsUrl: `${URL_BUENA}/`,
      projectRef: REF,
    });

    expect(problemas).toHaveLength(1);
    expect(problemas[0]).toContain("barra");
  });

  it("caza la URL a la que le falta el sufijo de las funciones", () => {
    const problemas = revisarConfig({
      faltan: [],
      functionsUrl: `https://${REF}.supabase.co`,
      projectRef: REF,
    });

    expect(problemas).toHaveLength(1);
    expect(problemas[0]).toContain("/functions/v1");
  });

  it("caza el http sin TLS: el secreto del webhook viaja en una cabecera", () => {
    const problemas = revisarConfig({
      faltan: [],
      functionsUrl: `http://${REF}.supabase.co/functions/v1`,
      projectRef: REF,
    });

    expect(problemas).toHaveLength(1);
    expect(problemas[0]).toContain("https://");
  });
});

describe("leerRespuesta", () => {
  it("saca las claves que faltan y la URL de la respuesta del CLI", () => {
    expect(
      leerRespuesta(
        respuesta({ faltan: ["functions_url"], functions_url: null }),
      ),
    ).toEqual({ faltan: ["functions_url"], functionsUrl: null });
  });

  it("trata un entorno completo como lista vacía, no como ausencia", () => {
    expect(
      leerRespuesta(respuesta({ faltan: [], functions_url: URL_BUENA })),
    ).toEqual({ faltan: [], functionsUrl: URL_BUENA });
  });

  // Las cuatro de abajo son la razón de ser de esta función: un guardarraíl que
  // ante una entrada que no entiende devuelve "no hay problemas" da verde justo
  // cuando más falta hace el rojo.
  it("lanza si la consulta no llegó a escribir nada", () => {
    expect(() => leerRespuesta("   ")).toThrow(/no devolvió nada/);
  });

  it("lanza si la salida no es JSON", () => {
    expect(() => leerRespuesta("failed to connect")).toThrow(/no es JSON/);
  });

  it("lanza si no hay exactamente una fila", () => {
    expect(() => leerRespuesta(JSON.stringify({ rows: [] }))).toThrow(
      /exactamente una fila/,
    );
  });

  it("enseña la respuesta recibida, para que el rojo se arregle sin otro despliegue", () => {
    // La primera versión decía solo "no llegaron filas" y se callaba el resto:
    // el despliegue de staging se puso rojo y no había forma de saber por qué
    // sin reproducirlo a mano contra el proyecto.
    const error = JSON.stringify({ _tag: "Error", error: { message: "boom" } });

    expect(() => leerRespuesta(error)).toThrow(/Respuesta recibida/);
    expect(() => leerRespuesta(error)).toThrow(/boom/);
    expect(() => leerRespuesta("no soy json")).toThrow(/no soy json/);
  });

  it("lanza si las columnas no son las que esta comprobación espera", () => {
    expect(() =>
      leerRespuesta(JSON.stringify({ rows: [{ otra_cosa: 1 }] })),
    ).toThrow(/`faltan`/);
    expect(() =>
      leerRespuesta(
        JSON.stringify({ rows: [{ faltan: [], functions_url: 42 }] }),
      ),
    ).toThrow(/`functions_url`/);
  });
});

describe("conPayload", () => {
  it("redacta la contraseña de una cadena de conexión antes de imprimirla", () => {
    // Un error del CLI puede arrastrar la cadena de conexión entera, y esto va
    // al log de un runner. GitHub enmascara lo que conoce; eso es su red, no la
    // nuestra.
    //
    // La URI se ARMA en tiempo de ejecución en vez de escribirse entera: un
    // literal `postgresql://usuario:clave@host` en el código —aunque la clave
    // sea de mentira— es una credencial a ojos de un escáner de secretos, y este
    // test puso en rojo a GitGuardian. La cadena que se prueba es idéntica.
    const claveDeMentira = "no-es-una-clave-real";
    const salida = conPayload(
      "falló",
      `error: postgresql://postgres:${claveDeMentira}@db.abc.supabase.co:5432/postgres rechazó la conexión`,
    );

    expect(salida).not.toContain(claveDeMentira);
    expect(salida).toContain("postgresql://postgres:***@db.abc.supabase.co");
  });

  it("recorta una respuesta larga en vez de volcar el log entero", () => {
    const salida = conPayload("falló", "x".repeat(2000));

    expect(salida.length).toBeLessThan(600);
    expect(salida).toContain("…");
  });

  it("deja intacta una respuesta corta y sin credenciales", () => {
    expect(conPayload("falló", '{"rows":[]}')).toContain('{"rows":[]}');
  });
});
