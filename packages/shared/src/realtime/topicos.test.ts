import { describe, expect, it } from "vitest";

import { FEEDS_EN_VIVO, topicoStaff, topicoTenant } from "./topicos";

// Estas cadenas son un CONTRATO con la base: las políticas de
// `realtime.messages` comparan el topic con el que construye
// `app.topico_tenant()` / `app.topico_staff()`. Si aquí se cambia el formato y
// allí no, el join al canal se rechaza y el feed se queda mudo — un fallo que
// solo se ve en runtime. El gemelo de este test vive en
// `packages/db/test/realtime.db.test.ts` y compara contra la base real.

const TENANT = "aaaaaaaa-0000-0000-0000-000000000001";

describe("topicos de los feeds en vivo", () => {
  it("el canal del cliente lleva el tenant en el nombre", () => {
    expect(topicoTenant(TENANT, "alerta")).toBe(
      "tenant:aaaaaaaa-0000-0000-0000-000000000001:alerta",
    );
  });

  it("el canal del staff no lleva tenant: ve todos los clientes", () => {
    expect(topicoStaff("visita")).toBe("staff:visita");
  });

  it("los feeds en vivo son alerta y visita", () => {
    expect(FEEDS_EN_VIVO).toEqual(["alerta", "visita"]);
  });
});
