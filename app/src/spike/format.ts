import type {
  BenchmarkResult,
  LoadTimings,
  Versions,
} from "../worker/protocol";

export const DEFAULT_SIZES = "3, 5, 7, 9, 11";

/** Parse a comma-separated list of points per edge (integers from 2 to 25). */
export function parseSizes(text: string): number[] {
  const parts = text
    .split(/[,\s]+/)
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
  if (parts.length === 0) throw new Error("Enter at least one size.");

  return parts.map((part) => {
    const n = Number(part);
    if (!Number.isInteger(n) || n < 2 || n > 25) {
      throw new Error(`Invalid size "${part}": use integers from 2 to 25.`);
    }
    return n;
  });
}

/** The formulation of a benchmark: a way of u-p-J (#420), or the compressible u. */
export const formulationOf = (result: BenchmarkResult): string =>
  result.formulation ?? "u";

/** Format seconds with three decimals. */
export function seconds(value: number): string {
  return value.toFixed(3);
}

export interface Environment {
  userAgent: string;
  cores?: number;
  memory?: number;
  /** Whether the page was controlled by the service worker (cache). */
  serviceWorker?: boolean;
}

/** Markdown summary of a benchmark run, ready to paste into docs/benchmarks.md. */
/**
 * The parts of the FElupe step of the worker (#49), as rows below it, if the worker
 * measured them.
 */
export function loadParts(timings: LoadTimings): [string, number][] {
  const parts: [string, number | undefined][] = [
    ["· wheels and sources", timings.wheels],
    ["· import NumPy, SciPy", timings.numpy],
    ["· import FElupe", timings.importFelupe],
    ["· import meshio", timings.meshio],
  ];
  return parts.filter((p): p is [string, number] => p[1] !== undefined);
}

export function toMarkdown(
  env: Environment,
  versions: Versions,
  timings: LoadTimings,
  results: BenchmarkResult[],
): string {
  const lines = [
    `**Device:** ${env.userAgent}`,
    `**Cores:** ${env.cores ?? "unknown"} · **Memory:** ${env.memory ? `${env.memory} GB` : "unknown"}`,
    `**Service worker cache:** ${env.serviceWorker ? "active" : "not active"}` +
      (timings.cache ? ` · **Bytecode cache:** ${timings.cache}` : ""),
    `**Versions:** Pyodide ${versions.pyodide}, Python ${versions.python}, FElupe ${versions.felupe}, NumPy ${versions.numpy}, SciPy ${versions.scipy}`,
    "",
    "| Load step | Time in s |",
    "| --- | ---: |",
    `| Pyodide | ${seconds(timings.pyodide / 1000)} |`,
    `| NumPy, SciPy | ${seconds(timings.packages / 1000)} |`,
    `| FElupe, meshio (wheels of the app) | ${seconds(timings.felupe / 1000)} |`,
    ...loadParts(timings).map(
      ([label, ms]) => `| ${label} | ${seconds(ms / 1000)} |`,
    ),
    `| **Total** | **${seconds(timings.total / 1000)}** |`,
    "",
    "| n | DOF | Cells | Precision | Formulation | Setup in s | Solve in s | Iterations | Force |",
    "| ---: | ---: | ---: | --- | --- | ---: | ---: | ---: | ---: |",
    ...results.map(
      (r) =>
        `| ${r.n} | ${r.dofs} | ${r.cells} | ${r.precision} | ${formulationOf(r)} | ${seconds(r.setup)} | ${seconds(r.solve)} | ${r.iterations ?? "–"} | ${r.force.toFixed(4)} |`,
    ),
  ];
  return lines.join("\n");
}
