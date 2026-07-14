import js from "@eslint/js";
import globals from "globals";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: [
      "**/dist/**",
      "**/.next/**",
      "**/.expo/**",
      "**/.turbo/**",
      "**/coverage/**",
      // Esta config es SOLO para la raíz. Cada workspace trae la suya y turbo la
      // corre por separado. Sin estos dos ignores, `eslint .` desde la raíz
      // recorrería los workspaces con las reglas equivocadas: doble lint, y
      // errores de parseo en archivos como `next.config.mjs` o `metro.config.js`,
      // que no están en el tsconfig de su app y `projectService` no sabe resolver.
      "apps/**",
      "packages/**",
      // Las Edge Functions corren en Deno: usan especificadores `https:`/`npm:` y
      // el global `Deno`, irresolubles bajo `moduleResolution: bundler`. Deno trae
      // su propio `deno lint` / `deno check` — este ESLint no las toca.
      "supabase/functions/**",
    ],
  },
  js.configs.recommended,
  tseslint.configs.recommendedTypeChecked,
  {
    languageOptions: {
      // Los archivos de la raíz y de `scripts/` corren en Node: sin esto,
      // `no-undef` no conoce `console`, `process` ni `URL`.
      globals: globals.node,
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      "@typescript-eslint/consistent-type-imports": "error",
    },
  },
);
