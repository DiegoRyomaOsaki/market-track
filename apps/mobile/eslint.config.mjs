import js from "@eslint/js";
import globals from "globals";
import tseslint from "typescript-eslint";

// Config propia del workspace: la raíz ignora `apps/**` a propósito. Misma base
// que la web —`recommendedTypeChecked` con project service— pero con los globals
// de React Native (no hay DOM: el móvil no tiene `window` ni `document`).
export default tseslint.config(
  {
    ignores: ["**/.expo/**", "**/android/**", "**/ios/**", "expo-env.d.ts"],
  },
  js.configs.recommended,
  tseslint.configs.recommendedTypeChecked,
  {
    languageOptions: {
      globals: { ...globals.node, ...globals.jest, __DEV__: "readonly" },
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
        },
      ],
    },
  },
);
