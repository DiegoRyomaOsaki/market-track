import { beforeAll, describe, expect, it } from "vitest";

import {
  conTenantDesactivado,
  conTrabajoDeCompanero,
  filasReplicadas,
  replicarCon,
  sesionAal1,
  sesionAal2,
  TRABAJO_COMPANERO,
  USUARIOS,
} from "./ayudas";

// La segunda superficie de seguridad del producto: lo que el móvil DESCARGA.
// No pasa por RLS (PowerSync replica con BYPASSRLS), así que se prueba aquí,
// conectando clientes reales y afirmando qué filas llegan.
//
// Prerrequisitos: `supabase start`, `supabase functions serve` y
// `pnpm --filter @market-track/sync sync:up`. Sin ellos el harness no corre.

const TABLAS = [
  "tienda",
  "sku",
  "cadena",
  "marca",
  "visita",
  "revision_visita",
  "foto",
] as const;

describe("aislamiento de las sync rules", () => {
  beforeAll(() => {
    if (!process.env.ANON_KEY) {
      throw new Error(
        "Falta ANON_KEY. Corre el harness con la anon key del Supabase local en el entorno.",
      );
    }
  });

  it("un mercaderista solo replica los datos de SU cliente", async () => {
    const sesion = await sesionAal2(USUARIOS.joseMaracumango.email);
    const tiendas = await filasReplicadas(sesion, "tienda");

    expect(tiendas.length).toBeGreaterThan(0); // sí baja algo
    // Y TODO es de su tenant: ni una fila del otro cliente.
    const ajenas = tiendas.filter(
      (t) => t.tenant_id !== USUARIOS.joseMaracumango.tenant,
    );
    expect(ajenas).toEqual([]);
  }, 60000);

  it("dos mercaderistas de clientes distintos no ven lo del otro", async () => {
    const jose = await sesionAal2(USUARIOS.joseMaracumango.email);
    const rival = await sesionAal2(USUARIOS.mercaRival.email);

    const tiendasJose = await filasReplicadas(jose, "tienda");
    const tiendasRival = await filasReplicadas(rival, "tienda");

    // Ninguna tienda de José aparece para el mercaderista Rival, ni al revés.
    for (const t of tiendasJose) {
      expect(t.tenant_id).toBe(USUARIOS.joseMaracumango.tenant);
    }
    for (const t of tiendasRival) {
      expect(t.tenant_id).toBe(USUARIOS.mercaRival.tenant);
    }
  }, 90000);

  it("una sesión aal1 (sin segundo factor) NO replica NADA — MAR-71", async () => {
    // El hallazgo de MAR-71: el gate aal2 vive en la RLS y no cubre la bajada.
    // La sync rule lo exige explícitamente (auth.parameter('aal') = 'aal2'), así
    // que sin completar el 2FA no debe bajar ni una fila.
    const sesion = await sesionAal1(USUARIOS.joseMaracumango.email);
    const conteo = await replicarCon(sesion, TABLAS);

    for (const t of TABLAS) {
      expect(conteo[t]).toBe(0);
    }
  }, 60000);

  it("un rutero en BORRADOR no baja al teléfono", async () => {
    // La planeación a medio hacer del supervisor —tiendas sin decidir, orden sin
    // cerrar— no tiene por qué estar en el bolsillo de nadie. Hasta MAR-50 la
    // regla no filtraba por estado y los borradores sí bajaban.
    const sesion = await sesionAal2(USUARIOS.joseMaracumango.email);
    const ruteros = await filasReplicadas<{ estado: string }>(
      sesion,
      "rutero",
      "estado",
    );

    expect(ruteros.length).toBeGreaterThan(0); // sí baja lo publicado
    expect(ruteros.filter((r) => r.estado === "borrador")).toEqual([]);
  }, 60000);

  it("las paradas que bajan son solo las de SUS ruteros", async () => {
    // La regla acotaba `rutero_parada` solo por tenant, así que cada
    // mercaderista se descargaba la planeación de todos sus compañeros.
    const sesion = await sesionAal2(USUARIOS.joseMaracumango.email);
    const [ruteros, paradas] = await Promise.all([
      filasReplicadas<{ id: string }>(sesion, "rutero", "id"),
      filasReplicadas<{ rutero_id: string }>(
        sesion,
        "rutero_parada",
        "rutero_id",
      ),
    ]);

    const suyos = new Set(ruteros.map((r) => r.id));
    expect(paradas.filter((p) => !suyos.has(p.rutero_id))).toEqual([]);
  }, 60000);

  it("la revisión que baja es solo la de SUS visitas", async () => {
    // Es lo que le dice al mercaderista que le rechazaron un reporte y por qué.
    // La RLS no interviene en la bajada: si la regla no acotara por visita propia,
    // cada teléfono se traería el control de calidad de todos sus compañeros.
    const sesion = await sesionAal2(USUARIOS.joseMaracumango.email);
    const [visitas, revisiones] = await Promise.all([
      filasReplicadas<{ id: string }>(sesion, "visita", "id"),
      filasReplicadas<{ visita_id: string }>(
        sesion,
        "revision_visita",
        "visita_id",
      ),
    ]);

    const suyas = new Set(visitas.map((v) => v.id));
    expect(revisiones.filter((r) => !suyas.has(r.visita_id))).toEqual([]);
  }, 60000);

  it("la metadata de fotos que baja es solo la de SUS visitas", async () => {
    const sesion = await sesionAal2(USUARIOS.joseMaracumango.email);
    const [visitas, fotos] = await Promise.all([
      filasReplicadas<{ id: string }>(sesion, "visita", "id"),
      filasReplicadas<{ visita_id: string }>(sesion, "foto", "visita_id"),
    ]);

    const suyas = new Set(visitas.map((v) => v.id));
    expect(fotos.filter((f) => !suyas.has(f.visita_id))).toEqual([]);
  }, 60000);

  it("el levantamiento y lo que cuelga de él bajan solo para SUS visitas", async () => {
    // Estos cinco streams filtraban solo por tenant: cada teléfono replicaba el
    // historial de levantamientos de TODOS sus compañeros —incluido lo que cada
    // uno contesta en el formulario— y eso sobrevive al robo del dispositivo.
    await conTrabajoDeCompanero(async () => {
      const sesion = await sesionAal2(USUARIOS.joseMaracumango.email);
      const T = TRABAJO_COMPANERO;
      const [visitas, levs, skus, respuestas, exhibiciones, contingencias] =
        await Promise.all([
          filasReplicadas<{ id: string }>(sesion, "visita", "id"),
          filasReplicadas<{ id: string; visita_id: string }>(
            sesion,
            "levantamiento",
            "id, visita_id",
          ),
          filasReplicadas<{ id: string; levantamiento_id: string }>(
            sesion,
            "levantamiento_sku",
            "id, levantamiento_id",
          ),
          filasReplicadas<{ id: string; levantamiento_id: string }>(
            sesion,
            "levantamiento_respuesta",
            "id, levantamiento_id",
          ),
          filasReplicadas<{ id: string; levantamiento_id: string }>(
            sesion,
            "exhibicion",
            "id, levantamiento_id",
          ),
          filasReplicadas<{ id: string; visita_id: string }>(
            sesion,
            "contingencia",
            "id, visita_id",
          ),
        ]);

      // Control positivo: lo sembrado YA llegó a la réplica (lo propio sí baja).
      // Sin esto, un retraso de replicación daría el verde con la regla rota.
      expect(respuestas.map((r) => r.id)).toContain(T.respuestaPropiaDeJose);
      expect(levs.length).toBeGreaterThan(0);

      // Nada del compañero, en ninguna de las cinco tablas.
      expect(visitas.map((v) => v.id)).not.toContain(T.visita);
      expect(levs.map((l) => l.id)).not.toContain(T.levantamiento);
      expect(skus.map((s) => s.id)).not.toContain(T.levantamientoSku);
      expect(respuestas.map((r) => r.id)).not.toContain(T.respuesta);
      expect(exhibiciones.map((e) => e.id)).not.toContain(T.exhibicion);
      expect(contingencias.map((c) => c.id)).not.toContain(T.contingencia);

      // Y lo que sí baja cuelga, sin excepción, de una visita propia.
      const suyas = new Set(visitas.map((v) => v.id));
      expect(levs.filter((l) => !suyas.has(l.visita_id))).toEqual([]);
      expect(contingencias.filter((c) => !suyas.has(c.visita_id))).toEqual([]);
      const suyos = new Set(levs.map((l) => l.id));
      expect(skus.filter((x) => !suyos.has(x.levantamiento_id))).toEqual([]);
      expect(respuestas.filter((x) => !suyos.has(x.levantamiento_id))).toEqual(
        [],
      );
      expect(
        exhibiciones.filter((x) => !suyos.has(x.levantamiento_id)),
      ).toEqual([]);
    });
  }, 180000);

  it("un excliente deja de replicar en cuanto se desactiva su cliente", async () => {
    // El acceso es DERIVADO: el CTE mi_tenant exige t.activo = true. Al apagar el
    // cliente, deja de devolver tenant y no baja nada.
    const sesion = await sesionAal2(USUARIOS.joseMaracumango.email);

    // Con el cliente activo, sí replica.
    const antes = await replicarCon(sesion, ["tienda"]);
    expect(antes.tienda).toBeGreaterThan(0);

    // Apagado el cliente, una sesión NUEVA no recibe nada.
    await conTenantDesactivado(USUARIOS.joseMaracumango.tenant, async () => {
      const sesion2 = await sesionAal2(USUARIOS.joseMaracumango.email);
      const durante = await replicarCon(sesion2, ["tienda"]);
      expect(durante.tienda).toBe(0);
    });
  }, 120000);
});
