/* Generated from python/felupe_studio/commands.schema.json by
 * `npm run schema:types`. Do not edit by hand. */

/**
 * This interface was referenced by `CommandList`'s JSON-Schema
 * via the `definition` "Command".
 */
export type Command =
  | MeshImport
  | MeshMerge
  | CellSetFromTag
  | CellSetFromFile
  | MaterialAdd
  | SectionAdd
  | PointSetAdd
  | PointAdd
  | BoundaryAdd
  | LoadcaseAdd
  | StepAdd
  | JobAdd;
/**
 * Name of an object, unique within the command list. Used as a Python identifier in the generated script; at most 24 characters keep the script readable.
 *
 * This interface was referenced by `CommandList`'s JSON-Schema
 * via the `definition` "Name".
 */
export type Name = string;
/**
 * Add a material to the material library. Every model is a definition below (the material registry): its label, the FElupe class or tensortrax function, and its parameters with label, description, bounds and default.
 *
 * This interface was referenced by `CommandList`'s JSON-Schema
 * via the `definition` "MaterialAdd".
 */
export type MaterialAdd =
  | MaterialNeoHooke
  | MaterialNeoHookeCompressible
  | MaterialMooneyRivlin
  | MaterialLinearElasticLargeStrain;
/**
 * This interface was referenced by `CommandList`'s JSON-Schema
 * via the `definition` "Axis".
 */
export type Axis = "x" | "y" | "z";
/**
 * The coordinates x, y and z of a point.
 *
 * @minItems 3
 * @maxItems 3
 *
 * This interface was referenced by `CommandList`'s JSON-Schema
 * via the `definition` "Coordinates".
 */
export type Coordinates = [number, number, number];
/**
 * A load case of FElupe (fem.dof) on the merged field: the boundaries of a standard test. It is referenced like a boundary: a step ramps its moving end faces, a job records the reaction force of its (first) moving end face.
 *
 * This interface was referenced by `CommandList`'s JSON-Schema
 * via the `definition` "LoadcaseAdd".
 */
export type LoadcaseAdd =
  LoadcaseUniaxial | LoadcaseBiaxial | LoadcasePlanar | LoadcaseShear;

/**
 * A list of FElupe Studio commands. Objects are created by commands and referenced by their names.
 */
export interface CommandList {
  /**
   * Version of this schema.
   */
  schema_version: 2;
  commands: Command[];
}
/**
 * Import a mesh file (read with meshio).
 *
 * This interface was referenced by `CommandList`'s JSON-Schema
 * via the `definition` "MeshImport".
 */
export interface MeshImport {
  command: "mesh.import";
  name: Name;
  /**
   * File name of the mesh, e.g. specimen.vtu.
   */
  file: string;
  /**
   * Name of an integer cell data array used to split the mesh into cell sets, e.g. material or gmsh:physical.
   */
  tag?: string;
  /**
   * Type of the solid cells to import, if the file has more than one (one mesh per cell type).
   */
  cell_type?:
    "tetra" | "tetra10" | "hexahedron" | "hexahedron20" | "hexahedron27";
}
/**
 * Merge points of the sections whose coordinates agree to the given number of decimals (fem.field.merge(..., decimals)). Without this command, only identical points are merged. Merged points take the rounded coordinates.
 *
 * This interface was referenced by `CommandList`'s JSON-Schema
 * via the `definition` "MeshMerge".
 */
export interface MeshMerge {
  command: "mesh.merge";
  name: Name;
  /**
   * Number of decimals of the point coordinates compared for merging, e.g. 6.
   */
  decimals: number;
}
/**
 * Cell set of all cells of a mesh with the given tag value.
 *
 * This interface was referenced by `CommandList`'s JSON-Schema
 * via the `definition` "CellSetFromTag".
 */
export interface CellSetFromTag {
  command: "cellset.from_tag";
  name: Name;
  mesh: Name;
  value: number;
}
/**
 * Cell set of all cells of a mesh.
 *
 * This interface was referenced by `CommandList`'s JSON-Schema
 * via the `definition` "CellSetFromFile".
 */
export interface CellSetFromFile {
  command: "cellset.from_file";
  name: Name;
  mesh: Name;
}
/**
 * Isotropic hyperelastic Neo-Hookean material (fem.NeoHooke). Without a bulk modulus it needs the u-p-J formulation.
 *
 * This interface was referenced by `CommandList`'s JSON-Schema
 * via the `definition` "MaterialNeoHooke".
 */
export interface MaterialNeoHooke {
  command: "material.add";
  name: Name;
  model: "NeoHooke";
  parameters: {
    /**
     * Shear modulus
     */
    mu: number;
    /**
     * Bulk modulus. Without it, the material is incompressible and needs the u-p-J formulation.
     */
    bulk?: number;
  };
}
/**
 * Compressible isotropic hyperelastic Neo-Hookean material (fem.NeoHookeCompressible).
 *
 * This interface was referenced by `CommandList`'s JSON-Schema
 * via the `definition` "MaterialNeoHookeCompressible".
 */
export interface MaterialNeoHookeCompressible {
  command: "material.add";
  name: Name;
  model: "NeoHookeCompressible";
  parameters: {
    /**
     * Shear modulus
     */
    mu: number;
    /**
     * First Lamé parameter
     */
    lmbda: number;
  };
}
/**
 * Isotropic hyperelastic Mooney-Rivlin material (fem.Hyperelastic with fem.mooney_rivlin, needs tensortrax). The shear modulus is 2 (C10 + C01). Without a bulk modulus it needs the u-p-J formulation.
 *
 * This interface was referenced by `CommandList`'s JSON-Schema
 * via the `definition` "MaterialMooneyRivlin".
 */
export interface MaterialMooneyRivlin {
  command: "material.add";
  name: Name;
  model: "MooneyRivlin";
  parameters: {
    /**
     * Material parameter of the first invariant
     */
    C10: number;
    /**
     * Material parameter of the second invariant
     */
    C01: number;
    /**
     * Bulk modulus. Without it, the material is incompressible and needs the u-p-J formulation.
     */
    bulk?: number;
  };
}
/**
 * Linear-elastic material formulated for large deformations (fem.LinearElasticLargeStrain).
 *
 * This interface was referenced by `CommandList`'s JSON-Schema
 * via the `definition` "MaterialLinearElasticLargeStrain".
 */
export interface MaterialLinearElasticLargeStrain {
  command: "material.add";
  name: Name;
  model: "LinearElasticLargeStrain";
  parameters: {
    /**
     * Young's modulus
     */
    E: number;
    /**
     * Poisson's ratio
     */
    nu: number;
  };
}
/**
 * Assign a material and a formulation to a cell set. Each section becomes a solid body.
 *
 * This interface was referenced by `CommandList`'s JSON-Schema
 * via the `definition` "SectionAdd".
 */
export interface SectionAdd {
  command: "section.add";
  name: Name;
  cellset: Name;
  material: Name;
  /**
   * u: displacement field only. u-p-J: mixed fields (fem.FieldsMixed) for nearly incompressible materials.
   */
  formulation: "u" | "u-p-J";
  /**
   * Bulk modulus of the nearly incompressible formulation (required for u-p-J).
   */
  bulk?: number;
}
/**
 * Points of the merged mesh selected by a plane, by the coordinates of points or by point ids.
 *
 * This interface was referenced by `CommandList`'s JSON-Schema
 * via the `definition` "PointSetAdd".
 */
export interface PointSetAdd {
  command: "pointset.add";
  name: Name;
  select:
    | {
        axis: Axis;
        value: number;
        /**
         * Absolute tolerance (default 1e-8).
         */
        atol?: number;
      }
    | {
        /**
         * @minItems 1
         */
        points: [Coordinates, ...Coordinates[]];
        /**
         * Absolute tolerance (default 1e-8).
         */
        atol?: number;
      }
    | {
        /**
         * @minItems 1
         */
        ids: [number, ...number[]];
      };
}
/**
 * A control point that is not a node of the meshes, e.g. the center point of a multi-point constraint. It is a point set of one point: all control points form a mesh of vertices that is merged with the fields of the sections.
 *
 * This interface was referenced by `CommandList`'s JSON-Schema
 * via the `definition` "PointAdd".
 */
export interface PointAdd {
  command: "point.add";
  name: Name;
  coordinates: Coordinates;
}
/**
 * Prescribe displacement components of a point set (fem.Boundary).
 *
 * This interface was referenced by `CommandList`'s JSON-Schema
 * via the `definition` "BoundaryAdd".
 */
export interface BoundaryAdd {
  command: "boundary.add";
  name: Name;
  pointset: Name;
  /**
   * Constrained displacement components; all others are free.
   *
   * @minItems 1
   */
  constrained: [Axis, ...Axis[]];
  /**
   * Prescribed displacement of the constrained components (default 0).
   */
  value?: number;
}
/**
 * Uniaxial tension or compression along an axis (fem.dof.uniaxial). The end face at the largest coordinate moves.
 *
 * This interface was referenced by `CommandList`'s JSON-Schema
 * via the `definition` "LoadcaseUniaxial".
 */
export interface LoadcaseUniaxial {
  command: "loadcase.add";
  name: Name;
  type: "uniaxial";
  /**
   * Direction of the loading (default x).
   */
  axis?: "x" | "y" | "z";
  /**
   * Rigid end faces: no transversal displacements of the moving (and, without symmetry, the opposite) end faces.
   */
  clamped?: boolean;
  /**
   * Symmetry planes at x = 0, y = 0 and z = 0 (a quarter or an eighth of a model). Without them, the opposite end faces are at the smallest coordinates.
   */
  symmetry?: boolean;
}
/**
 * Equi-biaxial tension along two axes (fem.dof.biaxial). The end faces at the largest coordinates move.
 *
 * This interface was referenced by `CommandList`'s JSON-Schema
 * via the `definition` "LoadcaseBiaxial".
 */
export interface LoadcaseBiaxial {
  command: "loadcase.add";
  name: Name;
  type: "biaxial";
  /**
   * First direction of the loading (default x).
   */
  axis?: "x" | "y" | "z";
  /**
   * Second direction of the loading (default y).
   */
  second?: "x" | "y" | "z";
  /**
   * Rigid end faces: no transversal displacements of the moving (and, without symmetry, the opposite) end faces.
   */
  clamped?: boolean;
  /**
   * Symmetry planes at x = 0, y = 0 and z = 0 (a quarter or an eighth of a model). Without them, the opposite end faces are at the smallest coordinates.
   */
  symmetry?: boolean;
}
/**
 * Planar (pure shear) tension along an axis with a constant width along a second axis (fem.dof.biaxial without a move of the second axis).
 *
 * This interface was referenced by `CommandList`'s JSON-Schema
 * via the `definition` "LoadcasePlanar".
 */
export interface LoadcasePlanar {
  command: "loadcase.add";
  name: Name;
  type: "planar";
  /**
   * Direction of the loading (default x).
   */
  axis?: "x" | "y" | "z";
  /**
   * Direction of the constant width (default y).
   */
  second?: "x" | "y" | "z";
  /**
   * Rigid end faces: no transversal displacements of the moving (and, without symmetry, the opposite) end faces.
   */
  clamped?: boolean;
  /**
   * Symmetry planes at x = 0, y = 0 and z = 0 (a quarter or an eighth of a model). Without them, the opposite end faces are at the smallest coordinates.
   */
  symmetry?: boolean;
}
/**
 * Simple shear between the end faces normal to an axis (fem.dof.shear). The face at the largest coordinate moves along the shear direction.
 *
 * This interface was referenced by `CommandList`'s JSON-Schema
 * via the `definition` "LoadcaseShear".
 */
export interface LoadcaseShear {
  command: "loadcase.add";
  name: Name;
  type: "shear";
  /**
   * Direction of the shear (default x).
   */
  axis?: "x" | "y" | "z";
  /**
   * Normal of the sheared end faces (default y).
   */
  normal?: "x" | "y" | "z";
  /**
   * Displacement of the moving face along the normal, held during the shear (default 0).
   */
  compression?: number;
  /**
   * Symmetry plane normal to the third axis at its zero coordinate.
   */
  symmetry?: boolean;
}
/**
 * A step with all boundaries, optionally ramping items, each with its own values (fem.Step).
 *
 * This interface was referenced by `CommandList`'s JSON-Schema
 * via the `definition` "StepAdd".
 */
export interface StepAdd {
  command: "step.add";
  name: Name;
  /**
   * Sections whose solid bodies are items of the step (default: all).
   *
   * @minItems 1
   */
  sections?: [Name, ...Name[]];
  /**
   * Ramp the values of items with fem.math.linsteps([start, end], num), with the same number of increments for all items.
   */
  ramp?: {
    /**
     * Increments of the step.
     */
    num: number;
    /**
     * @minItems 1
     */
    items: [RampItem, ...RampItem[]];
  };
}
/**
 * A ramped item: a boundary (its value, e.g. a displacement) or a load case (the displacement of its moving faces).
 *
 * This interface was referenced by `CommandList`'s JSON-Schema
 * via the `definition` "RampItem".
 */
export interface RampItem {
  target: Name;
  start?: number;
  end: number;
}
/**
 * A job evaluating steps (fem.Job). With a curve boundary, the reaction force of this boundary is recorded over its displacement (fem.CharacteristicCurve).
 *
 * This interface was referenced by `CommandList`'s JSON-Schema
 * via the `definition` "JobAdd".
 */
export interface JobAdd {
  command: "job.add";
  name: Name;
  /**
   * @minItems 1
   */
  steps: [Name, ...Name[]];
  curve?: Name;
  /**
   * Retry a substep that does not converge with smaller increments (fem.CutbackPlugin).
   */
  cutback?: boolean;
  /**
   * Tolerance of the Newton-Raphson method: the norm of the residual forces relative to the reaction forces (default: the square root of the machine epsilon, 1.49e-8).
   */
  tol?: number;
}
