import { defineConfig } from "vitest/config";
import pkg from "./package.json" with { type: "json" };

// FElupe version installed in the browser (wheel from public/wheels, #40),
// keep in sync with FELUPE_VERSION in .github/workflows/ci.yml
const FELUPE_VERSION = pkg.config.felupe;

export default defineConfig({
  // Relative base: works on GitHub Pages below /felupe-studio/ and locally
  base: "./",
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
    __PYODIDE_VERSION__: JSON.stringify(pkg.devDependencies.pyodide),
    __FELUPE_VERSION__: JSON.stringify(FELUPE_VERSION),
    __FELUPE_WHEEL__: JSON.stringify(
      `wheels/felupe-${FELUPE_VERSION}-py3-none-any.whl`,
    ),
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
