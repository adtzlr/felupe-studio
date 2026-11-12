/* Generated from python/felupe_studio/commands.schema.json by
 * `npm run schema:types`. Do not edit by hand. */

/**
 * This interface was referenced by `CommandList`'s JSON-Schema
 * via the `definition` "Command".
 */
export type Command =
  | ModelSettings
  | MeshImport
  | MeshMerge
  | CellSetFromTag
  | CellSetFromFile
  | MaterialAdd
  | SectionAdd
  | PointSetAdd
  | PointAdd
  | FaceSetAdd
  | BoundaryAdd
  | LoadcaseAdd
  | MpcAdd
  | LoadAdd
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
  | MaterialYeoh
  | MaterialThirdOrderDeformation
  | MaterialOgden
  | MaterialArrudaBoyce
  | MaterialExtendedTube
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
 * The coordinates x, y and z of a point.
 *
 * @minItems 3
 * @maxItems 3
 */
export type Coordinates1 = [number, number, number];
/**
 * A load case of FElupe (fem.dof) on the merged field: the boundaries of a standard test. It is referenced like a boundary: a step ramps its moving end faces, a job records the reaction force of its (first) moving end face.
 *
 * This interface was referenced by `CommandList`'s JSON-Schema
 * via the `definition` "LoadcaseAdd".
 */
export type LoadcaseAdd =
  LoadcaseUniaxial | LoadcaseBiaxial | LoadcasePlanar | LoadcaseShear;
/**
 * The coordinates x, y and z of a point.
 *
 * @minItems 3
 * @maxItems 3
 */
export type Coordinates2 = [number, number, number];

/**
 * A list of FElupe Studio commands. Objects are created by commands and referenced by their names.
 */
export interface CommandList {
  /**
   * Version of this schema.
   */
  schema_version: 3;
  commands: Command[];
}
/**
 * The settings of the model, at most once. The units say what the numbers mean: FElupe has no units, nothing is converted.
 *
 * This interface was referenced by `CommandList`'s JSON-Schema
 * via the `definition` "ModelSettings".
 */
export interface ModelSettings {
  command: "model.settings";
  name: Name;
  /**
   * The units of lengths and forces, which give the units of the stresses (e.g. mm and N give MPa). Without units, the numbers have none.
   */
  units?: {
    /**
     * Unit of the coordinates and the displacements.
     */
    length: "mm" | "m";
    /**
     * Unit of the forces.
     */
    force: "N" | "kN";
  };
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
  /**
   * Factor of the coordinates of the points, e.g. 1000 for a mesh in m of a model in mm. The points are multiplied after reading, before the cell sets; point sets and points are in the scaled coordinates.
   */
  scale?: number;
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
  /**
   * Value of the tag of the cells, e.g. 1.
   */
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
 * Isotropic hyperelastic Yeoh material (fem.Hyperelastic with fem.yeoh, needs tensortrax): a cubic polynomial of the first invariant. The shear modulus is 2 C10. Without a bulk modulus it needs the u-p-J formulation.
 *
 * This interface was referenced by `CommandList`'s JSON-Schema
 * via the `definition` "MaterialYeoh".
 */
export interface MaterialYeoh {
  command: "material.add";
  name: Name;
  model: "Yeoh";
  parameters: {
    /**
     * Material parameter of the linear term of the first invariant
     */
    C10: number;
    /**
     * Material parameter of the quadratic term of the first invariant
     */
    C20: number;
    /**
     * Material parameter of the cubic term of the first invariant
     */
    C30: number;
    /**
     * Bulk modulus. Without it, the material is incompressible and needs the u-p-J formulation.
     */
    bulk?: number;
  };
}
/**
 * Isotropic hyperelastic third-order deformation material (fem.Hyperelastic with fem.third_order_deformation, needs tensortrax): terms of the first and second invariant up to the third order. The shear modulus is 2 (C10 + C01). Without a bulk modulus it needs the u-p-J formulation.
 *
 * This interface was referenced by `CommandList`'s JSON-Schema
 * via the `definition` "MaterialThirdOrderDeformation".
 */
export interface MaterialThirdOrderDeformation {
  command: "material.add";
  name: Name;
  model: "ThirdOrderDeformation";
  parameters: {
    /**
     * Material parameter of the linear term of the first invariant
     */
    C10: number;
    /**
     * Material parameter of the linear term of the second invariant
     */
    C01: number;
    /**
     * Material parameter of the mixed term of the first and second invariant
     */
    C11: number;
    /**
     * Material parameter of the quadratic term of the first invariant
     */
    C20: number;
    /**
     * Material parameter of the cubic term of the first invariant
     */
    C30: number;
    /**
     * Bulk modulus. Without it, the material is incompressible and needs the u-p-J formulation.
     */
    bulk?: number;
  };
}
/**
 * Isotropic hyperelastic Ogden material (fem.Hyperelastic with fem.ogden, needs tensortrax): up to three terms of the principal stretches, each with a modulus μi and an exponent αi. The shear modulus is the sum of the moduli. Without a bulk modulus it needs the u-p-J formulation.
 *
 * This interface was referenced by `CommandList`'s JSON-Schema
 * via the `definition` "MaterialOgden".
 */
export interface MaterialOgden {
  command: "material.add";
  name: Name;
  model: "Ogden";
  parameters: {
    /**
     * Moduli of the terms, one to three, as many as exponents
     *
     * @minItems 1
     * @maxItems 3
     */
    mu: [number] | [number, number] | [number, number, number];
    /**
     * Stretch exponents of the terms, one per modulus, not zero
     *
     * @minItems 1
     * @maxItems 3
     */
    alpha: [number] | [number, number] | [number, number, number];
    /**
     * Bulk modulus. Without it, the material is incompressible and needs the u-p-J formulation.
     */
    bulk?: number;
  };
}
/**
 * Isotropic hyperelastic Arruda-Boyce material, the eight-chain model (fem.Hyperelastic with fem.arruda_boyce, needs tensortrax). The chains lock at the limiting stretch. Without a bulk modulus it needs the u-p-J formulation.
 *
 * This interface was referenced by `CommandList`'s JSON-Schema
 * via the `definition` "MaterialArrudaBoyce".
 */
export interface MaterialArrudaBoyce {
  command: "material.add";
  name: Name;
  model: "ArrudaBoyce";
  parameters: {
    /**
     * Shear modulus of the chain network (the initial shear modulus for a large limiting stretch)
     */
    C1: number;
    /**
     * Limiting stretch at which the chains are locked
     */
    limit: number;
    /**
     * Bulk modulus. Without it, the material is incompressible and needs the u-p-J formulation.
     */
    bulk?: number;
  };
}
/**
 * Isotropic hyperelastic extended tube material of Kaliske and Heinrich (fem.Hyperelastic with fem.extended_tube, needs tensortrax): a cross-link and a tube constraint contribution. The shear modulus is Gc + Ge. Without a bulk modulus it needs the u-p-J formulation.
 *
 * This interface was referenced by `CommandList`'s JSON-Schema
 * via the `definition` "MaterialExtendedTube".
 */
export interface MaterialExtendedTube {
  command: "material.add";
  name: Name;
  model: "ExtendedTube";
  parameters: {
    /**
     * Cross-link modulus
     */
    Gc: number;
    /**
     * Finite extensibility of the chains
     */
    delta: number;
    /**
     * Constraint (tube) modulus
     */
    Ge: number;
    /**
     * Exponent of the tube constraint
     */
    beta: number;
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
  /**
   * The volumetric part U(J) of the strain energy of the u-p-J formulation with the bulk modulus K (fem.NearlyIncompressible): volume-ratio K/2 (J - 1)², stretch 9K/2 (J^(1/3) - 1)² or log K/2 ln(J)².
   */
  volumetric?: "volume-ratio" | "stretch" | "log";
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
  coordinates: Coordinates1;
}
/**
 * Faces of the boundary of a section, e.g. for a pressure: on a plane, or the faces with the given centers (picked in the viewport). The script makes a boundary region of the faces and a field of it, linked to the merged field. Faces of tetrahedrons have no boundary region in FElupe 12.
 *
 * This interface was referenced by `CommandList`'s JSON-Schema
 * via the `definition` "FaceSetAdd".
 */
export interface FaceSetAdd {
  command: "faceset.add";
  name: Name;
  /**
   * Name of an object, unique within the command list. Used as a Python identifier in the generated script; at most 24 characters keep the script readable.
   */
  section: string;
  select:
    | {
        axis: Axis;
        value: number;
        /**
         * Absolute tolerance of the coordinates of the points (default 1e-8).
         */
        atol?: number;
      }
    | {
        /**
         * @minItems 1
         */
        centers: [Coordinates, ...Coordinates[]];
        /**
         * Absolute tolerance of the centers (default 1e-6 of the size of the section).
         */
        atol?: number;
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
   * Prescribed displacement of the constrained components (default 0); a rotation in rad at a rotation point.
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
 * A multi-point constraint (fem.MultiPointConstraint): the points of a point set follow a center point rigidly, connected by a penalty. With a rotation point, they also rotate about the center point.
 *
 * This interface was referenced by `CommandList`'s JSON-Schema
 * via the `definition` "MpcAdd".
 */
export interface MpcAdd {
  command: "mpc.add";
  name: Name;
  /**
   * Name of an object, unique within the command list. Used as a Python identifier in the generated script; at most 24 characters keep the script readable.
   */
  points: string;
  /**
   * Name of an object, unique within the command list. Used as a Python identifier in the generated script; at most 24 characters keep the script readable.
   */
  center: string;
  /**
   * The connected components (skip the others). All of them with a rotation point.
   *
   * @minItems 1
   */
  constrained: [Axis, ...Axis[]];
  /**
   * The penalty of the relative displacements (default 1000).
   */
  multiplier?: number;
  /**
   * Name of an object, unique within the command list. Used as a Python identifier in the generated script; at most 24 characters keep the script readable.
   */
  rotation?: string;
}
/**
 * A point load (fem.PointLoad): a force at every point of a point set or at a control point, an item of the steps. A ramp of a step scales the force.
 *
 * This interface was referenced by `CommandList`'s JSON-Schema
 * via the `definition` "LoadAdd".
 */
export interface LoadAdd {
  command: "load.add";
  name: Name;
  /**
   * Name of an object, unique within the command list. Used as a Python identifier in the generated script; at most 24 characters keep the script readable.
   */
  points: string;
  force: Coordinates2;
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
   * Multi-point constraints that are items of the step (default: all).
   *
   * @minItems 1
   */
  constraints?: [Name, ...Name[]];
  /**
   * Point loads that are items of the step (default: all).
   *
   * @minItems 1
   */
  loads?: [Name, ...Name[]];
  /**
   * Ramp the values of items with fem.math.linsteps([start, end], num), with the same number of increments for all items.
   */
  ramp?: {
    /**
     * Increments of the step.
     */
    num: number;
    /**
     * The ramped items, each with its own values.
     *
     * @minItems 1
     */
    items: [RampItem, ...RampItem[]];
  };
}
/**
 * A ramped item: a boundary (its value, e.g. a displacement), a load case (the displacement of its moving faces) or a point load (a factor of its force).
 *
 * This interface was referenced by `CommandList`'s JSON-Schema
 * via the `definition` "RampItem".
 */
export interface RampItem {
  /**
   * Name of an object, unique within the command list. Used as a Python identifier in the generated script; at most 24 characters keep the script readable.
   */
  target: string;
  /**
   * Value at the start of the step (default 0).
   */
  start?: number;
  /**
   * Value at the end of the step.
   */
  end: number;
}
/**
 * A job evaluating steps one after another (fem.Job). With a curve, the force-displacement curve of a boundary, a load case or a point load is recorded (fem.CharacteristicCurve).
 *
 * This interface was referenced by `CommandList`'s JSON-Schema
 * via the `definition` "JobAdd".
 */
export interface JobAdd {
  command: "job.add";
  name: Name;
  /**
   * Steps evaluated one after another.
   *
   * @minItems 1
   */
  steps: [Name, ...Name[]];
  /**
   * Name of an object, unique within the command list. Used as a Python identifier in the generated script; at most 24 characters keep the script readable.
   */
  curve?: string;
  /**
   * Tolerance of the Newton-Raphson method: the norm of the residual forces relative to the reaction forces (default: the square root of the machine epsilon, 1.49e-8).
   */
  tol?: number;
  /**
   * The maximum number of Newton iterations of a substep (default 16).
   */
  maxiter?: number;
  /**
   * Retry a substep that does not converge with smaller increments (fem.CutbackPlugin); without a value, a parameter has the default of FElupe.
   */
  cutback?: {
    /**
     * The factor by which the increment is reduced after a failed attempt (default 0.5).
     */
    factor?: number;
    /**
     * The maximum number of successive cutbacks of the increment (default 10): the smallest increment of a substep is factor ** max_cutbacks.
     */
    max_cutbacks?: number;
    /**
     * The factor by which the increment is increased after a converged increment (default 2.0); 1 keeps the increment.
     */
    growth?: number;
  };
}
