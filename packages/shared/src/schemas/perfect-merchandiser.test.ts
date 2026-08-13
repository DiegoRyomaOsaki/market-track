import { describe, expect, it } from "vitest";

import {
  altaConfigMerchandiserSchema,
  publicarEscaleraBonoSchema,
} from "./perfect-merchandiser";

const TENANT = "aaaaaaaa-0000-0000-0000-000000000001";

const CONFIG = {
  tenant_id: TENANT,
  peso_puntualidad: 25,
  peso_asistencia: 30,
  peso_tiempo_efectivo: 0,
  peso_calidad: 25,
  peso_herramientas: 20,
  tolerancia_puntualidad_min: 15,
  minutos_tardanza_cero: 60,
  dias_gracia_cierre: 7,
  vigente_desde: "2026-09-01",
};

describe("altaConfigMerchandiserSchema", () => {
  it("acepta una configuración completa", () => {
    expect(altaConfigMerchandiserSchema.safeParse(CONFIG).success).toBe(true);
  });

  it("rechaza unos pesos que no suman 100", () => {
    const r = altaConfigMerchandiserSchema.safeParse({
      ...CONFIG,
      peso_herramientas: 10,
    });
    expect(r.success).toBe(false);
  });

  it("acepta decimales que suman 100 en centésimas exactas", () => {
    // En JavaScript 28.94 + 35.1 + 16.59 + 19.37 da 100.00000000000001, así que
    // un `=== 100` los rechazaría — y la base, con aritmética exacta, los acepta.
    // La frontera no puede ser más estricta que lo que se guarda.
    const r = altaConfigMerchandiserSchema.safeParse({
      ...CONFIG,
      peso_puntualidad: 28.94,
      peso_asistencia: 35.1,
      peso_calidad: 16.59,
      peso_herramientas: 19.37,
    });
    expect(r.success).toBe(true);
  });

  it("sigue rechazando unos decimales que de verdad no suman 100", () => {
    const r = altaConfigMerchandiserSchema.safeParse({
      ...CONFIG,
      peso_puntualidad: 28.94,
      peso_asistencia: 35.1,
      peso_calidad: 16.59,
      peso_herramientas: 19.38,
    });
    expect(r.success).toBe(false);
  });

  it("rechaza darle peso al tiempo efectivo de atención", () => {
    // La variable no tiene fórmula acordada. Con un peso libre, la
    // renormalización lo repartiría entre las otras cuatro en silencio y los
    // pesos efectivos no serían los que el admin ve en pantalla.
    const r = altaConfigMerchandiserSchema.safeParse({
      ...CONFIG,
      peso_tiempo_efectivo: 20,
      peso_herramientas: 0,
    });
    expect(r.success).toBe(false);
    expect(JSON.stringify(r.error?.issues)).toContain("todavía no se puntúa");
  });

  it("exige que la rampa de tardanza empiece después de la tolerancia", () => {
    const r = altaConfigMerchandiserSchema.safeParse({
      ...CONFIG,
      tolerancia_puntualidad_min: 30,
      minutos_tardanza_cero: 20,
    });
    expect(r.success).toBe(false);
  });

  it("rechaza una tolerancia negativa o con decimales", () => {
    expect(
      altaConfigMerchandiserSchema.safeParse({
        ...CONFIG,
        tolerancia_puntualidad_min: -1,
      }).success,
    ).toBe(false);
    expect(
      altaConfigMerchandiserSchema.safeParse({
        ...CONFIG,
        tolerancia_puntualidad_min: 7.5,
      }).success,
    ).toBe(false);
  });

  it("rechaza días de gracia negativos", () => {
    expect(
      altaConfigMerchandiserSchema.safeParse({
        ...CONFIG,
        dias_gracia_cierre: -1,
      }).success,
    ).toBe(false);
  });

  it("un campo AUSENTE se rechaza, igual que uno inválido", () => {
    // Ausente y vacío son caminos distintos: un formulario que no envía la clave
    // no puede colarse por la puerta de atrás de un default.
    for (const campo of [
      "tenant_id",
      "peso_puntualidad",
      "peso_tiempo_efectivo",
      "tolerancia_puntualidad_min",
      "vigente_desde",
    ]) {
      const { [campo]: _, ...sinCampo } = CONFIG as Record<string, unknown>;
      expect(altaConfigMerchandiserSchema.safeParse(sinCampo).success).toBe(
        false,
      );
    }
  });

  it("acepta un id de seed: usa z.guid(), no z.uuid()", () => {
    // El estricto exige los bits de versión del RFC 9562 que Postgres no impone,
    // y rechazaría todos los ids del seed del proyecto.
    const r = altaConfigMerchandiserSchema.safeParse({
      ...CONFIG,
      tenant_id: "11111111-1111-1111-1111-111111111111",
    });
    expect(r.success).toBe(true);
  });
});

describe("publicarEscaleraBonoSchema", () => {
  const ESCALERA = {
    tenant_id: TENANT,
    vigente_desde: "2026-09-01",
    niveles: [
      { nombre: "Bronce", puntaje_min: 60, monto: 100 },
      { nombre: "Plata", puntaje_min: 80, monto: 250 },
    ],
  };

  it("acepta una escalera de varios peldaños", () => {
    expect(publicarEscaleraBonoSchema.safeParse(ESCALERA).success).toBe(true);
  });

  it("rechaza una escalera vacía: publicarla dejaría al cliente sin bonos", () => {
    expect(
      publicarEscaleraBonoSchema.safeParse({ ...ESCALERA, niveles: [] })
        .success,
    ).toBe(false);
  });

  it("rechaza dos niveles que empiecen en el mismo puntaje", () => {
    // Dos peldaños en el mismo umbral compiten, y cuál gana lo decidiría el
    // desempate de la consulta: una configuración ambigua en silencio.
    const r = publicarEscaleraBonoSchema.safeParse({
      ...ESCALERA,
      niveles: [
        { nombre: "Bronce", puntaje_min: 60, monto: 100 },
        { nombre: "Otro", puntaje_min: 60, monto: 300 },
      ],
    });
    expect(r.success).toBe(false);
  });

  it("rechaza un monto negativo y un puntaje fuera de 0-100", () => {
    expect(
      publicarEscaleraBonoSchema.safeParse({
        ...ESCALERA,
        niveles: [{ nombre: "X", puntaje_min: 60, monto: -1 }],
      }).success,
    ).toBe(false);
    expect(
      publicarEscaleraBonoSchema.safeParse({
        ...ESCALERA,
        niveles: [{ nombre: "X", puntaje_min: 101, monto: 10 }],
      }).success,
    ).toBe(false);
  });

  it("un peldaño al que le falta una clave se rechaza", () => {
    for (const campo of ["nombre", "puntaje_min", "monto"]) {
      const nivel: Record<string, unknown> = {
        nombre: "X",
        puntaje_min: 60,
        monto: 100,
      };
      delete nivel[campo];
      expect(
        publicarEscaleraBonoSchema.safeParse({
          ...ESCALERA,
          niveles: [nivel],
        }).success,
      ).toBe(false);
    }
  });

  it("rechaza un nivel sin nombre", () => {
    expect(
      publicarEscaleraBonoSchema.safeParse({
        ...ESCALERA,
        niveles: [{ nombre: "   ", puntaje_min: 60, monto: 100 }],
      }).success,
    ).toBe(false);
  });
});
