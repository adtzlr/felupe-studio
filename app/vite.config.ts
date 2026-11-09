import { defineConfig } from "vitest/config";
import pkg from "./package.json" with { type: "json" };

// FElupe version installed in the browser, keep in sync with FELUPE_VERSION in CI
const FELUPE_VERSION = "12.0.0";

export default defineConfig({
  // Relative base: works on GitHub Pages below /felupe-studio/ and locally
  base: "./",
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
    __PYODIDE_VERSION__: JSON.stringify(pkg.devDependencies.pyodide),
    __FELUPE_VERSION__: JSON.stringify(FELUPE_VERSION),
  },
  build: {
    rollupOptions: {
      input: {
        main: "index.html",
        spike: "spike.html",
      },
    },
  },
  worker: {
    format: "es",
  },
  server: {
    // the worker imports Python sources from ../python
    fs: { allow: [".."] },
  },
  test: {
    environment: "node",
  },
});
