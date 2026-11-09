// Web Worker that runs Pyodide and FElupe (ADR 0005).
import type { PyodideInterface } from "pyodide";
import benchmarkSource from "../../../python/felupe_studio/benchmark.py?raw";
import type {
  BenchmarkResult,
  FromWorker,
  ToWorker,
  Versions,
} from "./protocol";

const ctx = self as unknown as DedicatedWorkerGlobalScope;
let pyodide: PyodideInterface | undefined;

function post(message: FromWorker): void {
  ctx.postMessage(message);
}

async function init(pyodideVersion: string, felupeWheel: string) {
  const t0 = performance.now();
  const indexURL = `https://cdn.jsdelivr.net/pyodide/v${pyodideVersion}/full/`;
  const { loadPyodide } = (await import(
    /* @vite-ignore */ `${indexURL}pyodide.mjs`
  )) as typeof import("pyodide");
  const py = await loadPyodide({ indexURL });

  const t1 = performance.now();
  await py.loadPackage(["numpy", "scipy"]);

  // the pure-Python FElupe wheel is served by the app itself (#40)
  const t2 = performance.now();
  await py.loadPackage(felupeWheel);
  await py.runPythonAsync("import felupe");

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

function benchmark(id: number, sizes: number[]) {
  if (!pyodide) throw new Error("Pyodide is not initialized.");

  const namespace = pyodide.globals.get("dict")();
  pyodide.runPython(benchmarkSource, { globals: namespace });
  const run = namespace.get("benchmark");

  for (const n of sizes) {
    post({ type: "progress", id, message: `Running n = ${n} …` });
    const proxy = run.callKwargs({ n, num: 5 });
    const result = proxy.toJs({
      dict_converter: Object.fromEntries,
    }) as BenchmarkResult;
    proxy.destroy();
    post({ type: "benchmark-result", id, result });
  }

  run.destroy();
  namespace.destroy();
  post({ type: "done", id });
}

ctx.onmessage = async (event: MessageEvent<ToWorker>) => {
  const message = event.data;
  const id = message.type === "benchmark" ? message.id : undefined;
  try {
    if (message.type === "init") {
      await init(message.pyodideVersion, message.felupeWheel);
    } else if (message.type === "benchmark") {
      benchmark(message.id, message.sizes);
    }
  } catch (error) {
    post({
      type: "error",
      id,
      message: error instanceof Error ? error.message : String(error),
    });
  }
};
