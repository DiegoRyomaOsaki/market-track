import type { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { cargarConfig, conectar, TENANTS } from "./ayudas";

// El trigger `notificar_alerta_email` encola una llamada HTTP (pg_net) a la Edge
// Function SOLO para los tipos que van por email, y NUNCA debe romper el INSERT
// de la alerta (es el camino de sync del mercaderista). Se prueba mirando la cola
// interna de pg_net, `net.http_request_queue`, dentro de una transacción que
// revierte (la petición encolada se descarta con el rollback; nunca sale de red).

let db: Client;

beforeAll(async () => {
  db = await conectar();
});

afterAll(async () => {
  await db.end();
});

async function encoladas(c: Client): Promise<number> {
  const r = await c.query<{ n: string }>(
    "select count(*)::text as n from net.http_request_queue where url like '%enviar-alerta-email%'",
  );
  return Number(r.rows[0]?.n ?? "0");
}

describe("webhook de email de alertas (trigger pg_net)", () => {
  it("encola solo para los tipos relevantes (quiebre/desviacion_precio), no para el resto", async () => {
    await db.query("begin");
    try {
      // Con la URL configurada, el trigger sí encola.
      await cargarConfig(
        db,
        "functions_url",
        "http://localhost:9999/functions/v1",
      );
      const antes = await encoladas(db);

      await db.query(
        "insert into public.alerta (tenant_id, tipo, severidad) values ($1, 'quiebre', 'alta')",
        [TENANTS.maracumango],
      );
      await db.query(
        "insert into public.alerta (tenant_id, tipo, severidad) values ($1, 'desviacion_precio', 'alta')",
        [TENANTS.maracumango],
      );
      // Estos NO van por email: no deben encolar nada.
      await db.query(
        "insert into public.alerta (tenant_id, tipo, severidad) values ($1, 'diferencia_stock', 'info')",
        [TENANTS.maracumango],
      );
      await db.query(
        "insert into public.alerta (tenant_id, tipo, severidad) values ($1, 'contingencia', 'alta')",
        [TENANTS.maracumango],
      );

      expect(await encoladas(db)).toBe(antes + 2);
    } finally {
      await db.query("rollback");
    }
  });

  it("sin la URL configurada, el trigger es no-op y el INSERT no se rompe", async () => {
    await db.query("begin");
    try {
      // Sin cargar nada en el vault: functions_url es NULL → no encola nada.
      const antes = await encoladas(db);
      const r = await db.query<{ id: string }>(
        "insert into public.alerta (tenant_id, tipo, severidad) values ($1, 'quiebre', 'alta') returning id",
        [TENANTS.maracumango],
      );
      // El INSERT devuelve su fila (no lanzó) y no se encoló ninguna petición.
      expect(r.rows[0]?.id).toBeTruthy();
      expect(await encoladas(db)).toBe(antes);
    } finally {
      await db.query("rollback");
    }
  });
});
