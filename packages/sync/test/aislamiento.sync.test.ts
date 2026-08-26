import { Client } from "pg";
import { beforeAll, describe, expect, it } from "vitest";

import {
  conTenantDesactivado,
  conTrabajoDeCompanero,
  filasReplicadas,
  replicarCon,
  sesionAal1,
  sesionAal2,
  conPuntajeDeCompanero,
  conRetiroDeCompanero,
  PG,
  PUNTAJE_COMPANERO,
  RETIRO,
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
  // El plan de lealtad entra en esta lista a propósito: el gate `aal2` vive en
  // el CTE `mi_tenant`, y si alguien sacara esta query a un stream nuevo sin ese
  // gate, una sesión sin segundo factor bajaría el puntaje y nadie se enteraría
  // — la RLS no interviene en la bajada.
  "puntaje_merchandiser",
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

  // -------------------------------------------------------------------------
  // El plan de lealtad — criterio explícito del ticket
  //
  // "que tú veas tu puntaje y tu posición, tú solo" (Martin, 3 ago 2026). La
  // decisión NO la puede cumplir la RLS: PowerSync replica con BYPASSRLS, así
  // que un test de RLS aquí da un falso verde. Esto conecta un cliente real.
  // -------------------------------------------------------------------------
  it("un mercaderista NO replica el puntaje de un compañero del mismo cliente", async () => {
    await conPuntajeDeCompanero(async () => {
      const sesion = await sesionAal2(USUARIOS.joseMaracumango.email);
      const filas = await filasReplicadas<{
        mercaderista_id: string;
        periodo_inicio: string;
      }>(sesion, "puntaje_merchandiser", "mercaderista_id, periodo_inicio");

      // Control POSITIVO: sin él, "no bajó nada ajeno" es trivialmente cierto
      // cuando la regla está rota y no baja nada (el seed no trae puntajes).
      expect(filas.length).toBeGreaterThan(0);
      // Y ni una del compañero, que es del MISMO cliente: el filtro por tenant
      // no lo distingue, solo el acotado por `auth.user_id()`.
      expect(
        filas.filter((f) => f.mercaderista_id === PUNTAJE_COMPANERO.companero),
      ).toEqual([]);
      expect(
        filas.every((f) => f.mercaderista_id === USUARIOS.joseMaracumango.id),
      ).toBe(true);
    });
  }, 90000);

  it("los dos periodos propios bajan como DOS filas — la evolución no colapsa", async () => {
    // `puntaje_merchandiser` tiene clave compuesta y PowerSync identifica cada
    // fila por `id`. Si el `id` sustituto no viajara, todos los periodos de una
    // persona se pisarían en una sola fila local y la evolución desaparecería
    // sin un solo error.
    await conPuntajeDeCompanero(async () => {
      const sesion = await sesionAal2(USUARIOS.joseMaracumango.email);
      const filas = await filasReplicadas<{ periodo_inicio: string }>(
        sesion,
        "puntaje_merchandiser",
        "periodo_inicio",
      );

      const periodos = new Set(filas.map((f) => f.periodo_inicio));
      expect(periodos.has(PUNTAJE_COMPANERO.periodoAnterior)).toBe(true);
      expect(periodos.has(PUNTAJE_COMPANERO.periodoActual)).toBe(true);
    });
  }, 90000);

  it("la posición viaja GUARDADA: el teléfono no la podría calcular", async () => {
    // Con una sola fila no hay rango que calcular. Si estas columnas no
    // bajaran, la pantalla no tendría qué enseñar — y recalcularla en el móvil
    // dejaría al panel diciendo "2.º" y al teléfono "3.º".
    await conPuntajeDeCompanero(async () => {
      const sesion = await sesionAal2(USUARIOS.joseMaracumango.email);
      const filas = await filasReplicadas<{
        periodo_inicio: string;
        posicion: number | null;
        mercaderistas_evaluados: number | null;
      }>(
        sesion,
        "puntaje_merchandiser",
        "periodo_inicio, posicion, mercaderistas_evaluados",
      );

      const actual = filas.find(
        (f) => f.periodo_inicio === PUNTAJE_COMPANERO.periodoActual,
      );
      // 91,5 contra los 74 del compañero: primero de dos evaluados.
      expect(actual?.posicion).toBe(1);
      expect(actual?.mercaderistas_evaluados).toBe(2);
    });
  }, 90000);

  it("el Perfect Store que baja es solo el de SUS levantamientos", async () => {
    // Es lo que deja a "Mi día" decir "la última vez esta tienda quedó en 78".
    // El trigger solo puntúa levantamientos `completado`, así que la fila del
    // compañero se siembra a mano para que haya algo ajeno que excluir.
    await conTrabajoDeCompanero(async () => {
      const pg = new Client({ connectionString: PG });
      await pg.connect();
      try {
        const cfg = await pg.query<{ id: string }>(
          `select id from public.config_perfect_store
            where tenant_id = $1 limit 1`,
          [USUARIOS.joseMaracumango.tenant],
        );
        await pg.query(
          `insert into public.puntaje_perfect_store
             (levantamiento_id, tenant_id, config_id, total_pct)
           values ($1, $2, $3, 66)
           on conflict (levantamiento_id) do update set total_pct = 66`,
          [
            TRABAJO_COMPANERO.levantamiento,
            USUARIOS.joseMaracumango.tenant,
            cfg.rows[0]!.id,
          ],
        );

        const sesion = await sesionAal2(USUARIOS.joseMaracumango.email);
        const filas = await filasReplicadas<{ levantamiento_id: string }>(
          sesion,
          "puntaje_perfect_store",
          "levantamiento_id",
        );

        expect(
          filas.filter(
            (f) => f.levantamiento_id === TRABAJO_COMPANERO.levantamiento,
          ),
        ).toEqual([]);
      } finally {
        await pg.query(
          `delete from public.puntaje_perfect_store where levantamiento_id = $1`,
          [TRABAJO_COMPANERO.levantamiento],
        );
        await pg.end();
      }
    });
  }, 120000);

  it("el retiro que baja es SOLO el del propio mercaderista", async () => {
    // El compañero es del MISMO cliente: el filtro por tenant no lo distingue,
    // solo `auth.user_id()`. Con control positivo, porque «no bajó nada ajeno»
    // es trivialmente cierto si no baja nada.
    await conRetiroDeCompanero(async () => {
      const sesion = await sesionAal2(USUARIOS.joseMaracumango.email);
      const filas = await filasReplicadas<{ motivo: string }>(
        sesion,
        "rutero_parada_retirada",
        "motivo",
      );

      expect(filas.map((f) => f.motivo)).toContain(RETIRO.motivoPropio);
      expect(filas.map((f) => f.motivo)).not.toContain("ruta reasignada");
    });
  }, 60000);

  it("quién quitó la parada NO baja al teléfono", async () => {
    // La columna está declarada en el esquema del cliente y el stream no la
    // proyecta: llega nula. Fija la decisión como CONTRATO, no como intención —
    // enseñar el nombre exigiría replicar perfiles ajenos.
    await conRetiroDeCompanero(async () => {
      const sesion = await sesionAal2(USUARIOS.joseMaracumango.email);
      const filas = await filasReplicadas<{ retirada_por: string | null }>(
        sesion,
        "rutero_parada_retirada",
        "retirada_por",
      );

      expect(filas.length).toBeGreaterThan(0);
      expect(filas.every((f) => f.retirada_por === null)).toBe(true);
    });
  }, 60000);

  it("el retiro de un rutero en BORRADOR no baja", async () => {
    // Una parada quitada de un borrador NUNCA estuvo en este teléfono:
    // anunciar su pérdida sería inventarla.
    await conRetiroDeCompanero(async () => {
      const sesion = await sesionAal2(USUARIOS.joseMaracumango.email);
      const filas = await filasReplicadas<{ motivo: string }>(
        sesion,
        "rutero_parada_retirada",
        "motivo",
      );

      expect(filas.map((f) => f.motivo)).toContain(RETIRO.motivoPropio);
      expect(filas.map((f) => f.motivo)).not.toContain(
        "planeacion a medio hacer",
      );
    });
  }, 60000);
});
