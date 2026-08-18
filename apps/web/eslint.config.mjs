import js from "@eslint/js";
import globals from "globals";
import tseslint from "typescript-eslint";

// Config propia del workspace: la raíz ignora `apps/**` a propósito (sus reglas
// son de Node y romperían al parsear el código de React/Next). Misma base que la
// raíz —`recommendedTypeChecked` con project service— pero con globals de
// navegador + Node (los Server Components corren en Node; los Client, en el DOM).
export default tseslint.config(
  {
    ignores: ["**/.next/**", "next-env.d.ts"],
  },
  js.configs.recommended,
  tseslint.configs.recommendedTypeChecked,
  {
    languageOptions: {
      globals: { ...globals.browser, ...globals.node },
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      // `next/font/google` auto-hospeda la fuente, pero para lograrlo la DESCARGA
      // de `fonts.gstatic.com` en tiempo de build: `next build` deja de compilar
      // sin red, y el CI se pone rojo por algo ajeno al cambio. Pasó, y un rojo
      // que miente deja de mirarse. Las fuentes viven en `src/fuentes/` y se
      // cargan con `next/font/local`; el comentario que lo explica no falla en
      // CI, esta regla sí.
      "no-restricted-imports": [
        "error",
        {
          paths: [
            {
              name: "next/font/google",
              message:
                "Descarga la fuente en tiempo de build y rompe `next build` sin red. Usa `next/font/local` con los ficheros de `src/fuentes/` (ver su README).",
            },
          ],
        },
      ],
      "@typescript-eslint/consistent-type-imports": "error",
      "@typescript-eslint/no-unused-vars": [
        "error",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
          ignoreRestSiblings: true,
        },
      ],
    },
  },
);
