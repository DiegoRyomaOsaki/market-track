import type { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  comoUsuario,
  conectar,
  contarFilas,
  TENANTS,
  USUARIOS,
} from "./ayudas";

// La categoría de producto y su FK compuesta.
//
// Lo que sostiene el aislamiento aquí no es la RLS —el admin ve todos los
// clientes a propósito— sino `sku_categoria_fk (categoria_id, tenant_id)`. Con
// una FK sobre `categoria_id` a secas, un SKU podría colgar de la categoría de
// otro cliente y el puntaje de Perfect Store se agruparía cruzado.

const IDS = {
  categoriaMrc: "a0000004-0000-0000-0000-000000000001",
  categoriaRival: "b0000004-0000-0000-0000-000000000002",
  skuMrc: "a0000003-0000-0000-0000-000000000001",
  skuRival: "b0000003-0000-0000-0000-000000000002",
  marcaMrc: "cccccccc-0000-0000-0000-000000000001",
} as const;

let client: Client;

beforeAll(async () => {
  client = await conectar();
});

afterAll(async () => {
  await client.end();
});

async function codigoDeError(
  c: Client,
  sql: string,
  valores: unknown[],
): Promise<string | null> {
  try {
    await c.query(sql, valores);
    return null;
  } catch (err) {
    return (err as { code?: string }).code ?? "sin-codigo";
  }
}

describe("un SKU solo apunta a una categoría de SU cliente", () => {
  it("apuntar a la categoría de otro cliente se RECHAZA", async () => {
    // El criterio de aceptación del ticket. Lo impide la FK compuesta, no la
    // RLS: el admin puede leer y escribir en los dos clientes.
    await comoUsuario(client, USUARIOS.admin, async (c) => {
      expect(
        await codigoDeError(
          c,
          "update public.sku set categoria_id = $1 where id = $2",
          [IDS.categoriaRival, IDS.skuMrc],
        ),
      ).toBe("23503");
    });
  });

  it("apuntar a una categoría propia se acepta", async () => {
    await comoUsuario(client, USUARIOS.admin, async (c) => {
      expect(
        await codigoDeError(
          c,
          "update public.sku set categoria_id = $1 where id = $2",
          [IDS.categoriaMrc, IDS.skuMrc],
        ),
      ).toBeNull();
    });
  });

  it("un SKU SIN categoría es válido: el maestro se carga poco a poco", async () => {
    // Es lo que hace aditivo el despliegue. Si esto fallara, la migración
    // obligaría a cargar todas las categorías antes de poder trabajar.
    await comoUsuario(client, USUARIOS.admin, async (c) => {
      expect(
        await codigoDeError(
          c,
          "update public.sku set categoria_id = null where id = $1",
          [IDS.skuMrc],
        ),
      ).toBeNull();

      const r = await c.query<{ n: string }>(
        "select count(*)::text as n from public.sku where categoria_id is null",
      );
      expect(Number(r.rows[0]?.n)).toBeGreaterThan(0);
    });
  });

  it("una categoría en uso no se puede borrar en duro", async () => {
    // `on delete restrict`: borrarla dejaría SKUs apuntando al vacío. Las bajas
    // son lógicas (`activo`), como en el resto del catálogo.
    await comoUsuario(client, USUARIOS.admin, async (c) => {
      expect(
        await codigoDeError(c, "delete from public.categoria where id = $1", [
          IDS.categoriaMrc,
        ]),
      ).not.toBeNull();
    });
  });
});

describe("quién ve y quién escribe las categorías", () => {
  it("el cliente-marca ve SOLO las suyas", async () => {
    await comoUsuario(client, USUARIOS.clienteMaracumango, async (c) => {
      expect(await contarFilas(c, "categoria")).toBe(1);
      const r = await c.query<{ tenant_id: string }>(
        "select tenant_id from public.categoria",
      );
      expect(r.rows[0]?.tenant_id).toBe(TENANTS.maracumango);
    });
  });

  it("el staff las ve todas: no pertenece a ningún cliente", async () => {
    await comoUsuario(client, USUARIOS.admin, async (c) => {
      expect(await contarFilas(c, "categoria")).toBe(2);
    });
  });

  it("el cliente-marca NO escribe el maestro", async () => {
    await comoUsuario(client, USUARIOS.clienteMaracumango, async (c) => {
      expect(
        await codigoDeError(
          c,
          "insert into public.categoria (tenant_id, nombre) values ($1, $2)",
          [TENANTS.maracumango, "Inventada"],
        ),
      ).toBe("42501");
    });
  });

  it("el supervisor tampoco: la política exige admin, no staff", async () => {
    await comoUsuario(client, USUARIOS.supervisor, async (c) => {
      expect(
        await codigoDeError(
          c,
          "insert into public.categoria (tenant_id, nombre) values ($1, $2)",
          [TENANTS.maracumango, "Inventada"],
        ),
      ).toBe("42501");
    });
  });

  it("el admin escribe en cualquier cliente", async () => {
    await comoUsuario(client, USUARIOS.admin, async (c) => {
      expect(
        await codigoDeError(
          c,
          "insert into public.categoria (tenant_id, nombre, codigo_externo) values ($1, $2, $3)",
          [TENANTS.rival, "Snacks", "SNK"],
        ),
      ).toBeNull();
    });
  });

  it("el mismo código externo dos veces en el mismo cliente se rechaza", async () => {
    // Es la clave natural del upsert del importador: sin ella, reimportar el
    // Excel duplicaría las categorías.
    await comoUsuario(client, USUARIOS.admin, async (c) => {
      expect(
        await codigoDeError(
          c,
          "insert into public.categoria (tenant_id, nombre, codigo_externo) values ($1, $2, $3)",
          [TENANTS.maracumango, "Otra", "BEB"],
        ),
      ).toBe("23505");
    });
  });

  it("el mismo código en OTRO cliente sí entra", async () => {
    await comoUsuario(client, USUARIOS.admin, async (c) => {
      expect(
        await codigoDeError(
          c,
          "insert into public.categoria (tenant_id, nombre, codigo_externo) values ($1, $2, $3)",
          [TENANTS.rival, "Bebidas", "BEB"],
        ),
      ).toBeNull();
    });
  });
});
