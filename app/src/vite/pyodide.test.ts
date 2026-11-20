import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import pkg from "../../package.json";
import { PACKAGES } from "../pyodide";
import {
  CORE,
  type LockPackage,
  packageFile,
  packageFiles,
  pyodide,
  PyodideError,
  pyodideFiles,
} from "./pyodide";

const APP = resolve(__dirname, "../..");
const VERSION = pkg.devDependencies.pyodide;
const CDN = `https://cdn.jsdelivr.net/pyodide/v${VERSION}/full/`;

const sha256 = (text: string) =>
  createHash("sha256").update(text).digest("hex");

const entry = (name: string, depends: string[] = []): LockPackage => ({
  name,
  file_name: `${name}-1.0-py3-none-any.whl`,
  sha256: sha256(`the wheel of ${name}`),
  depends,
});

/** A lock file whose numpy and scipy have dependencies, and a package of none. */
const LOCK = {
  packages: {
    numpy: entry("numpy"),
    scipy: entry("scipy", ["numpy", "openblas"]),
    openblas: entry("openblas"),
    rich: entry("rich", ["pygments"]),
    pygments: entry("pygments"),
    pandas: entry("pandas", ["numpy"]),
  },
};

/** A CDN that answers the wheels of LOCK, and counts the downloads. */
function cdn(
  body = (url: string) =>
    `the wheel of ${url.split("/").at(-1)!.split("-")[0]}`,
) {
  return vi.fn(
    async (url: string | URL | Request) => new Response(body(String(url))),
  ) as unknown as typeof fetch & ReturnType<typeof vi.fn>;
}

/** The npm package `pyodide` of a version, with the lock file LOCK. */
function npmPackage(version = VERSION) {
  const dir = mkdtempSync(join(tmpdir(), "pyodide-"));
  writeFileSync(join(dir, "package.json"), JSON.stringify({ version }));
  for (const name of CORE) writeFileSync(join(dir, name), `the file ${name}`);
  writeFileSync(join(dir, "pyodide-lock.json"), JSON.stringify(LOCK));
  return dir;
}

const cacheFolder = () =>
  join(mkdtempSync(join(tmpdir(), "cache-")), "pyodide");

describe("the packages of a self-hosted Pyodide (ADR 0020)", () => {
  it("are those of the worker and their dependencies", () => {
    expect(packageFiles(LOCK).map((p) => p.name)).toEqual([
      "numpy",
      "openblas",
      "pygments",
      "rich",
      "scipy",
    ]);
    // the lock file of the pinned Pyodide has the packages of the worker
    const lock = JSON.parse(
      readFileSync(
        join(APP, "node_modules/pyodide/pyodide-lock.json"),
        "utf-8",
      ),
    );
    const names = packageFiles(lock).map((p) => p.name);
    expect(names).toEqual(expect.arrayContaining(PACKAGES));
    expect(() => packageFiles(LOCK, ["felupe"])).toThrow(
      "pyodide-lock.json has no package felupe.",
    );
  });

  it("are downloaded once and checked against the lock file", async () => {
    const cache = cacheFolder();
    const fetch = cdn();
    const numpy = LOCK.packages.numpy;
    const data = await packageFile(numpy, VERSION, cache, fetch);
    expect(String(data)).toBe("the wheel of numpy");
    expect(fetch).toHaveBeenCalledWith(`${CDN}${numpy.file_name}`);
    expect(existsSync(join(cache, numpy.file_name))).toBe(true);
    // the second build takes the file of the cache
    await packageFile(numpy, VERSION, cache, fetch);
    expect(fetch).toHaveBeenCalledTimes(1);
    // a changed file of the cache is downloaded again
    writeFileSync(join(cache, numpy.file_name), "changed");
    expect(String(await packageFile(numpy, VERSION, cache, fetch))).toBe(
      "the wheel of numpy",
    );
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("fail the build with a clear message", async () => {
    const cache = cacheFolder();
    const numpy = LOCK.packages.numpy;
    await expect(
      packageFile(
        numpy,
        VERSION,
        cache,
        cdn(() => "another wheel"),
      ),
    ).rejects.toThrow(
      `${CDN}${numpy.file_name} does not have the SHA-256 of pyodide-lock.json.`,
    );
    // nothing wrong is kept
    expect(existsSync(join(cache, numpy.file_name))).toBe(false);
    const denied = (async () =>
      new Response("", { status: 403 })) as typeof fetch;
    await expect(packageFile(numpy, VERSION, cache, denied)).rejects.toThrow(
      `${CDN}${numpy.file_name} answered 403. The build downloads the packages ` +
        `of Pyodide once, into ${cache}.`,
    );
    // the reason of a failed fetch of Node
    const offline = (async () => {
      throw new TypeError("fetch failed", {
        cause: new Error("getaddrinfo ENOTFOUND cdn.jsdelivr.net"),
      });
    }) as typeof fetch;
    vi.stubEnv("HTTPS_PROXY", "");
    await expect(packageFile(numpy, VERSION, cache, offline)).rejects.toThrow(
      "could not be downloaded: getaddrinfo ENOTFOUND cdn.jsdelivr.net. The",
    );
    // Node uses a proxy only when it is asked to
    vi.stubEnv("HTTPS_PROXY", "http://proxy.example:3128");
    vi.stubEnv("NODE_USE_ENV_PROXY", "");
    await expect(packageFile(numpy, VERSION, cache, offline)).rejects.toThrow(
      "ENOTFOUND cdn.jsdelivr.net (behind a proxy, set NODE_USE_ENV_PROXY=1).",
    );
    vi.unstubAllEnvs();
  });
});

describe("the files of a self-hosted Pyodide", () => {
  it("are the core and the packages in the folder of the version", async () => {
    const files = await pyodideFiles({
      version: VERSION,
      dir: npmPackage(),
      cache: cacheFolder(),
      fetch: cdn(),
    });
    const folder = `pyodide/v${VERSION}/`;
    expect(files.map(([name]) => name)).toEqual([
      ...CORE.map((name) => folder + name),
      ...packageFiles(LOCK).map((p) => folder + p.file_name),
    ]);
    expect(String(files[0][1])).toBe("the file pyodide.mjs");
  });

  it("are those of the pinned version", async () => {
    const dir = npmPackage("0.29.0");
    await expect(
      pyodideFiles({ version: VERSION, dir, cache: cacheFolder() }),
    ).rejects.toThrow(
      new PyodideError(
        `Pyodide for a self-hosted brand: ${dir} has version 0.29.0, but ` +
          `package.json pins ${VERSION}. Run npm ci.`,
      ),
    );
  });
});

describe("the plugin of Pyodide", () => {
  const emit = async (plugin: ReturnType<typeof pyodide>) => {
    const emitted: string[] = [];
    await (
      plugin.generateBundle as ((this: unknown) => Promise<void>) | undefined
    )?.call({
      emitFile: (file: { fileName: string }) => emitted.push(file.fileName),
    });
    return emitted;
  };

  it("copies a self-hosted Pyodide into the build", async () => {
    const options = {
      version: VERSION,
      dir: npmPackage(),
      cache: cacheFolder(),
      fetch: cdn(),
    };
    const emitted = await emit(pyodide({ ...options, source: "self-hosted" }));
    expect(emitted).toContain(`pyodide/v${VERSION}/pyodide.asm.wasm`);
    expect(emitted).toContain(`pyodide/v${VERSION}/scipy-1.0-py3-none-any.whl`);
    expect(emitted).toHaveLength(CORE.length + 5);
  });

  it("does nothing with Pyodide of the CDN", async () => {
    const fetch = cdn();
    const plugin = pyodide({
      source: "cdn",
      version: VERSION,
      dir: "/missing",
      cache: "/missing",
      fetch,
    });
    expect(await emit(plugin)).toEqual([]);
    expect(plugin.configureServer).toBeUndefined();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("serves a self-hosted Pyodide in dev", async () => {
    const plugin = pyodide({
      source: "self-hosted",
      version: VERSION,
      dir: npmPackage(),
      cache: cacheFolder(),
      fetch: cdn(),
    });
    type Handler = (
      request: { url: string },
      response: {
        setHeader: (k: string, v: string) => void;
        end: (d: Buffer) => void;
      },
      next: () => void,
    ) => void;
    let handler: Handler | undefined;
    (plugin.configureServer as (server: unknown) => void)({
      middlewares: { use: (h: Handler) => (handler = h) },
    });
    const get = (url: string) =>
      new Promise<{ type?: string; body?: string; next: boolean }>((done) => {
        let type: string | undefined;
        handler!(
          { url },
          {
            setHeader: (_name, value) => (type = value),
            end: (data) => done({ type, body: String(data), next: false }),
          },
          () => done({ next: true }),
        );
      });
    expect(await get(`/pyodide/v${VERSION}/pyodide.asm.wasm`)).toEqual({
      type: "application/wasm",
      body: "the file pyodide.asm.wasm",
      next: false,
    });
    expect(
      await get(`/pyodide/v${VERSION}/numpy-1.0-py3-none-any.whl?x=1`),
    ).toMatchObject({ body: "the wheel of numpy" });
    expect(await get(`/pyodide/v${VERSION}/missing.js`)).toEqual({
      next: true,
    });
    expect(await get("/index.html")).toEqual({ next: true });
  });
});
