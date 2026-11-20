import js from "@eslint/js";
import globals from "globals";
import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["dist", "dist-*", "node_modules", "src/vendor"] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: {
      globals: { ...globals.browser, ...globals.worker },
    },
  },
  // the complexity of a function (#313): above the limits, a function is split, or
  // explains in its eslint-disable comment why it is not
  {
    files: ["src/**/*.{ts,tsx}"],
    ignores: ["src/**/*.test.{ts,tsx}"],
    rules: {
      complexity: ["error", 20],
      "max-lines-per-function": [
        "error",
        { max: 150, skipBlankLines: true, skipComments: true },
      ],
    },
  },
  // the components and hooks of the UI as warnings with higher limits: their
  // callbacks and their markup count in them
  {
    files: ["src/ui/**/*.{ts,tsx}"],
    ignores: ["src/ui/**/*.test.{ts,tsx}"],
    rules: {
      complexity: ["warn", 30],
      "max-lines-per-function": [
        "warn",
        { max: 250, skipBlankLines: true, skipComments: true },
      ],
    },
  },
  {
    files: ["scripts/**/*.js"],
    languageOptions: { globals: globals.node },
  },
  {
    files: ["public/sw.js"],
    languageOptions: { globals: globals.serviceworker },
  },
);
