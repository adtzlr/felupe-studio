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
  | BoundaryAdd
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
 * Add a material to the material library.
 *
 * This interface was referenced by `CommandList`'s JSON-Schema
 * via the `definition` "MaterialAdd".
 */
export type MaterialAdd =
  | MaterialNeoHooke
  | MaterialNeoHookeCompressible
  | MaterialLinearElasticLargeStrain;
/**
 * This interface was referenced by `CommandList`'s JSON-Schema
 * via the `definition` "Axis".
 */
export type Axis = "x" | "y" | "z";

/**
 * A list of FElupe Studio commands. Objects are created by commands and referenced by their names.
 */
export interface CommandList {
  /**
   * Version of this schema.
   */
  schema_version: 1;
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
    mu: number;
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
    mu: number;
    lmbda: number;
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
    E: number;
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
 * Points of the merged mesh selected by a coordinate or by point ids.
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
        ids: [number, ...number[]];
      };
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
 * A step with all boundaries, optionally ramping one boundary (fem.Step).
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
   * Ramp the value of a boundary with fem.math.linsteps([start, end], num).
   */
  ramp?: {
    boundary: Name;
    start?: number;
    end: number;
    num: number;
  };
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
}
