import { CANALES_OTP, ESTADOS_PASE } from "@market-track/shared";
import { describe, expect, it } from "vitest";

import {
  canalesConCorreo,
  ESTILO_ESTADO_PASE,
  ETIQUETA_CANAL,
  ETIQUETA_ESTADO_PASE,
  sePuedeRevocar,
  sigueVigente,
  tiempoRestante,
} from "./acceso";

const AHORA = new Date("2026-08-07T15:00:00.000Z");

describe("las etiquetas y los tonos", () => {
  it("cubren todos los valores de los dos enums", () => {
    for (const c of CANALES_OTP) expect(ETIQUETA_CANAL[c]).toBeTruthy();
    for (const e of ESTADOS_PASE) {
      expect(ETIQUETA_ESTADO_PASE[e]).toBeTruthy();
      expect(ESTILO_ESTADO_PASE[e]).toBeTruthy();
    }
  });

  it("los tonos salen de los tokens del tema, no de un color crudo", () => {
    for (const clase of Object.values(ESTILO_ESTADO_PASE)) {
      expect(clase).not.toMatch(/#[0-9a-f]{3,}/i);
    }
  });
});

describe("canalesConCorreo", () => {
  it("añade el correo aunque no venga: es el único canal que entrega", () => {
    expect(canalesConCorreo(["sms"])).toEqual(["correo", "sms"]);
  });

  it("con la lista vacía deja el correo, nunca ninguno", () => {
    // Una plataforma sin canales cierra la puerta a todo el mundo.
    expect(canalesConCorreo([])).toEqual(["correo"]);
  });

  it("no duplica el correo si ya venía", () => {
    expect(canalesConCorreo(["correo", "correo", "sms"])).toEqual([
      "correo",
      "sms",
    ]);
  });

  it("el orden es estable: dos guardados iguales dan el mismo array", () => {
    expect(canalesConCorreo(["whatsapp", "sms", "correo"])).toEqual(
      canalesConCorreo(["sms", "correo", "whatsapp"]),
    );
  });
});

describe("tiempoRestante", () => {
  it("cuenta en mm:ss contra la hora de expiración", () => {
    expect(tiempoRestante("2026-08-07T15:14:30.000Z", AHORA)).toBe("14:30");
  });

  it("rellena con cero para que no baile el ancho", () => {
    expect(tiempoRestante("2026-08-07T15:00:09.000Z", AHORA)).toBe("00:09");
  });

  it("nunca cuenta en negativo: al pasarse es 00:00", () => {
    expect(tiempoRestante("2026-08-07T14:59:00.000Z", AHORA)).toBe("00:00");
  });

  it("una fecha ilegible no pinta «NaN:NaN» en la cara del operador", () => {
    expect(tiempoRestante("no soy una fecha", AHORA)).toBe("00:00");
  });
});

describe("sigueVigente", () => {
  it("es el reloj quien decide, no el estado que se pintó antes", () => {
    expect(sigueVigente("2026-08-07T15:00:01.000Z", AHORA)).toBe(true);
    expect(sigueVigente("2026-08-07T14:59:59.000Z", AHORA)).toBe(false);
  });
});

describe("sePuedeRevocar", () => {
  it("solo un pase vigente", () => {
    expect(sePuedeRevocar("vigente")).toBe(true);
  });

  it("ni usado, ni vencido, ni ya revocado", () => {
    // Revocar un pase usado diría que nunca se usó; uno vencido ya no da acceso.
    for (const estado of ["usado", "vencido", "revocado"] as const) {
      expect(sePuedeRevocar(estado)).toBe(false);
    }
  });
});
