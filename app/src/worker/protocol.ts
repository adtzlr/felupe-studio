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
 * FElupe like `mesh.plot()` (`felupe_studio.scene.surface()`). Every region of cells
 * with the same tag values has a closed surface of its own.
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
  /** The values of the cell tags per cell, by tag name. */
  tags?: Record<string, Int32Array>;
  /** Exact coordinates of the points of the cells (three per point). */
  nodes?: Float64Array;
  /** Number of solid cells. */
  cells: number;
}

/** An event of a running job (`felupe_studio.runner`). */
export type JobEvent =
  | {
      event: "start";
      jobs: string[];
      /** The substeps of every step, by job. */
      substeps: Record<string, number[]>;
    }
  | {
      event: "substep";
      job: string;
      step: number;
      steps: number;
      substep: number;
      substeps: number;
    }
  | {
      event: "iteration";
      iteration: number;
      fnorm: number | null;
      xnorm: number | null;
    }
  | { event: "failed"; step: number; substep: number; message: string }
  | {
      event: "converged";
      step: number;
      substep: number;
      iterations: number;
      /** Increments of the substep, more than one after cutbacks. */
      increments: number;
    }
  | { event: "finished"; job: string; time: number };

/** Results of a job: for a characteristic curve, the displacements and forces. */
export interface JobResult {
  substeps: number;
  time: number;
  x?: (number | null)[][];
  y?: (number | null)[][];
}

/** A quantity of the results (`felupe_studio.results.QUANTITIES`). */
export type Quantity =
  | "displacement"
  | "displacement_x"
  | "displacement_y"
  | "displacement_z"
  | "strain_max"
  | "strain_mid"
  | "strain_min"
  | "stress_max"
  | "stress_mid"
  | "stress_min"
  | "stress_mises";

/** The outer surface of a section with the result of a substep. */
export interface ResultSurface {
  /** The name of the section. */
  name: string;
  /** Three coordinates per point of the surface (undeformed). */
  positions: Float32Array;
  /** Three components per point of the surface. */
  displacement: Float32Array;
  triangles: Uint32Array;
  /** The face of a cell of every triangle, to shade faces flat (linear cells). */
  faces?: Uint32Array;
  edges: Uint32Array;
  /** The values at the points or at the triangles (see `at`). */
  values: Float32Array;
  /** The cell of the section of every triangle. */
  owners: Uint32Array;
  /** The node (point of the mesh) of every point, -1 inside a subdivided face. */
  nodes: Int32Array;
}

/** The result of a substep of a job (`felupe_studio.results.scene()`). */
export interface ResultScene {
  label: string;
  at: "point" | "cell";
  /** The range of the values of all sections (null without finite values). */
  range: [number, number] | null;
  surfaces: ResultSurface[];
}

export type ToWorker =
  | {
      type: "init";
      pyodideVersion: string;
      wheels: string[];
      /** Wheels loaded when they are needed, by name (e.g. tensortrax). */
      lazyWheels?: Record<string, string>;
    }
  | { type: "benchmark"; id: number; sizes: number[] }
  | { type: "write-file"; id: number; name: string; data: ArrayBuffer }
  | { type: "inspect-mesh"; id: number; name: string }
  | { type: "run"; id: number; document: string }
  | { type: "script"; id: number; document: string }
  | {
      type: "export-results";
      id: number;
      job: string;
      format: "vtu" | "xdmf";
      /** The substep of a VTU file (the last one by default). */
      substep?: number;
    }
  | {
      type: "result";
      id: number;
      job: string;
      substep: number;
      quantity: Quantity;
    };

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
  | { type: "job-progress"; id: number; event: JobEvent }
  | { type: "job-result"; id: number; results: Record<string, JobResult> }
  | { type: "result-scene"; id: number; scene: ResultScene }
  | { type: "text"; id: number; text: string }
  | { type: "bytes"; id: number; data: ArrayBuffer }
  | { type: "done"; id: number }
  | { type: "error"; id?: number; message: string };
