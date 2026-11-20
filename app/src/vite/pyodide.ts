// A self-hosted Pyodide (#321, ADR 0020): with `pyodide: "self-hosted"` in brand.json,
// the build copies Pyodide into `pyodide/v<version>/` of the app (src/pyodide.ts):
//
// - the core of the npm package `pyodide`, which package.json pins;
// - the packages that the worker loads (PACKAGES) and their dependencies in
//   pyodide-lock.json, downloaded from the CDN into a cache folder once and checked
//   against the SHA-256 of the lock file.
//
// So the build needs internet access the first time, the deployment does not. This
// module runs in Node (the config of Vite), not in the app.
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Plugin } from "vite";
import { cdnUrl, PACKAGES, selfHostedFolder } from "../pyodide";

/** The files of the core of Pyodide that the app loads. */
export const CORE = [
  "pyodide.mjs",
  "pyodide.asm.mjs",
  "pyodide.asm.wasm",
  "python_stdlib.zip",
  "pyodide-lock.json",
];

/** Pyodide cannot be copied into the build; the message says why. */
export class PyodideError extends Error {}

export interface LockPackage {
  name: string;
  file_name: string;
  sha256: string;
  depends: string[];
}

interface Lock {
  packages: Record<string, LockPackage>;
}

/** The packages and their dependencies in a lock file, by name. */
export function packageFiles(lock: Lock, names = PACKAGES): LockPackage[] {
  const found = new Map<string, LockPackage>();
  const visit = (name: string) => {
    if (found.has(name)) return;
    const entry = lock.packages[name];
    if (!entry)
      throw new PyodideError(`pyodide-lock.json has no package ${name}.`);
    found.set(name, entry);
    entry.depends.forEach(visit);
  };
  names.forEach(visit);
  return [...found.values()].sort((a, b) => a.name.localeCompare(b.name));
}

const sha256 = (data: Uint8Array) =>
  createHash("sha256").update(data).digest("hex");

/**
 * The file of a package: from the cache folder, else downloaded from the CDN into
 * it. Both are checked against the SHA-256 of the lock file.
 */
export async function packageFile(
  file: LockPackage,
  version: string,
  cache: string,
  fetchFile: typeof fetch = fetch,
): Promise<Buffer> {
  const path = join(cache, file.file_name);
  if (existsSync(path)) {
    const data = readFileSync(path);
    if (sha256(data) === file.sha256) return data;
  }
  const url = cdnUrl(version) + file.file_name;
  const fail = (message: string): never => {
    throw new PyodideError(
      `Pyodide for a self-hosted brand: ${url} ${message}. The build downloads ` +
        `the packages of Pyodide once, into ${cache}.`,
    );
  };
  let response: Response | undefined;
  try {
    response = await fetchFile(url);
  } catch (error) {
    // the reason of `fetch failed`, e.g. no DNS; behind a proxy, Node needs
    // NODE_USE_ENV_PROXY=1 to use HTTPS_PROXY
    const { message, cause } = error as Error & { cause?: Error };
    fail(
      `could not be downloaded: ${cause?.message ?? message}` +
        (process.env.HTTPS_PROXY && !process.env.NODE_USE_ENV_PROXY
          ? " (behind a proxy, set NODE_USE_ENV_PROXY=1)"
          : ""),
    );
  }
  if (!response!.ok) fail(`answered ${response!.status}`);
  const data = Buffer.from(await response!.arrayBuffer());
  if (sha256(data) !== file.sha256)
    fail("does not have the SHA-256 of pyodide-lock.json");
  mkdirSync(cache, { recursive: true });
  writeFileSync(path, data);
  return data;
}

export interface PyodideOptions {
  /** Pyodide of the CDN, or copied into the build (brand.json, ADR 0020). */
  source: "cdn" | "self-hosted";
  /** The version of Pyodide that package.json pins. */
  version: string;
  /** The npm package `pyodide`, e.g. node_modules/pyodide. */
  dir: string;
  /** The folder of the downloaded packages. */
  cache: string;
  fetch?: typeof fetch;
}

/** The files of a self-hosted Pyodide: their names in the app and their data. */
export async function pyodideFiles({
  version,
  dir,
  cache,
  fetch: fetchFile,
}: Omit<PyodideOptions, "source">): Promise<[string, Buffer][]> {
  const installed = (
    JSON.parse(readFileSync(join(dir, "package.json"), "utf-8")) as {
      version: string;
    }
  ).version;
  if (installed !== version)
    throw new PyodideError(
      `Pyodide for a self-hosted brand: ${dir} has version ${installed}, but ` +
        `package.json pins ${version}. Run npm ci.`,
    );
  const folder = selfHostedFolder(version);
  const core = CORE.map(
    (name) =>
      [folder + name, readFileSync(join(dir, name))] as [string, Buffer],
  );
  const lock = JSON.parse(
    readFileSync(join(dir, "pyodide-lock.json"), "utf-8"),
  ) as Lock;
  const packages = await Promise.all(
    packageFiles(lock).map(
      async (file) =>
        [
          folder + file.file_name,
          await packageFile(file, version, cache, fetchFile),
        ] as [string, Buffer],
    ),
  );
  return [...core, ...packages];
}

const TYPES: Record<string, string> = {
  mjs: "text/javascript",
  wasm: "application/wasm",
  json: "application/json",
  zip: "application/zip",
  whl: "application/zip",
};

/**
 * The plugin of Vite: a self-hosted Pyodide in `pyodide/v<version>/`, in the build
 * and in dev. With Pyodide of the CDN, it does nothing.
 */
export function pyodide(options: PyodideOptions): Plugin {
  let files: Promise<[string, Buffer][]> | undefined;
  const load = () => (files ??= pyodideFiles(options));
  if (options.source !== "self-hosted") return { name: "pyodide" };
  const folder = selfHostedFolder(options.version);
  return {
    name: "pyodide",
    async generateBundle() {
      for (const [fileName, source] of await load())
        this.emitFile({ type: "asset", fileName, source });
    },
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        const path = decodeURIComponent((request.url ?? "").split("?")[0]);
        const at = path.indexOf(`/${folder}`);
        if (at < 0) return next();
        const name = path.slice(at + 1);
        load().then((list) => {
          const file = list.find(([fileName]) => fileName === name);
          if (!file) return next();
          const type = TYPES[name.split(".").pop() ?? ""];
          if (type) response.setHeader("Content-Type", type);
          response.end(file[1]);
        }, next);
      });
    },
  };
}
