// Where the app loads Pyodide from (#321, ADR 0020): from the CDN, or self-hosted
// next to the app, which the build of a brand with `pyodide: "self-hosted"` copies
// into `pyodide/v<version>/` (src/vite/pyodide.ts). The worker, the client and the
// build share these names.
import { currentBrand } from "./brand";

/** The packages of Pyodide that the worker loads; rich is a dependency of meshio. */
export const PACKAGES = ["numpy", "scipy", "rich"];

/** The folder of a Pyodide version on the CDN. */
export const cdnUrl = (version: string): string =>
  `https://cdn.jsdelivr.net/pyodide/v${version}/full/`;

/** The folder of a self-hosted Pyodide in the built app, relative to the app. */
export const PYODIDE_FOLDER = "pyodide";
export const selfHostedFolder = (version: string): string =>
  `${PYODIDE_FOLDER}/v${version}/`;

/** The URL of the folder of Pyodide (`indexURL`) of the brand of the app. */
export function pyodideUrl(
  version: string,
  base: string,
  source = currentBrand()?.pyodide ?? "cdn",
): string {
  return source === "self-hosted"
    ? new URL(selfHostedFolder(version), base).href
    : cdnUrl(version);
}
