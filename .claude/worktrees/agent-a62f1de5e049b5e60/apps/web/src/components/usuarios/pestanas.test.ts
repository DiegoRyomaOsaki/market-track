import { describe, expect, it } from "vitest";

import { esTab, TABS } from "./pestanas";

describe("esTab", () => {
  it("acepta cada tab válida", () => {
    for (const t of TABS) {
      expect(esTab(t.key)).toBe(true);
    }
  });

  it("rechaza undefined, vacío y valores arbitrarios", () => {
    // Gobierna el ?tab= (input no confiable): un valor inválido debe caer al
    // default, no colarse.
    expect(esTab(undefined)).toBe(false);
    expect(esTab("")).toBe(false);
    expect(esTab("admin")).toBe(false);
    expect(esTab("mercaderista")).toBe(false); // el rol, no la key de tab
  });
});
