import { defineConfig } from "vitest/config";
import pkg from "./package.json" with { type: "json" };

// pure-Python wheels served from public/wheels (#40); the FElupe version must match
// FELUPE_VERSION in .github/workflows/ci.yml
const WHEELS = Object.entries(pkg.config.wheels).map(
  ([name, { version }]) => `wheels/${name}-${version}-py3-none-any.whl`,
);
const FELUPE_VERSION = pkg.config.wheels.felupe.version;

// the build, e.g. the commit on GitHub Pages; written to version.json, so that an
// open app finds out about a newer deployment
const BUILD_ID =
  process.env.GITHUB_SHA?.slice(0, 12) ?? new Date().toISOString();

export default defineConfig({
  // Relative base: works on GitHub Pages below /felupe-studio/ and locally
  base: "./",
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
    __PYODIDE_VERSION__: JSON.stringify(pkg.devDependencies.pyodide),
    __FELUPE_VERSION__: JSON.stringify(FELUPE_VERSION),
    __WHEELS__: JSON.stringify(WHEELS),
    __BUILD_ID__: JSON.stringify(BUILD_ID),
  },
  plugins: [
    {
      name: "version-file",
      apply: "build",
      generateBundle() {
        this.emitFile({
          type: "asset",
          fileName: "version.json",
          source: JSON.stringify({ build: BUILD_ID }) + "\n",
        });
      },
    },
  ],
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
