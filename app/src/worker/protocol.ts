// Messages between the main thread and the Pyodide worker (ADR 0005). Requests carry
// an id; the worker answers with messages of the same id and ends with a final one
// (`done`, `mesh-info`) or an `error`. `benchmark` is a spike-only message (#9).
// The arrays of a surface are transferred, not copied.

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

/** Integer cell data of solid cells, offered to create cell sets. */
export interface CellTag {
  name: string;
  /** The values with their number of cells; `label` is a Gmsh physical name. */
  values: { value: number; cells: number; label?: string }[];
}

/** The solid cells of one cell type of a mesh file. */
export interface SolidInfo {
  cell_type: string;
  cells: number;
  bounds: [number[], number[]];
  tags: CellTag[];
}

/** Result of `felupe_studio.meshes.inspect()`. */
export interface MeshInfo {
  file: string;
  points?: number;
  blocks?: { type: string; cells: number }[];
  /** One entry per type of solid cells that FElupe supports, in file order. */
  solids?: SolidInfo[];
  /** Solid cells without a region in FElupe, e.g. wedges. */
  unsupported?: { type: string; cells: number }[];
  /** Lower-dimensional cell types that are ignored, e.g. boundary faces. */
  ignored?: string[];
  /** Why the file cannot be used. */
  error?: string;
}

/**
 * Outer surface of the solid cells of a mesh file for the viewer, triangulated by
 * FElupe like `mesh.plot()` (`felupe_studio.scene.surface()`).
 */
export interface MeshSurface {
  /** Three coordinates per point of the surface. */
  positions: Float32Array;
  /** Three points per triangle, oriented outwards. */
  triangles: Uint32Array;
  /** The face of a cell of every triangle, to shade faces flat (linear cells). */
  faces?: Uint32Array;
  /** Two points per segment of the edges of the faces. */
  edges: Uint32Array;
  /** The solid cell of every triangle. */
  owners: Uint32Array;
  /** Number of solid cells. */
  cells: number;
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
  | {
      type: "mesh-info";
      id: number;
      info: MeshInfo;
      /** Outer surfaces by cell type. */
      surfaces: Record<string, MeshSurface>;
    }
  | { type: "done"; id: number }
  | { type: "error"; id?: number; message: string };
