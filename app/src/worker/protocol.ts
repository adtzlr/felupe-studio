// Messages between the main thread and the Pyodide worker (ADR 0005).
// `benchmark` and `benchmark-result` are spike-only messages (#9).

export interface Versions {
  python: string;
  pyodide: string;
  felupe: string;
  numpy: string;
  scipy: string;
}

/** Load times in milliseconds: Pyodide, NumPy and SciPy, the FElupe wheel. */
export interface LoadTimings {
  pyodide: number;
  packages: number;
  felupe: number;
  total: number;
}

/** Result of `felupe_studio.benchmark.benchmark()`, times in seconds. */
export interface BenchmarkResult {
  n: number;
  points: number;
  cells: number;
  dofs: number;
  increments: number;
  setup: number;
  solve: number;
  force: number;
}

export type ToWorker =
  | { type: "init"; pyodideVersion: string; felupeWheel: string }
  | { type: "benchmark"; id: number; sizes: number[] };

export type FromWorker =
  | { type: "ready"; versions: Versions; timings: LoadTimings }
  | { type: "progress"; id: number; message: string }
  | { type: "benchmark-result"; id: number; result: BenchmarkResult }
  | { type: "done"; id: number }
  | { type: "error"; id?: number; message: string };
