/* Generated from python/felupe_studio/commands.schema.json by
 * `npm run schema:types`. Do not edit by hand. The commands as written:
 * a number may be an expression of the parameters (#242). */

/**
 * This interface was referenced by `CommandList`'s JSON-Schema
 * via the `definition` "Command".
 */
export type Command =
  | ModelSettings
  | ParameterAdd
  | MeshImport
  | MeshScript
  | MeshGenerate
  | MeshMerge
  | CellSetFromTag
  | CellSetFromFile
  | MaterialAdd
  | SectionAdd
  | PointSetAdd
  | PointAdd
  | RigidAdd
  | FaceSetAdd
  | BoundaryAdd
  | LoadcaseAdd
  | SymmetryAdd
  | MpcAdd
  | ContactAdd
  | LoadAdd
  | PressureAdd
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
 * An own color of the mesh in the viewport (Color by: Meshes) and its legend, as #rrggbb, e.g. #7f8c8d; without it, the color of its position in the model. A property of the model, not of the script: the generated script is the same.
 *
 * This interface was referenced by `CommandList`'s JSON-Schema
 * via the `definition` "Color".
 */
export type Color = string;
/**
 * A mesh made by a mesh tool of FElupe (ADR 0019): a primitive like a line, a rectangle or a cube, or an operation on meshes made by tools before, like expand or revolve. Every tool is a definition below (the registry of the mesh tools): its label, its FElupe call, the dimensions of its points and its cells and its cell type (x-dimension), and its parameters. A mesh whose points and cells have the dimension of the model can have cell sets; a lower one is a construction mesh.
 *
 * This interface was referenced by `CommandList`'s JSON-Schema
 * via the `definition` "MeshGenerate".
 */
export type MeshGenerate =
  | MeshPoint
  | MeshLine
  | MeshRectangle
  | MeshCube
  | MeshExpand
  | MeshRevolve
  | MeshEmbed
  | MeshTranslate
  | MeshRotate
  | MeshMirror
  | MeshFillBetween
  | MeshAddRunouts;
/**
 * Add a material to the material library. Every model is a definition below (the material registry): its label, the FElupe class or tensortrax function, and its parameters with label, description, bounds and default.
 *
 * This interface was referenced by `CommandList`'s JSON-Schema
 * via the `definition` "MaterialAdd".
 */
export type MaterialAdd =
  | MaterialLinearElasticSmallStrain
  | MaterialLinearElasticLargeStrain
  | MaterialNeoHooke
  | MaterialNeoHookeCompressible
  | MaterialMooneyRivlin
  | MaterialYeoh
  | MaterialThirdOrderDeformation
  | MaterialOgden
  | MaterialArrudaBoyce
  | MaterialExtendedTube
  | MaterialLinearElastic
  | MaterialLinearElasticPlasticIsotropicHardening;
/**
 * This interface was referenced by `CommandList`'s JSON-Schema
 * via the `definition` "Axis".
 */
export type Axis = "x" | "y" | "z";
/**
 * A point on the axis of the cylinder (default: the origin).
 *
 * @minItems 3
 * @maxItems 3
 */
export type Coordinates = [number | string, number | string, number | string];
/**
 * The coordinates x, y and z of a point.
 *
 * @minItems 3
 * @maxItems 3
 *
 * This interface was referenced by `CommandList`'s JSON-Schema
 * via the `definition` "Coordinates".
 */
export type Coordinates1 = [number | string, number | string, number | string];
/**
 * The coordinates x, y and z of a point.
 *
 * @minItems 3
 * @maxItems 3
 */
export type Coordinates2 = [number | string, number | string, number | string];
/**
 * The coordinates x, y and z of a point.
 *
 * @minItems 3
 * @maxItems 3
 */
export type Coordinates3 = [number | string, number | string, number | string];
/**
 * The coordinates x, y and z of a point.
 *
 * @minItems 3
 * @maxItems 3
 */
export type Coordinates4 = [number | string, number | string, number | string];
/**
 * The coordinates x, y and z of a point.
 *
 * @minItems 3
 * @maxItems 3
 */
export type Coordinates5 = [number | string, number | string, number | string];
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
export type Coordinates6 = [number | string, number | string, number | string];

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
   * The type of the model: 3D (the default) or 2D, as plane strain (fem.FieldPlaneStrain, the forces per unit thickness) or axisymmetric (fem.FieldAxisymmetric: x is the axis of rotation, y the radius, the forces are the totals over the circumference). A 2D model has 2D cells (triangles and quads) and the components x and y.
   */
  analysis?: "3d" | "plane-strain" | "axisymmetric";
  /**
   * The precision of the model (ADR 0016): double (float64, the default) or single (float32: the regions, the fields, the stresses and the linear equation system in half the memory). The accuracy of single precision depends on the model: the results of a job have an estimate of the round-off of the forces relative to the reaction forces; stiff parts bonded to soft ones, e.g. steel to rubber, need double precision.
   */
  precision?: "double" | "single";
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
 * A parameter of the model: a number, e.g. a dimension or the number of cells of a mesh made by a script, or a derived parameter, an expression of other parameters (ADR 0021). The generated script defines it as a variable at its top.
 *
 * This interface was referenced by `CommandList`'s JSON-Schema
 * via the `definition` "ParameterAdd".
 */
export interface ParameterAdd {
  command: "parameter.add";
  name: Name;
  /**
   * The value of the parameter: a number, or an expression of other parameters (a derived parameter, ADR 0021), e.g. layers * height + (layers - 1) * sheet. A derived parameter is computed: it has no min, max and step.
   */
  value: number | string;
  /**
   * The physical quantity of the value, for its unit of the model settings (e.g. mm for a length). Without it, the value has no unit.
   */
  quantity?: "length" | "force" | "stress";
  /**
   * The smallest value.
   */
  min?: number;
  /**
   * The largest value.
   */
  max?: number;
  /**
   * The step of the value, e.g. of a slider.
   */
  step?: number;
  /**
   * The value is an integer, e.g. a number of layers or cells (default false); the range and the step are integers too.
   */
  integer?: boolean;
  /**
   * What the parameter is, in a few words, e.g. Radius of the disc.
   */
  description?: string;
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
    | "tetra"
    | "tetra10"
    | "hexahedron"
    | "hexahedron20"
    | "hexahedron27"
    | "triangle"
    | "triangle6"
    | "quad"
    | "quad8"
    | "quad9";
  /**
   * Factor of the coordinates of the points, e.g. 1000 for a mesh in m of a model in mm. The points are multiplied after reading, before the cell sets; point sets and points are in the scaled coordinates.
   */
  scale?: number | string;
  color?: Color;
}
/**
 * A mesh made by a Python script next to the project, e.g. with the mesh tools of FElupe. The script runs with the parameters of the model as variables and makes a variable mesh: a fem.Mesh, a fem.MeshContainer, a meshio.Mesh or a dict of names and meshes (one mesh object per item).
 *
 * This interface was referenced by `CommandList`'s JSON-Schema
 * via the `definition` "MeshScript".
 */
export interface MeshScript {
  command: "mesh.script";
  name: Name;
  /**
   * File name of the script, e.g. bushing.py.
   */
  file: string;
  /**
   * The parameters of the model that the script gets as variables (default: all).
   */
  parameters?: Name[];
  /**
   * The item of a dict of meshes, e.g. soft.
   */
  item?: string;
  /**
   * Name of an integer cell data array of a meshio.Mesh used to split the mesh into cell sets.
   */
  tag?: string;
  /**
   * Type of the solid cells to take, if the mesh has more than one.
   */
  cell_type?:
    | "tetra"
    | "tetra10"
    | "hexahedron"
    | "hexahedron20"
    | "hexahedron27"
    | "triangle"
    | "triangle6"
    | "quad"
    | "quad8"
    | "quad9";
  color?: Color;
}
/**
 * A point (fem.mesh.Point): one vertex with one coordinate.
 *
 * This interface was referenced by `CommandList`'s JSON-Schema
 * via the `definition` "MeshPoint".
 */
export interface MeshPoint {
  command: "mesh.generate";
  name: Name;
  tool: "Point";
  parameters: {
    /**
     * The coordinate of the point.
     */
    a: number | string;
  };
  color?: Color;
}
/**
 * A line along x (fem.mesh.Line): line cells between n points from a to b.
 *
 * This interface was referenced by `CommandList`'s JSON-Schema
 * via the `definition` "MeshLine".
 */
export interface MeshLine {
  command: "mesh.generate";
  name: Name;
  tool: "Line";
  parameters: {
    /**
     * The coordinate of the start.
     */
    a: number | string;
    /**
     * The coordinate of the end, larger than a.
     */
    b: number | string;
    /**
     * The number of points (at least 2).
     */
    n: number | string;
  };
  color?: Color;
}
/**
 * A rectangle in the xy-plane (fem.Rectangle): quads between the corners a and b, with n points per axis.
 *
 * This interface was referenced by `CommandList`'s JSON-Schema
 * via the `definition` "MeshRectangle".
 */
export interface MeshRectangle {
  command: "mesh.generate";
  name: Name;
  tool: "Rectangle";
  parameters: {
    /**
     * The corner with the smallest coordinates x and y.
     *
     * @minItems 2
     * @maxItems 2
     */
    a: [number | string, number | string];
    /**
     * The corner with the largest coordinates x and y.
     *
     * @minItems 2
     * @maxItems 2
     */
    b: [number | string, number | string];
    /**
     * The number of points per axis x and y (at least 2).
     *
     * @minItems 2
     * @maxItems 2
     */
    n: [number | string, number | string];
  };
  color?: Color;
}
/**
 * A cube (fem.Cube): hexahedrons between the corners a and b, with n points per axis.
 *
 * This interface was referenced by `CommandList`'s JSON-Schema
 * via the `definition` "MeshCube".
 */
export interface MeshCube {
  command: "mesh.generate";
  name: Name;
  tool: "Cube";
  parameters: {
    /**
     * The corner with the smallest coordinates x, y and z.
     *
     * @minItems 3
     * @maxItems 3
     */
    a: [number | string, number | string, number | string];
    /**
     * The corner with the largest coordinates x, y and z.
     *
     * @minItems 3
     * @maxItems 3
     */
    b: [number | string, number | string, number | string];
    /**
     * The number of points per axis x, y and z (at least 2).
     *
     * @minItems 3
     * @maxItems 3
     */
    n: [number | string, number | string, number | string];
  };
  color?: Color;
}
/**
 * Expand a mesh along a new axis (mesh.expand): a point to a line, a line to quads in the xy-plane, quads to hexahedrons along z, with n points over the length z.
 *
 * This interface was referenced by `CommandList`'s JSON-Schema
 * via the `definition` "MeshExpand".
 */
export interface MeshExpand {
  command: "mesh.generate";
  name: Name;
  tool: "expand";
  /**
   * The mesh that the tool takes: a mesh made by a tool before.
   *
   * @minItems 1
   * @maxItems 1
   */
  inputs: [Name];
  parameters: {
    /**
     * The number of points along the new axis (at least 2).
     */
    n: number | string;
    /**
     * The length along the new axis.
     */
    z: number | string;
  };
  color?: Color;
}
/**
 * Revolve a mesh about an axis (mesh.revolve): a point to a line, a line to quads, quads to hexahedrons, with n points over the angle phi.
 *
 * This interface was referenced by `CommandList`'s JSON-Schema
 * via the `definition` "MeshRevolve".
 */
export interface MeshRevolve {
  command: "mesh.generate";
  name: Name;
  tool: "revolve";
  /**
   * The mesh that the tool takes: a mesh made by a tool before.
   *
   * @minItems 1
   * @maxItems 1
   */
  inputs: [Name];
  parameters: {
    /**
     * The number of points over the angle (at least 2).
     */
    n: number | string;
    /**
     * The angle of revolution in degrees, at most 360.
     */
    phi: number | string;
    /**
     * The axis of revolution.
     */
    axis: "x" | "y" | "z";
  };
  color?: Color;
}
/**
 * Embed a mesh into one dimension more (embed, e.g. np.pad of the points): its points get the coordinate value of the new axis, its cells stay, e.g. a line into the plane y = value.
 *
 * This interface was referenced by `CommandList`'s JSON-Schema
 * via the `definition` "MeshEmbed".
 */
export interface MeshEmbed {
  command: "mesh.generate";
  name: Name;
  tool: "embed";
  /**
   * The mesh that the tool takes: a mesh made by a tool before.
   *
   * @minItems 1
   * @maxItems 1
   */
  inputs: [Name];
  parameters: {
    /**
     * The coordinate of the points on the new axis.
     */
    value: number | string;
  };
  color?: Color;
}
/**
 * Move a mesh along an axis (mesh.translate).
 *
 * This interface was referenced by `CommandList`'s JSON-Schema
 * via the `definition` "MeshTranslate".
 */
export interface MeshTranslate {
  command: "mesh.generate";
  name: Name;
  tool: "translate";
  /**
   * The mesh that the tool takes: a mesh made by a tool before.
   *
   * @minItems 1
   * @maxItems 1
   */
  inputs: [Name];
  parameters: {
    /**
     * The distance along the axis.
     */
    move: number | string;
    /**
     * The axis of the move.
     */
    axis: "x" | "y" | "z";
  };
  color?: Color;
}
/**
 * Rotate a mesh about an axis through a center (mesh.rotate); a mesh of 2D points turns about z.
 *
 * This interface was referenced by `CommandList`'s JSON-Schema
 * via the `definition` "MeshRotate".
 */
export interface MeshRotate {
  command: "mesh.generate";
  name: Name;
  tool: "rotate";
  /**
   * The mesh that the tool takes: a mesh made by a tool before.
   *
   * @minItems 1
   * @maxItems 1
   */
  inputs: [Name];
  parameters: {
    /**
     * The angle of rotation in degrees.
     */
    angle_deg: number | string;
    /**
     * The axis of rotation.
     */
    axis: "x" | "y" | "z";
    /**
     * The center of rotation, one coordinate per dimension of the points (default: the origin).
     *
     * @minItems 2
     * @maxItems 3
     */
    center?:
      | [number | string, number | string]
      | [number | string, number | string, number | string];
  };
  color?: Color;
}
/**
 * Mirror a mesh at a plane normal to an axis (mesh.mirror), at the coordinate value of the axis.
 *
 * This interface was referenced by `CommandList`'s JSON-Schema
 * via the `definition` "MeshMirror".
 */
export interface MeshMirror {
  command: "mesh.generate";
  name: Name;
  tool: "mirror";
  /**
   * The mesh that the tool takes: a mesh made by a tool before.
   *
   * @minItems 1
   * @maxItems 1
   */
  inputs: [Name];
  parameters: {
    /**
     * The axis normal to the plane of the mirror.
     */
    axis: "x" | "y" | "z";
    /**
     * The coordinate of the plane on the axis.
     */
    value: number | string;
  };
  color?: Color;
}
/**
 * Fill the cells between two meshes of the same cells and points (fem.mesh.fill_between): quads between two lines in a plane, hexahedrons between two quad meshes in space, with n points from the first mesh to the second.
 *
 * This interface was referenced by `CommandList`'s JSON-Schema
 * via the `definition` "MeshFillBetween".
 */
export interface MeshFillBetween {
  command: "mesh.generate";
  name: Name;
  tool: "fill_between";
  /**
   * The two meshes made by tools before, from the first to the second, of the same cell type and number of points, e.g. two lines embedded in a plane.
   *
   * @minItems 2
   * @maxItems 2
   */
  inputs: [Name, Name];
  parameters: {
    /**
     * The number of points from the first mesh to the second (at least 2).
     */
    n: number | string;
  };
  color?: Color;
}
/**
 * Add runouts to a mesh (mesh.add_runouts), e.g. the concave free surfaces of a rubber body between metal parts: the points move perpendicular to the axis by a relative amount, most at the centerpoint.
 *
 * This interface was referenced by `CommandList`'s JSON-Schema
 * via the `definition` "MeshAddRunouts".
 */
export interface MeshAddRunouts {
  command: "mesh.generate";
  name: Name;
  tool: "add_runouts";
  /**
   * The mesh that the tool takes: a mesh made by a tool before.
   *
   * @minItems 1
   * @maxItems 1
   */
  inputs: [Name];
  parameters: {
    /**
     * The relative amount of the runouts, one per coordinate perpendicular to the axis (one of 2D points, two of 3D points).
     *
     * @minItems 1
     * @maxItems 2
     */
    values: [number | string] | [number | string, number | string];
    /**
     * The axis of the runouts.
     */
    axis: "x" | "y" | "z";
    /**
     * The center of the runouts, one coordinate per dimension of the points (default: the origin).
     *
     * @minItems 2
     * @maxItems 3
     */
    centerpoint?:
      | [number | string, number | string]
      | [number | string, number | string, number | string];
    /**
     * The shape of the runouts: the higher, the steeper the transition (default 5).
     */
    exponent?: number | string;
    /**
     * Keep the shape of the ends, the runouts become indents.
     */
    normalize?: boolean;
  };
  color?: Color;
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
 * Linear-elastic material for small strains and small rotations (fem.LinearElastic): the stress of the symmetric part of the displacement gradient. Not for large rotations or large strains.
 *
 * This interface was referenced by `CommandList`'s JSON-Schema
 * via the `definition` "MaterialLinearElasticSmallStrain".
 */
export interface MaterialLinearElasticSmallStrain {
  command: "material.add";
  name: Name;
  model: "LinearElasticSmallStrain";
  parameters: {
    /**
     * Young's modulus
     */
    E: number | string;
    /**
     * Poisson's ratio
     */
    nu: number | string;
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
    E: number | string;
    /**
     * Poisson's ratio
     */
    nu: number | string;
  };
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
    mu: number | string;
    /**
     * Bulk modulus. Without it, the material is incompressible and needs the u-p-J formulation.
     */
    bulk?: number | string;
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
    mu: number | string;
    /**
     * First Lamé parameter
     */
    lmbda: number | string;
  };
}
/**
 * Isotropic hyperelastic Mooney-Rivlin material (fem.Hyperelastic with fem.mooney_rivlin). The shear modulus is 2 (C10 + C01). Without a bulk modulus it needs the u-p-J formulation.
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
    C10: number | string;
    /**
     * Material parameter of the second invariant
     */
    C01: number | string;
    /**
     * Bulk modulus. Without it, the material is incompressible and needs the u-p-J formulation.
     */
    bulk?: number | string;
  };
}
/**
 * Isotropic hyperelastic Yeoh material (fem.Hyperelastic with fem.yeoh): a cubic polynomial of the first invariant. The shear modulus is 2 C10. Without a bulk modulus it needs the u-p-J formulation.
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
    C10: number | string;
    /**
     * Material parameter of the quadratic term of the first invariant
     */
    C20: number | string;
    /**
     * Material parameter of the cubic term of the first invariant
     */
    C30: number | string;
    /**
     * Bulk modulus. Without it, the material is incompressible and needs the u-p-J formulation.
     */
    bulk?: number | string;
  };
}
/**
 * Isotropic hyperelastic third-order deformation material (fem.Hyperelastic with fem.third_order_deformation): terms of the first and second invariant up to the third order. The shear modulus is 2 (C10 + C01). Without a bulk modulus it needs the u-p-J formulation.
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
    C10: number | string;
    /**
     * Material parameter of the linear term of the second invariant
     */
    C01: number | string;
    /**
     * Material parameter of the mixed term of the first and second invariant
     */
    C11: number | string;
    /**
     * Material parameter of the quadratic term of the first invariant
     */
    C20: number | string;
    /**
     * Material parameter of the cubic term of the first invariant
     */
    C30: number | string;
    /**
     * Bulk modulus. Without it, the material is incompressible and needs the u-p-J formulation.
     */
    bulk?: number | string;
  };
}
/**
 * Isotropic hyperelastic Ogden material (fem.Hyperelastic with fem.ogden): up to three terms of the principal stretches, each with a modulus μi and an exponent αi. The shear modulus is the sum of the moduli. Without a bulk modulus it needs the u-p-J formulation.
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
    mu:
      | [number | string]
      | [number | string, number | string]
      | [number | string, number | string, number | string];
    /**
     * Stretch exponents of the terms, one per modulus, not zero
     *
     * @minItems 1
     * @maxItems 3
     */
    alpha:
      | [number | string]
      | [number | string, number | string]
      | [number | string, number | string, number | string];
    /**
     * Bulk modulus. Without it, the material is incompressible and needs the u-p-J formulation.
     */
    bulk?: number | string;
  };
}
/**
 * Isotropic hyperelastic Arruda-Boyce material, the eight-chain model (fem.Hyperelastic with fem.arruda_boyce). The chains lock at the limiting stretch. Without a bulk modulus it needs the u-p-J formulation.
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
    C1: number | string;
    /**
     * Limiting stretch at which the chains are locked
     */
    limit: number | string;
    /**
     * Bulk modulus. Without it, the material is incompressible and needs the u-p-J formulation.
     */
    bulk?: number | string;
  };
}
/**
 * Isotropic hyperelastic extended tube material of Kaliske and Heinrich (fem.Hyperelastic with fem.extended_tube): a cross-link and a tube constraint contribution. The shear modulus is Gc + Ge. Without a bulk modulus it needs the u-p-J formulation.
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
    Gc: number | string;
    /**
     * Finite extensibility of the chains
     */
    delta: number | string;
    /**
     * Constraint (tube) modulus
     */
    Ge: number | string;
    /**
     * Exponent of the tube constraint
     */
    beta: number | string;
    /**
     * Bulk modulus. Without it, the material is incompressible and needs the u-p-J formulation.
     */
    bulk?: number | string;
  };
}
/**
 * Linear-elastic material in terms of a strain (fem.MaterialStrain with fem.linear_elastic) in a framework: small strain or Total Lagrange. It needs the displacement formulation u.
 *
 * This interface was referenced by `CommandList`'s JSON-Schema
 * via the `definition` "MaterialLinearElastic".
 */
export interface MaterialLinearElastic {
  command: "material.add";
  name: Name;
  model: "LinearElastic";
  /**
   * The framework of the strain and the stress of the material (fem.MaterialStrain): small-strain (the symmetric part of the displacement gradient and the Cauchy stress), total-lagrange (the Green-Lagrange strain and the second Piola-Kirchhoff stress, for large rotations with small strains), co-rotational (the Biot strain of the right stretch tensor and the Biot stress) or seth-hill (a Seth-Hill strain with the strain_exponent m, e.g. 0 for the logarithmic Hencky strain). The frameworks of large deformations have exact tangents.
   */
  framework?: "small-strain" | "total-lagrange" | "co-rotational" | "seth-hill";
  /**
   * The strain exponent m of the Seth-Hill strain (only, and required, with the framework seth-hill): 0 for the logarithmic (Hencky) strain, 1 for the Biot strain (like co-rotational), 2 for the Green-Lagrange strain (like total-lagrange), -2 for the Euler-Almansi strain.
   */
  strain_exponent?: number | string;
  parameters: {
    /**
     * Young's modulus (converted with ν into the Lamé constants λ and μ)
     */
    E: number | string;
    /**
     * Poisson's ratio
     */
    nu: number | string;
  };
}
/**
 * Linear-elastic-plastic material with linear isotropic hardening (fem.MaterialStrain with fem.linear_elastic_plastic_isotropic_hardening, the return mapping algorithm of von Mises plasticity) in a framework: small strain or Total Lagrange. Its state variables are the equivalent plastic strain and the plastic strain tensor. It needs the displacement formulation u.
 *
 * This interface was referenced by `CommandList`'s JSON-Schema
 * via the `definition` "MaterialLinearElasticPlasticIsotropicHardening".
 */
export interface MaterialLinearElasticPlasticIsotropicHardening {
  command: "material.add";
  name: Name;
  model: "LinearElasticPlasticIsotropicHardening";
  /**
   * The framework of the strain and the stress of the material (fem.MaterialStrain): small-strain (the symmetric part of the displacement gradient and the Cauchy stress), total-lagrange (the Green-Lagrange strain and the second Piola-Kirchhoff stress, for large rotations with small strains), co-rotational (the Biot strain of the right stretch tensor and the Biot stress) or seth-hill (a Seth-Hill strain with the strain_exponent m, e.g. 0 for the logarithmic Hencky strain). The frameworks of large deformations have exact tangents.
   */
  framework?: "small-strain" | "total-lagrange" | "co-rotational" | "seth-hill";
  /**
   * The strain exponent m of the Seth-Hill strain (only, and required, with the framework seth-hill): 0 for the logarithmic (Hencky) strain, 1 for the Biot strain (like co-rotational), 2 for the Green-Lagrange strain (like total-lagrange), -2 for the Euler-Almansi strain.
   */
  strain_exponent?: number | string;
  parameters: {
    /**
     * Young's modulus (converted with ν into the Lamé constants λ and μ)
     */
    E: number | string;
    /**
     * Poisson's ratio
     */
    nu: number | string;
    /**
     * Initial yield stress (uniaxial)
     */
    sigma_y: number | string;
    /**
     * Isotropic hardening modulus: the yield stress grows by K times the equivalent plastic strain
     */
    K: number | string;
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
   * u: displacement field only. u-p-J: mixed fields (fem.FieldsMixed) for nearly incompressible materials. u-isochoric: displacement field only, with a material without a bulk modulus whose strain energy has no volumetric part, e.g. air as a third medium between the parts of a model that come into contact.
   */
  formulation: "u" | "u-p-J" | "u-isochoric";
  /**
   * Bulk modulus of the nearly incompressible formulation (required for u-p-J).
   */
  bulk?: number | string;
  /**
   * The volumetric part U(J) of the strain energy of the u-p-J formulation with the bulk modulus K (fem.NearlyIncompressible): volume-ratio K/2 (J - 1)², stretch 9K/2 (J^(1/3) - 1)² or log K/2 ln(J)².
   */
  volumetric?: "volume-ratio" | "stretch" | "log";
}
/**
 * Points of the merged mesh selected by a plane, at a bound of the meshes, on a cylinder, on the outer surface, of the cells of a section, by the coordinates of points or by point ids.
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
        value: number | string;
        /**
         * Absolute tolerance (default 1e-8).
         */
        atol?: number | string;
      }
    | {
        /**
         * The smallest (min) or the largest (max) coordinate.
         */
        bound: "min" | "max";
        axis: Axis;
        /**
         * Absolute tolerance (default 1e-8).
         */
        atol?: number | string;
      }
    | {
        /**
         * The radius of the cylinder.
         */
        radius: number | string;
        /**
         * The direction of the axis of the cylinder.
         */
        axis: "x" | "y" | "z";
        center?: Coordinates;
        /**
         * Absolute tolerance (default 1e-8).
         */
        atol?: number | string;
      }
    | {
        surface: true;
      }
    | {
        /**
         * @minItems 1
         */
        points: [Coordinates1, ...Coordinates1[]];
        /**
         * Absolute tolerance (default 1e-8).
         */
        atol?: number | string;
      }
    | {
        section: Name;
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
  coordinates: Coordinates2;
}
/**
 * A rigid surface (#219): a reference point with a plane or a cylinder. The reference point is a vertex like the control points and a point set of one point, so boundaries move the surface; it does not rotate. Contacts connect points of the model to it.
 *
 * This interface was referenced by `CommandList`'s JSON-Schema
 * via the `definition` "RigidAdd".
 */
export interface RigidAdd {
  command: "rigid.add";
  name: Name;
  coordinates: Coordinates3;
  shape:
    | {
        normal: Coordinates4;
      }
    | {
        /**
         * The radius of the cylinder.
         */
        radius: number | string;
        axis: Coordinates5;
        /**
         * The points are inside the cylinder (a tube around them), else outside (a roller).
         */
        inside?: boolean;
      };
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
        value: number | string;
        /**
         * Absolute tolerance of the coordinates of the points (default 1e-8).
         */
        atol?: number | string;
      }
    | {
        /**
         * @minItems 1
         */
        centers: [Coordinates1, ...Coordinates1[]];
        /**
         * Absolute tolerance of the centers (default 1e-6 of the size of the section).
         */
        atol?: number | string;
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
   * Prescribed displacement of the constrained components (default 0): one number for all of them, or one number per constrained component in the order x, y, z (e.g. a point set that moves diagonally); a rotation in rad at a rotation point.
   *
   * @minItems 1
   * @maxItems 3
   */
  value?:
    | number
    | string
    | [number | string]
    | [number | string, number | string]
    | [number | string, number | string, number | string];
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
  compression?: number | string;
  /**
   * Symmetry plane normal to the third axis at its zero coordinate.
   */
  symmetry?: boolean;
}
/**
 * Symmetry planes normal to x, y or z (fem.dof.symmetry): on a plane, the displacement component normal to it is zero and the components in the plane are free. A half, a quarter or an eighth of a model, without a load case.
 *
 * This interface was referenced by `CommandList`'s JSON-Schema
 * via the `definition` "SymmetryAdd".
 */
export interface SymmetryAdd {
  command: "symmetry.add";
  name: Name;
  /**
   * The normals of the symmetry planes.
   *
   * @minItems 1
   */
  axes: [Axis, ...Axis[]];
  /**
   * Coordinate of the plane normal to x (default 0), only with x in axes.
   */
  x?: number | string;
  /**
   * Coordinate of the plane normal to y (default 0), only with y in axes.
   */
  y?: number | string;
  /**
   * Coordinate of the plane normal to z (default 0), only with z in axes.
   */
  z?: number | string;
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
  multiplier?: number | string;
  /**
   * Name of an object, unique within the command list. Used as a Python identifier in the generated script; at most 24 characters keep the script readable.
   */
  rotation?: string;
}
/**
 * A contact of points with a rigid surface (#220): fem.ContactRigidPlane or fem.ContactRigidCylinder, an item of the steps like the constraints. The penalty of the contact is a factor of the mean stiffness of the solid bodies at the points.
 *
 * This interface was referenced by `CommandList`'s JSON-Schema
 * via the `definition` "ContactAdd".
 */
export interface ContactAdd {
  command: "contact.add";
  name: Name;
  /**
   * Name of an object, unique within the command list. Used as a Python identifier in the generated script; at most 24 characters keep the script readable.
   */
  points: string;
  /**
   * Name of an object, unique within the command list. Used as a Python identifier in the generated script; at most 24 characters keep the script readable.
   */
  surface: string;
  /**
   * The Coulomb friction coefficient (default 0, without friction).
   */
  friction?: number | string;
  /**
   * The factor of the penalty of the contact, times the mean stiffness of the solid bodies at the points (default 1).
   */
  multiplier?: number | string;
  /**
   * The allowable elastic slip of sticking points (default none: a constant tangential penalty), e.g. 0.5 % to 1 % of the size of a cell.
   */
  elastic_slip?: number | string;
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
  force: Coordinates6;
}
/**
 * A pressure on the faces of a face set (fem.SolidBodyPressure), an item of the steps: a force per deformed area, normal to the faces. A positive pressure pushes onto the faces, a negative one pulls. A ramp of a step scales the pressure.
 *
 * This interface was referenced by `CommandList`'s JSON-Schema
 * via the `definition` "PressureAdd".
 */
export interface PressureAdd {
  command: "pressure.add";
  name: Name;
  /**
   * Name of an object, unique within the command list. Used as a Python identifier in the generated script; at most 24 characters keep the script readable.
   */
  faces: string;
  /**
   * The pressure; positive pushes onto the faces.
   */
  pressure: number | string;
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
   * Point loads and pressures that are items of the step (default: all).
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
    num: number | string;
    /**
     * The ramped items, each with its own values.
     *
     * @minItems 1
     */
    items: [RampItem, ...RampItem[]];
  };
}
/**
 * A ramped item: a boundary (its value, e.g. a displacement, or one value per constrained component), a load case (the displacement of its moving faces), a point load (a factor of its force) or a pressure (a factor of its pressure).
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
   * Value at the start of the step (default 0); of a boundary with several constrained components one number for all of them, or one per component in the order x, y, z.
   *
   * @minItems 1
   * @maxItems 3
   */
  start?:
    | number
    | string
    | [number | string]
    | [number | string, number | string]
    | [number | string, number | string, number | string];
  /**
   * Value at the end of the step; of a boundary with several constrained components one number for all of them, or one per component in the order x, y, z.
   *
   * @minItems 1
   * @maxItems 3
   */
  end:
    | number
    | string
    | [number | string]
    | [number | string, number | string]
    | [number | string, number | string, number | string];
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
   * Steps evaluated one after another, in this order; a step may be repeated, e.g. load, unload, load.
   *
   * @minItems 1
   */
  steps: [Name, ...Name[]];
  /**
   * Name of an object, unique within the command list. Used as a Python identifier in the generated script; at most 24 characters keep the script readable.
   */
  curve?: string;
  /**
   * Tolerance of the Newton-Raphson method: the norm of the residual forces relative to a reference force, the reaction forces or the forces between the items (e.g. of a pressure on a solid body), if they are larger (default 0.01, like commercial codes).
   */
  tol?: number | string;
  /**
   * The maximum number of Newton iterations of a substep (default 16).
   */
  maxiter?: number | string;
  /**
   * The linear solver of the Newton iterations (Job.evaluate(solver=...)); without it, SuperLU of FElupe.
   */
  solver?: {
    /**
     * SuperLU of FElupe (fem.solve.SuperLUSolver, the default), spsolve of SciPy (the default of FElupe before v12), PARDISO of Intel oneMKL (pypardiso.spsolve: multithreaded, only in Python on the computer with the package pypardiso, #308) or an iterative method of SciPy.
     */
    type: "superlu" | "spsolve" | "pardiso" | "iterative";
    /**
     * The iterative method of scipy.sparse.linalg: minres (symmetric, also indefinite), cg (symmetric positive definite), gmres or bicgstab.
     */
    method?: "minres" | "cg" | "gmres" | "bicgstab";
    /**
     * Relative tolerance of the iterative method, relative to the norm of the residual forces (default: the tolerance of the job / 100).
     */
    rtol?: number | string;
    /**
     * The maximum number of iterations of the iterative method (default of SciPy).
     */
    maxiter?: number | string;
    /**
     * The precision of the linear equation system of a direct solver: double (float64, the default) or single (float32: the matrix, the right-hand side and the factorization, the increment back in double precision). The model, the residual forces and the results stay in double precision; the factorization needs half the memory, and the Newton-Raphson method a few more iterations at tight tolerances. PARDISO in single precision needs a PyPardiso that factorizes in float32.
     */
    precision?: "double" | "single";
  };
  /**
   * Retry a substep that does not converge with smaller increments (fem.CutbackPlugin); without a value, a parameter has the default of FElupe.
   */
  cutback?: {
    /**
     * The factor by which the increment is reduced after a failed attempt (default 0.5).
     */
    factor?: number | string;
    /**
     * The maximum number of successive cutbacks of the increment (default 10): the smallest increment of a substep is factor ** max_cutbacks.
     */
    max_cutbacks?: number | string;
    /**
     * The factor by which the increment is increased after a converged increment (default 2.0); 1 keeps the increment.
     */
    growth?: number | string;
  };
}
