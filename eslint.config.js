import { defineConfig } from "eslint/config";
import js from "@eslint/js";
import tseslint from "typescript-eslint";
import unicorn from "eslint-plugin-unicorn";
import sonarjs from "eslint-plugin-sonarjs";
import prettier from "eslint-config-prettier";

export default defineConfig(
  {
    ignores: [
      "node_modules/",
      "drizzle/",
      "dist/",
      "tmp/",
      "playwright-report/",
      "test-results/",
      "coverage/",
      ".dependency-cruiser.cjs",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.strictTypeChecked,
  ...tseslint.configs.stylisticTypeChecked,
  unicorn.configs.recommended,
  sonarjs.configs.recommended,
  {
    languageOptions: {
      parserOptions: {
        projectService: {
          allowDefaultProject: ["*.js"],
        },
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      "unicorn/prefer-module": "off",
      "unicorn/prevent-abbreviations": "off",
      "unicorn/no-null": "off",
      "@typescript-eslint/consistent-type-imports": ["error", { prefer: "type-imports" }],
      "@typescript-eslint/no-misused-promises": ["error", { checksVoidReturn: false }],
    },
  },
  {
    // Entry points and CLI scripts may use process.exit and top-level patterns
    files: ["src/main.ts", "scripts/**/*.ts"],
    rules: {
      "unicorn/no-process-exit": "off",
      "unicorn/prefer-top-level-await": "off",
      "unicorn/require-module-specifiers": "off",
      "@typescript-eslint/use-unknown-in-catch-callback-variable": "off",
      "unicorn/catch-error-name": "off",
    },
  },
  prettier
);
