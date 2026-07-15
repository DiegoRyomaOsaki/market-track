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
