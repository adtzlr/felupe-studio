// Web Worker that runs Pyodide and FElupe (ADR 0005).
import type { PyodideInterface } from "pyodide";
import { safeName } from "./files";
import { type RawSurface, toSurfaces, transferables } from "./surface";
import type {
  BenchmarkResult,
  FromWorker,
  JobEvent,
  JobResult,
  MeshInfo,
  ToWorker,
  Versions,
} from "./protocol";

const ctx = self as unknown as DedicatedWorkerGlobalScope;
let pyodide: PyodideInterface | undefined;
/** Wheels that are loaded only when they are needed (e.g. tensortrax). */
let lazyWheels: Record<string, string> = {};

/** The package felupe_studio, written into the file system of Pyodide. */
const SOURCES = import.meta.glob("../../../python/felupe_studio/*.{py,json}", {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;

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
) {
  lazyWheels = lazy;
  const t0 = performance.now();
  const indexURL = `https://cdn.jsdelivr.net/pyodide/v${pyodideVersion}/full/`;
  const { loadPyodide } = (await import(
    /* @vite-ignore */ `${indexURL}pyodide.mjs`
  )) as typeof import("pyodide");
  const py = await loadPyodide({ indexURL });

  const t1 = performance.now();
  // rich is a dependency of meshio
  await py.loadPackage(["numpy", "scipy", "rich"]);

  // the pure-Python wheels (FElupe, meshio) are served by the app itself (#40)
  const t2 = performance.now();
  await py.loadPackage(wheels);
  py.FS.mkdirTree(`${HOME}/felupe_studio`);
  for (const [path, text] of Object.entries(SOURCES)) {
    py.FS.writeFile(`${HOME}/felupe_studio/${path.split("/").pop()}`, text);
  }
  py.FS.mkdirTree(PROJECT);
  py.runPython(
    `import os, sys\nsys.path.insert(0, "${HOME}")\nos.chdir("${PROJECT}")\nimport felupe, meshio`,
  );

  const t3 = performance.now();
  const versions = JSON.parse(
    py.runPython(
      "import json, sys, felupe, numpy, scipy\n" +
        "json.dumps({'python': sys.version.split()[0], " +
        "'felupe': felupe.__version__, 'numpy': numpy.__version__, " +
        "'scipy': scipy.__version__})",
    ),
  ) as Omit<Versions, "pyodide">;

  pyodide = py;
  post({
    type: "ready",
    versions: { ...versions, pyodide: py.version },
    timings: {
      pyodide: t1 - t0,
      packages: t2 - t1,
      felupe: t3 - t2,
      total: t3 - t0,
    },
  });
}

function writeFile(id: number, name: string, data: ArrayBuffer) {
  python().FS.writeFile(`${PROJECT}/${safeName(name)}`, new Uint8Array(data));
  post({ type: "done", id });
}

/** Inspect a mesh file and triangulate its outer surfaces (one read of the file). */
function inspectMesh(id: number, name: string) {
  const meshes = python().pyimport("felupe_studio.meshes");
  try {
    const result = meshes.load(safeName(name));
    const [text, raw] = result.toJs({
      dict_converter: Object.fromEntries,
    }) as [string, Record<string, RawSurface>];
    result.destroy();
    const info = JSON.parse(text) as MeshInfo;
    const surfaces = toSurfaces(raw);
    post(
      { type: "mesh-info", id, info, surfaces },
      transferables(...Object.values(surfaces)),
    );
  } finally {
    meshes.destroy();
  }
}

/**
 * Run the jobs of a command list with progress. Models of tensortrax load the
 * tensortrax wheel first. Python runs synchronously: a job is cancelled by
 * terminating the worker.
 */
async function run(id: number, document: string) {
  const py = python();
  const runner = py.pyimport("felupe_studio.runner");
  try {
    if (runner.uses_tensortrax(document) && lazyWheels.tensortrax) {
      await py.loadPackage([lazyWheels.tensortrax]);
    }
    const report = (text: string) =>
      post({ type: "job-progress", id, event: JSON.parse(text) as JobEvent });
    const results = runner.run_json(document, report) as string;
    post({
      type: "job-result",
      id,
      results: JSON.parse(results) as Record<string, JobResult>,
    });
  } finally {
    runner.destroy();
  }
}

function benchmark(id: number, sizes: number[]) {
  const module = python().pyimport("felupe_studio.benchmark");
  try {
    for (const n of sizes) {
      post({ type: "progress", id, message: `Running n = ${n} …` });
      const proxy = module.benchmark.callKwargs({ n, num: 5 });
      const result = proxy.toJs({
        dict_converter: Object.fromEntries,
      }) as BenchmarkResult;
      proxy.destroy();
      post({ type: "benchmark-result", id, result });
    }
  } finally {
    module.destroy();
  }
  post({ type: "done", id });
}

ctx.onmessage = async (event: MessageEvent<ToWorker>) => {
  const message = event.data;
  const id = "id" in message ? message.id : undefined;
  try {
    switch (message.type) {
      case "init":
        return await init(
          message.pyodideVersion,
          message.wheels,
          message.lazyWheels,
        );
      case "benchmark":
        return benchmark(message.id, message.sizes);
      case "write-file":
        return writeFile(message.id, message.name, message.data);
      case "inspect-mesh":
        return inspectMesh(message.id, message.name);
      case "run":
        return await run(message.id, message.document);
    }
  } catch (error) {
    post({
      type: "error",
      id,
      message: error instanceof Error ? error.message : String(error),
    });
  }
};
