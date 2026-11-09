// Messages between the main thread and the Pyodide worker (ADR 0005). Requests carry
// an id; the worker answers with messages of the same id and ends with a final one
// (`done`, `mesh-info`) or an `error`. `benchmark` is a spike-only message (#9).

export interface Versions {
  python: string;
  pyodide: string;
  felupe: string;
  numpy: string;
  scipy: string;
}

/** Load times in milliseconds: Pyodide, NumPy and SciPy, the wheels of the app. */
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

/** Result of `felupe_studio.meshes.inspect()`. */
export interface MeshInfo {
  file: string;
  points?: number;
  blocks?: { type: string; cells: number }[];
  cell_type?: string;
  cells?: number;
  /** Lower-dimensional cell types that are ignored, e.g. boundary faces. */
  ignored?: string[];
  bounds?: [number[], number[]];
  tags?: {
    name: string;
    values: { value: number; cells: number; label?: string }[];
  }[];
  /** Why the file cannot be used. */
  error?: string;
}

export type ToWorker =
  | { type: "init"; pyodideVersion: string; wheels: string[] }
  | { type: "benchmark"; id: number; sizes: number[] }
  | { type: "write-file"; id: number; name: string; data: ArrayBuffer }
  | { type: "inspect-mesh"; id: number; name: string };

export type FromWorker =
  | { type: "ready"; versions: Versions; timings: LoadTimings }
  | { type: "progress"; id: number; message: string }
  | { type: "benchmark-result"; id: number; result: BenchmarkResult }
  | { type: "mesh-info"; id: number; info: MeshInfo }
  | { type: "done"; id: number }
  | { type: "error"; id?: number; message: string };
