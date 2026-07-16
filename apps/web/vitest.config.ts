import { fileURLToPath } from "node:url";

import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

// Primer workspace con jsdom. `passWithNoTests` se queda en su default (false):
// si alguien borra el último test, la suite sale en rojo en vez de fingir verde.
export default defineConfig({
  plugins: [react()],
  // El alias `@/` del tsconfig también aquí, o un test que importe un módulo con
  // `@/...` (transitivamente) no resuelve.
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  test: {
    environment: "jsdom",
    setupFiles: ["./vitest.setup.ts"],
  },
});
