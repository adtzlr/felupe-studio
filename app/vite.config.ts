import { defineConfig } from "vitest/config";
import pkg from "./package.json" with { type: "json" };

// pure-Python wheels served from public/wheels (#40); the FElupe version must match
// FELUPE_VERSION in .github/workflows/ci.yml
const WHEELS = Object.entries(pkg.config.wheels).map(
  ([name, { version }]) => `wheels/${name}-${version}-py3-none-any.whl`,
);
const FELUPE_VERSION = pkg.config.wheels.felupe.version;

export default defineConfig({
  // Relative base: works on GitHub Pages below /felupe-studio/ and locally
  base: "./",
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
    __PYODIDE_VERSION__: JSON.stringify(pkg.devDependencies.pyodide),
    __FELUPE_VERSION__: JSON.stringify(FELUPE_VERSION),
    __WHEELS__: JSON.stringify(WHEELS),
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
