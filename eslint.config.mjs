import js from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: [
      "**/dist/**",
      "**/.next/**",
      "**/.expo/**",
      "**/.turbo/**",
      "**/coverage/**",
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
