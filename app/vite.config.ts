import { defineConfig } from "vitest/config";
import pkg from "./package.json" with { type: "json" };
import { fileURLToPath } from "node:url";
import { brand, brandOptions, pageBrand } from "./src/vite/brand";
import { pyodide } from "./src/vite/pyodide";
import { samples } from "./src/vite/samples";

// pure-Python wheels served from public/wheels (#40); the FElupe version must match
// FELUPE_VERSION in .github/workflows/ci.yml
const wheel = (name: string, version: string) =>
  `wheels/${name}-${version}-py3-none-any.whl`;
type Wheel = { version: string; lazy?: boolean };
const entries = Object.entries(pkg.config.wheels as Record<string, Wheel>);
// loaded at startup, and loaded when needed (tensortrax for its material models)
const WHEELS = entries
  .filter(([, w]) => !w.lazy)
  .map(([name, w]) => wheel(name, w.version));
const LAZY_WHEELS = Object.fromEntries(
  entries
    .filter(([, w]) => w.lazy)
    .map(([name, w]) => [name, wheel(name, w.version)]),
);
const FELUPE_VERSION = pkg.config.wheels.felupe.version;

// the brand of the build (ADR 0020): BRAND_DIR, else app/brand (FElupe Studio)
const ROOT = fileURLToPath(new URL(".", import.meta.url));
const BRAND = brandOptions(process.env, ROOT);
const PYODIDE_VERSION = pkg.devDependencies.pyodide;

// the build, e.g. the commit on GitHub Pages; written to version.json, so that an
// open app finds out about a newer deployment
const BUILD_ID =
  process.env.GITHUB_SHA?.slice(0, 12) ?? new Date().toISOString();

export default defineConfig({
  // Relative base: works on GitHub Pages below /felupe-studio/ and locally
  base: "./",
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
    __PYODIDE_VERSION__: JSON.stringify(PYODIDE_VERSION),
    __FELUPE_VERSION__: JSON.stringify(FELUPE_VERSION),
    __WHEELS__: JSON.stringify(WHEELS),
    __LAZY_WHEELS__: JSON.stringify(LAZY_WHEELS),
    __BUILD_ID__: JSON.stringify(BUILD_ID),
    __BRAND__: JSON.stringify(pageBrand(BRAND.brand)),
  },
  plugins: [
    // the brand in the pages (ADR 0020), and its samples or SAMPLES_DIR (#350)
    brand(BRAND),
    samples(BRAND.samples),
    // Pyodide of the CDN, or copied into the build (ADR 0020)
    pyodide({
      source: BRAND.brand.pyodide ?? "cdn",
      version: PYODIDE_VERSION,
      dir: `${ROOT}node_modules/pyodide`,
      cache: `${ROOT}node_modules/.cache/pyodide`,
    }),
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
