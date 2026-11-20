// Web Worker that runs Pyodide and FElupe (ADR 0005). It loads Pyodide, the wheels
// and the package felupe_studio, keeps the bytecode cache (ADR 0017) and loads the
// lazy wheels; the requests are answered by felupe_studio.requests (#311), like in
// the local runtime of `felupe-studio serve`, and their arrays are transferred.
import type { PyodideInterface } from "pyodide";
import type { PyCallable, PyProxy } from "pyodide/ffi";
import { encodeFrame, restore } from "./frames";
import { toWorkerMessage, transfers } from "./messages";
import {
  CACHE,
  type CacheFS,
  type CacheState,
  REFIX_SOURCE,
  cacheKey,
  enableSource,
  openCache,
  persister,
} from "./pycache";
import type { Capabilities, FromWorker, ToWorker, Versions } from "./protocol";

const ctx = self as unknown as DedicatedWorkerGlobalScope;
let pyodide: PyodideInterface | undefined;
/** `handle_frame()` of felupe_studio.requests: answers a request. */
let handleFrame: PyCallable | undefined;
/** Wheels that are loaded only when they are needed (e.g. tensortrax). */
let lazyWheels: Record<string, string> = {};
/** Writes the bytecode cache back to IndexedDB (ADR 0017), if it is enabled. */
let persist: (() => Promise<void>) | undefined;
let persistTimer: ReturnType<typeof setTimeout> | undefined;

/**
 * The package felupe_studio, written into the file system of Pyodide, without its
 * MCP server (#239) and its local runtime (#240), which are local processes.
 */
const SOURCES = import.meta.glob(
  [
    "../../../python/felupe_studio/*.{py,json}",
    "!../../../python/felupe_studio/{mcp,runtime,serve,cli,__main__,bridge}.py",
  ],
  { query: "?raw", import: "default", eager: true },
) as Record<string, string>;

const HOME = "/home/pyodide";
/** Working directory of Python: the mesh files of the project. */
const PROJECT = `${HOME}/project`;

function post(message: FromWorker, transfer: Transferable[] = []): void {
  ctx.postMessage(message, transfer);
}

function python(): PyodideInterface {
  if (!pyodide) throw new Error("Pyodide is not initialized.");
  return pyodide;
}

async function init(
  pyodideVersion: string,
  wheels: string[],
  lazy: Record<string, string> = {},
  folder = CACHE,
) {
  lazyWheels = lazy;
  const t0 = performance.now();
  const indexURL = `https://cdn.jsdelivr.net/pyodide/v${pyodideVersion}/full/`;
  const { loadPyodide } = (await import(
    /* @vite-ignore */ `${indexURL}pyodide.mjs`
  )) as typeof import("pyodide");
  const py = await loadPyodide({ indexURL });

  const t1 = performance.now();
  // the bytecode cache (ADR 0017) is read from IndexedDB while the packages load
  const fs = py.FS as unknown as CacheFS;
  const key = cacheKey(
    pyodideVersion,
    [...wheels, ...Object.values(lazy)],
    SOURCES,
  );
  // the folder of the cache of the brand (ADR 0020)
  const opened = openCache(fs, key, globalThis.indexedDB, folder);
  // rich is a dependency of meshio
  await py.loadPackage(["numpy", "scipy", "rich"]);
  const cache: CacheState = await opened;

  // the pure-Python wheels (FElupe, meshio) are served by the app itself (#40)
  const t2 = performance.now();
  await py.loadPackage(wheels);
  py.FS.mkdirTree(`${HOME}/felupe_studio`);
  for (const [path, text] of Object.entries(SOURCES)) {
    py.FS.writeFile(`${HOME}/felupe_studio/${path.split("/").pop()}`, text);
  }
  py.FS.mkdirTree(PROJECT);
  py.runPython(
    `import os, sys\nsys.path.insert(0, "${HOME}")\nos.chdir("${PROJECT}")`,
  );
  if (cache !== "off") {
    py.runPython(enableSource(HOME, key, folder));
    persist = persister(fs);
  }

  // the parts of the FElupe step (#49): the first imports compile the sources,
  // without the bytecode of the cache
  const t3 = performance.now();
  py.runPython("import numpy, scipy.sparse, scipy.sparse.linalg");
  const t4 = performance.now();
  py.runPython("import felupe");
  const t5 = performance.now();
  py.runPython("import meshio");
  const t6 = performance.now();
  const versions = JSON.parse(
    py.runPython(
      "import json, sys, felupe, numpy, scipy\n" +
        "json.dumps({'python': sys.version.split()[0], " +
        "'felupe': felupe.__version__, 'numpy': numpy.__version__, " +
        "'scipy': scipy.__version__})",
    ),
  ) as Omit<Versions, "pyodide">;

  // the linear solvers of Pyodide: no PARDISO (#308)
  const capabilities = JSON.parse(
    py.runPython(
      "import json\n" +
        "from felupe_studio.capabilities import capabilities\n" +
        "json.dumps(capabilities())",
    ),
  ) as Capabilities;

  pyodide = py;
  const requests = py.pyimport("felupe_studio.requests");
  // a copy: an attribute is borrowed from the proxy of its module
  handleFrame = (requests.handle_frame as PyCallable).copy() as PyCallable;
  requests.destroy();
  post({
    type: "ready",
    versions: { ...versions, pyodide: py.version, runtime: "pyodide" },
    capabilities,
    timings: {
      pyodide: t1 - t0,
      packages: t2 - t1,
      felupe: t6 - t2,
      total: t6 - t0,
      wheels: t3 - t2,
      numpy: t4 - t3,
      importFelupe: t5 - t4,
      meshio: t6 - t5,
      cache,
    },
  });
  schedulePersist();
}

/**
 * Write the bytecode cache back to IndexedDB once the worker has been idle for a
 * moment, e.g. after the start or the modules imported by the first job.
 */
function schedulePersist(delay = 2000) {
  if (!persist) return;
  clearTimeout(persistTimer);
  persistTimer = setTimeout(() => void persist?.(), delay);
}

/**
 * Load the wheels of a run that are loaded only when they are needed: the
 * tensortrax wheel for its models.
 */
async function loadLazyWheels(document: string) {
  if (!lazyWheels.tensortrax) return;
  const py = python();
  const runner = py.pyimport("felupe_studio.runner");
  try {
    if (runner.uses_tensortrax(document)) {
      await py.loadPackage([lazyWheels.tensortrax]);
      // its bytecode in the cache too (ADR 0017)
      py.runPython(REFIX_SOURCE);
    }
  } finally {
    runner.destroy();
  }
}

/**
 * Post an answer of Python: the JSON text of a message and its buffers (the parts
 * of a frame, `felupe_studio.frames.split()`), as the message of the worker with
 * its arrays transferred.
 */
function answer(text: string, buffers: PyProxy) {
  const bytes = buffers.toJs() as Uint8Array[];
  const raw = restore(JSON.parse(text), bytes) as Record<string, unknown>;
  const message = toWorkerMessage(raw);
  post(message, transfers(message));
}

/**
 * Answer a request with felupe_studio.requests, which posts its answers while it
 * runs. Python runs synchronously: a job is cancelled by terminating the worker.
 */
async function request(message: Exclude<ToWorker, { type: "init" }>) {
  if (!handleFrame) throw new Error("Pyodide is not initialized.");
  if (message.type === "run") await loadLazyWheels(message.document);
  const frame = encodeFrame(message);
  handleFrame(
    typeof frame === "string" ? frame : new Uint8Array(frame),
    answer,
  );
}

ctx.onmessage = async (event: MessageEvent<ToWorker>) => {
  const message = event.data;
  const id = "id" in message ? message.id : undefined;
  try {
    if (message.type === "init")
      return await init(
        message.pyodideVersion,
        message.wheels,
        message.lazyWheels,
        message.cache,
      );
    await request(message);
  } catch (error) {
    post({
      type: "error",
      id,
      message: error instanceof Error ? error.message : String(error),
    });
  } finally {
    // the modules imported by a request, e.g. of a solve, into the cache
    if (message.type !== "init") schedulePersist();
  }
};
