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

/** Format seconds with three decimals. */
export function seconds(value: number): string {
  return value.toFixed(3);
}

export interface Environment {
  userAgent: string;
  cores?: number;
  memory?: number;
}

/** Markdown summary of a benchmark run, ready to paste into docs/benchmarks.md. */
export function toMarkdown(
  env: Environment,
  versions: Versions,
  timings: LoadTimings,
  results: BenchmarkResult[],
): string {
  const lines = [
    `**Device:** ${env.userAgent}`,
    `**Cores:** ${env.cores ?? "unknown"} · **Memory:** ${env.memory ? `${env.memory} GB` : "unknown"}`,
    `**Versions:** Pyodide ${versions.pyodide}, Python ${versions.python}, FElupe ${versions.felupe}, NumPy ${versions.numpy}, SciPy ${versions.scipy}`,
    "",
    "| Load step | Time in s |",
    "| --- | ---: |",
    `| Pyodide | ${seconds(timings.pyodide / 1000)} |`,
    `| NumPy, SciPy, micropip | ${seconds(timings.packages / 1000)} |`,
    `| FElupe (micropip) | ${seconds(timings.felupe / 1000)} |`,
    `| **Total** | **${seconds(timings.total / 1000)}** |`,
    "",
    "| n | DOF | Cells | Setup in s | Solve in s | Force |",
    "| ---: | ---: | ---: | ---: | ---: | ---: |",
    ...results.map(
      (r) =>
        `| ${r.n} | ${r.dofs} | ${r.cells} | ${seconds(r.setup)} | ${seconds(r.solve)} | ${r.force.toFixed(4)} |`,
    ),
  ];
  return lines.join("\n");
}
