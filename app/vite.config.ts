import { defineConfig } from "vitest/config";
import pkg from "./package.json" with { type: "json" };

// Relative base: works on GitHub Pages below /felupe-studio/ and locally
export default defineConfig({
  base: "./",
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
  test: {
    environment: "node",
  },
});
