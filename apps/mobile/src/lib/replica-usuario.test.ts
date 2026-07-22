import { describe, expect, it } from "@jest/globals";

import { debeLimpiarReplica } from "./replica-usuario";

describe("debeLimpiarReplica", () => {
  it("primera vez (sin dueño previo): no limpia", () => {
    // El teléfono no tenía réplica de nadie: no hay nada que filtrar.
    expect(debeLimpiarReplica(null, "user-a")).toBe(false);
  });

  it("mismo usuario que vuelve: conserva su trabajo offline", () => {
    expect(debeLimpiarReplica("user-a", "user-a")).toBe(false);
  });

  it("otro usuario en el mismo teléfono: limpia para no filtrar datos", () => {
    expect(debeLimpiarReplica("user-a", "user-b")).toBe(true);
  });
});
