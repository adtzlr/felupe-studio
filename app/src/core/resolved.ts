/* Generated from python/felupe_studio/commands.schema.json by
 * `npm run schema:types`. Do not edit by hand. The commands with the values of
 * their expressions (#242): numbers only. */

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
  | MaterialScript
  | SectionAdd
  | PointSetAdd
  | PointAdd
  | RigidAdd
  | FaceSetAdd
  | BoundaryAdd
  | LoadcaseAdd
  | SymmetryAdd
  | MpcAdd
  | CartesianAdd
  | CylindricalAdd
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
 * An own color of a mesh, a cell set or a section in the viewport (Color by: Meshes, Cell sets or Sections) and its legend, as #rrggbb, e.g. #7f8c8d; without it, the color of its position among the objects of its kind in the model. A property of the model, not of the script: the generated script is the same.
 *
 * This interface was referenced by `CommandList`'s JSON-Schema
 * via the `definition` "Color".
 */
export type Color = string;
/**
 * A mesh made by a mesh tool of FElupe (ADR 0019): a primitive like a line, a rectangle or a cube, or an operation on meshes of the model before (made by tools, of files or of scripts), like expand or revolve. Every tool is a definition below (the registry of the mesh tools): its label, its FElupe call, the dimensions of its points and its cells and its cell type (x-dimension), and its parameters. A mesh whose points and cells have the dimension of the model can have cell sets; a lower one is a construction mesh. An operation keeps the cell tags of the meshes it takes: a stack concatenates them, expand, revolve and fill_between repeat those of their first mesh per layer of cells.
 *
 * This interface was referenced by `CommandList`'s JSON-Schema
 * via the `definition` "MeshGenerate".
 */
export type MeshGenerate =
  | MeshPoint
  | MeshLine
  | MeshRectangle
  | MeshCube
  | MeshCircle
  | MeshTriangle
  | MeshExpand
  | MeshRevolve
  | MeshEmbed
  | MeshTranslate
  | MeshRotate
  | MeshMirror
  | MeshFillBetween
  | MeshAddRunouts
  | MeshStack;
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
 * A user-defined material of a Python file next to the project (ADR 0025), like a mesh script. Every kind of user-defined material is a definition below, with its label and what the file makes.
 *
 * This interface was referenced by `CommandList`'s JSON-Schema
 * via the `definition` "MaterialScript".
 */
export type MaterialScript =
  MaterialScriptConstitutive | MaterialScriptHyperelastic;
/**
 * Assign a material and a formulation to a cell set. Each section becomes a solid body. Every formulation is a definition below (the formulation registry, ADR 0024): its label, the solid body and the fields of FElupe, the cell types and the material that it takes, and its properties.
 *
 * This interface was referenced by `CommandList`'s JSON-Schema
 * via the `definition` "SectionAdd".
 */
export type SectionAdd =
  | SectionDisplacement
  | SectionNearlyIncompressible
  | SectionCondensed
  | SectionMixed
  | SectionThreeField
  | SectionIsochoric;
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
export type Coordinates = [number, number, number];
/**
 * The coordinates x, y and z of a point.
 *
 * @minItems 3
 * @maxItems 3
 *
 * This interface was referenced by `CommandList`'s JSON-Schema
 * via the `definition` "Coordinates".
 */
export type Coordinates1 = [number, number, number];
/**
 * The coordinates x, y and z of a point.
 *
 * @minItems 3
 * @maxItems 3
 */
export type Coordinates2 = [number, number, number];
/**
 * The coordinates x, y and z of a point.
 *
 * @minItems 3
 * @maxItems 3
 */
export type Coordinates3 = [number, number, number];
/**
 * The coordinates x, y and z of a point.
 *
 * @minItems 3
 * @maxItems 3
 */
export type Coordinates4 = [number, number, number];
/**
 * The coordinates x, y and z of a point.
 *
 * @minItems 3
 * @maxItems 3
 */
export type Coordinates5 = [number, number, number];
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
export type Coordinates6 = [number, number, number];
/**
 * The coordinates x, y and z of a point.
 *
 * @minItems 3
 * @maxItems 3
 */
export type Coordinates7 = [number, number, number];
/**
 * A direction of a rotated coordinate system: 1, 2 or 3 of its base vectors e1, e2 and e3.
 *
 * This interface was referenced by `CommandList`'s JSON-Schema
 * via the `definition` "Direction".
 */
export type Direction = "1" | "2" | "3";
/**
 * The coordinates x, y and z of a point.
 *
 * @minItems 3
 * @maxItems 3
 */
export type Coordinates8 = [number, number, number];
/**
 * The coordinates x, y and z of a point.
 *
 * @minItems 3
 * @maxItems 3
 */
export type Coordinates9 = [number, number, number];
/**
 * A direction of cylindrical coordinates about an axis: radial (r), around the axis (theta) or along it (z).
 *
 * This interface was referenced by `CommandList`'s JSON-Schema
 * via the `definition` "CylindricalDirection".
 */
export type CylindricalDirection = "r" | "theta" | "z";
/**
 * The coordinates x, y and z of a point.
 *
 * @minItems 3
 * @maxItems 3
 */
export type Coordinates10 = [number, number, number];

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
  value: number;
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
   * Name of an integer cell data array used to split the mesh into cell sets, e.g. material or gmsh:physical. The mesh tools keep the tags of the cells, also of a construction mesh.
   */
  tag?: string;
  /**
   * Type of the solid cells to import, if the file has more than one (one mesh per cell type). The 2D cells of a 3D model are a construction mesh, e.g. a profile to revolve or expand, without cell sets.
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
  scale?: number;
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
   * Name of an integer cell data array of a meshio.Mesh used to split the mesh into cell sets. The mesh tools keep the tags of the cells, also of a construction mesh.
   */
  tag?: string;
  /**
   * Type of the solid cells to take, if the mesh has more than one. The 2D cells of a 3D model are a construction mesh, e.g. a profile to revolve or expand, without cell sets.
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
    a: number;
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
    a: number;
    /**
     * The coordinate of the end, larger than a.
     */
    b: number;
    /**
     * The number of points (at least 2).
     */
    n: number;
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
    a: [number, number];
    /**
     * The corner with the largest coordinates x and y.
     *
     * @minItems 2
     * @maxItems 2
     */
    b: [number, number];
    /**
     * The number of points per axis x and y (at least 2).
     *
     * @minItems 2
     * @maxItems 2
     */
    n: [number, number];
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
    a: [number, number, number];
    /**
     * The corner with the largest coordinates x, y and z.
     *
     * @minItems 3
     * @maxItems 3
     */
    b: [number, number, number];
    /**
     * The number of points per axis x, y and z (at least 2).
     *
     * @minItems 3
     * @maxItems 3
     */
    n: [number, number, number];
  };
  color?: Color;
}
/**
 * A circle in the xy-plane (fem.Circle): quads in quarters of a circle about the centerpoint, each with a square inside, with n points on the edges of a quarter. The sections are the start angles of the quarters, e.g. 0 for a quarter circle or 0, 90, 180, 270 for a full circle.
 *
 * This interface was referenced by `CommandList`'s JSON-Schema
 * via the `definition` "MeshCircle".
 */
export interface MeshCircle {
  command: "mesh.generate";
  name: Name;
  tool: "Circle";
  parameters: {
    /**
     * The radius of the circle.
     */
    radius: number;
    /**
     * The center of the circle, x and y.
     *
     * @minItems 2
     * @maxItems 2
     */
    centerpoint: [number, number];
    /**
     * The number of points on the edges of a quarter (at least 2).
     */
    n: number;
    /**
     * The start angles of the quarters in degrees, at least 90 apart, e.g. 0 for a quarter circle or 0, 90, 180, 270 for a full circle.
     *
     * @minItems 1
     * @maxItems 4
     */
    sections:
      | [number]
      | [number, number]
      | [number, number, number]
      | [number, number, number, number];
  };
  color?: Color;
}
/**
 * A triangle in the xy-plane (fem.mesh.Triangle): three quad sections between the corners a, b and c, counterclockwise, with n points on the edges of a section.
 *
 * This interface was referenced by `CommandList`'s JSON-Schema
 * via the `definition` "MeshTriangle".
 */
export interface MeshTriangle {
  command: "mesh.generate";
  name: Name;
  tool: "Triangle";
  parameters: {
    /**
     * The first corner, x and y.
     *
     * @minItems 2
     * @maxItems 2
     */
    a: [number, number];
    /**
     * The second corner, x and y, counterclockwise from a.
     *
     * @minItems 2
     * @maxItems 2
     */
    b: [number, number];
    /**
     * The third corner, x and y, counterclockwise from b.
     *
     * @minItems 2
     * @maxItems 2
     */
    c: [number, number];
    /**
     * The number of points on the edges of a section (at least 2).
     */
    n: number;
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
   * The mesh that the tool takes: a mesh of the model before, made by a tool, of a file or of a script.
   *
   * @minItems 1
   * @maxItems 1
   */
  inputs: [Name];
  parameters: {
    /**
     * The number of points along the new axis (at least 2).
     */
    n: number;
    /**
     * The length along the new axis.
     */
    z: number;
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
   * The mesh that the tool takes: a mesh of the model before, made by a tool, of a file or of a script.
   *
   * @minItems 1
   * @maxItems 1
   */
  inputs: [Name];
  parameters: {
    /**
     * The number of points over the angle (at least 2).
     */
    n: number;
    /**
     * The angle of revolution in degrees, at most 360.
     */
    phi: number;
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
   * The mesh that the tool takes: a mesh of the model before, made by a tool, of a file or of a script.
   *
   * @minItems 1
   * @maxItems 1
   */
  inputs: [Name];
  parameters: {
    /**
     * The coordinate of the points on the new axis.
     */
    value: number;
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
   * The mesh that the tool takes: a mesh of the model before, made by a tool, of a file or of a script.
   *
   * @minItems 1
   * @maxItems 1
   */
  inputs: [Name];
  parameters: {
    /**
     * The distance along the axis.
     */
    move: number;
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
   * The mesh that the tool takes: a mesh of the model before, made by a tool, of a file or of a script.
   *
   * @minItems 1
   * @maxItems 1
   */
  inputs: [Name];
  parameters: {
    /**
     * The angle of rotation in degrees.
     */
    angle_deg: number;
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
    center?: [number, number] | [number, number, number];
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
   * The mesh that the tool takes: a mesh of the model before, made by a tool, of a file or of a script.
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
    value: number;
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
   * The two meshes of the model before, from the first to the second, of the same cell type and number of points, e.g. two lines embedded in a plane.
   *
   * @minItems 2
   * @maxItems 2
   */
  inputs: [Name, Name];
  parameters: {
    /**
     * The number of points from the first mesh to the second (at least 2).
     */
    n: number;
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
   * The mesh that the tool takes: a mesh of the model before, made by a tool, of a file or of a script.
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
    values: [number] | [number, number];
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
    centerpoint?: [number, number] | [number, number, number];
    /**
     * The shape of the runouts: the higher, the steeper the transition (default 5).
     */
    exponent?: number;
    /**
     * Keep the shape of the ends, the runouts become indents.
     */
    normalize?: boolean;
  };
  color?: Color;
}
/**
 * Stack several meshes of the same cells and points into one (fem.MeshContainer(meshes, merge=True, decimals).stack()): the points of all meshes, with the points at the same place merged, and the cells of all meshes, e.g. a profile of several rectangles that is revolved at once.
 *
 * This interface was referenced by `CommandList`'s JSON-Schema
 * via the `definition` "MeshStack".
 */
export interface MeshStack {
  command: "mesh.generate";
  name: Name;
  tool: "stack";
  /**
   * The meshes that the tool stacks: two or more meshes of the model before, of the same cell type and dimension of the points.
   *
   * @minItems 2
   */
  inputs: [Name, Name, ...Name[]];
  parameters: {
    /**
     * Points whose coordinates agree to this number of decimals are merged (default 10), so meshes of different tools merge despite round-off errors.
     */
    decimals: number;
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
 * Cell set of all cells of a mesh with the given tag value: of a mesh imported with a tag, or of a mesh made by tools of such meshes, which keep their tags.
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
  color?: Color;
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
  color?: Color;
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
    E: number;
    /**
     * Poisson's ratio
     */
    nu: number;
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
  mullins?: Mullins;
}
/**
 * The Mullins effect of Ogden and Roxburgh (fem.OgdenRoxburgh): the material is softer after it was loaded, when it is unloaded and loaded again up to the largest strain energy density of its load history, and stiff again above it. The stress is scaled by a softening of the strain energy density and of its maximum, a state variable of every quadrature point; the bulk modulus is not softened.
 *
 * This interface was referenced by `CommandList`'s JSON-Schema
 * via the `definition` "Mullins".
 */
export interface Mullins {
  /**
   * Reciprocal of the largest softening: with r = 3, the stiffness is softened to 1 - 1/3 = 2/3 at most.
   */
  r: number;
  /**
   * Initial softening modulus, a strain energy density: the smaller, the faster the material softens below the maximum of its load history.
   */
  m: number;
  /**
   * The part of the softening modulus that grows with the maximum strain energy density of the load history (m + β ψmax).
   */
  beta: number;
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
  mullins?: Mullins;
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
  mullins?: Mullins;
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
  mullins?: Mullins;
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
  mullins?: Mullins;
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
  mullins?: Mullins;
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
 * Linear-elastic material in terms of a strain (fem.MaterialStrain with fem.linear_elastic) in a framework: small strain or Total Lagrange. It needs the displacement formulation u, or the three-field variation u-p-J-three-field.
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
  strain_exponent?: number;
  parameters: {
    /**
     * Young's modulus (converted with ν into the Lamé constants λ and μ)
     */
    E: number;
    /**
     * Poisson's ratio
     */
    nu: number;
  };
}
/**
 * Linear-elastic-plastic material with linear isotropic hardening (fem.MaterialStrain with fem.linear_elastic_plastic_isotropic_hardening, the return mapping algorithm of von Mises plasticity) in a framework: small strain or Total Lagrange. Its state variables are the equivalent plastic strain and the plastic strain tensor. It needs the displacement formulation u, or the three-field variation u-p-J-three-field.
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
  strain_exponent?: number;
  parameters: {
    /**
     * Young's modulus (converted with ν into the Lamé constants λ and μ)
     */
    E: number;
    /**
     * Poisson's ratio
     */
    nu: number;
    /**
     * Initial yield stress (uniaxial)
     */
    sigma_y: number;
    /**
     * Isotropic hardening modulus: the yield stress grows by K times the equivalent plastic strain
     */
    K: number;
  };
}
/**
 * A ready constitutive model of a Python file: the file makes a variable umat with the methods gradient and hessian of FElupe, e.g. fem.NeoHooke(mu=mu, bulk=bulk), fem.Hyperelastic(...) & fem.Volumetric(...), a fem.Material of functions of its own or an object of a class of its own.
 *
 * This interface was referenced by `CommandList`'s JSON-Schema
 * via the `definition` "MaterialScriptConstitutive".
 */
export interface MaterialScriptConstitutive {
  command: "material.script";
  name: Name;
  kind: "constitutive";
  /**
   * File name of the script, e.g. soft.py. It makes a variable umat.
   */
  file: string;
  /**
   * The parameters of the model that the script gets as variables (default: all).
   */
  parameters?: Name[];
  /**
   * Whether the material has a volumetric part of its own, e.g. its bulk modulus (default: true). Like a model of material.add, the displacement formulation u takes a material with one, the u-p-J formulation one without.
   */
  volumetric?: boolean;
}
/**
 * A strain energy density function of a Python file, e.g. def strain_energy(C, mu): a function of the right Cauchy-Green deformation tensor C, whose derivatives tensortrax computes like those of the hyperelastic models of the registry. The material is fem.Hyperelastic of the function with the values of its other arguments. Without a bulk modulus, the function is the isochoric part of the strain energy (of the unimodular det(C)^(-1/3) C) and the material needs the u-p-J formulation. A function with state variables takes them as its second argument statevars and returns the strain energy and their new values.
 *
 * This interface was referenced by `CommandList`'s JSON-Schema
 * via the `definition` "MaterialScriptHyperelastic".
 */
export interface MaterialScriptHyperelastic {
  command: "material.script";
  name: Name;
  kind: "hyperelastic";
  /**
   * File name of the script, e.g. soft.py. It defines the function.
   */
  file: string;
  /**
   * The name of the strain energy function of the file (default: strain_energy).
   */
  function?: string;
  /**
   * The values of the arguments of the function after C (and statevars) by their names, numbers or expressions of the parameters of the model. An argument with a default value in the function may be left out.
   */
  arguments?: {
    [k: string]: number;
  };
  /**
   * Bulk modulus. Without it, the material is incompressible and needs the u-p-J formulation.
   */
  bulk?: number;
  mullins?: Mullins;
  /**
   * The number of the state variables of a function with the argument statevars.
   */
  nstatevars?: number;
}
/**
 * The displacement formulation u: a field of the displacements only (fem.SolidBody). The material has a volumetric part of its own: its bulk modulus, or a compressible or a strain-based model.
 *
 * This interface was referenced by `CommandList`'s JSON-Schema
 * via the `definition` "SectionDisplacement".
 */
export interface SectionDisplacement {
  command: "section.add";
  name: Name;
  cellset: Name;
  material: Name;
  formulation: "u";
  color?: Color;
}
/**
 * The nearly incompressible formulation u-p-J of the displacements, the pressure and the volume ratio, for a material without a volumetric part: the section adds it with its bulk modulus. It chooses its way by the cell type when the script runs: linear hexahedrons and quads condense the pressure and the volume ratio of every cell (fem.SolidBodyNearlyIncompressible, like u-p-J-condensed); the other cells have mixed fields (fem.FieldsMixed with fem.NearlyIncompressible, like u-p-J-mixed), linear tetrahedra and triangles with a bubble point (MINI).
 *
 * This interface was referenced by `CommandList`'s JSON-Schema
 * via the `definition` "SectionNearlyIncompressible".
 */
export interface SectionNearlyIncompressible {
  command: "section.add";
  name: Name;
  cellset: Name;
  material: Name;
  formulation: "u-p-J";
  /**
   * Bulk modulus of the nearly incompressible formulation.
   */
  bulk: number;
  /**
   * The volumetric part U(J) of the strain energy with the bulk modulus K (fem.NearlyIncompressible): volume-ratio K/2 (J - 1)², stretch 9K/2 (J^(1/3) - 1)² or log K/2 ln(J)².
   */
  volumetric?: "volume-ratio" | "stretch" | "log";
  color?: Color;
}
/**
 * Nearly incompressible, condensed per cell (u-p-J-condensed): a field of the displacements only, whose solid body condenses the constant pressure and volume ratio of every cell (fem.SolidBodyNearlyIncompressible, Q1/P0 of linear and Q2/P0 of quadratic cells). It takes hexahedrons and quads, linear or quadratic, and a material without a volumetric part: the section adds it with its bulk modulus.
 *
 * This interface was referenced by `CommandList`'s JSON-Schema
 * via the `definition` "SectionCondensed".
 */
export interface SectionCondensed {
  command: "section.add";
  name: Name;
  cellset: Name;
  material: Name;
  formulation: "u-p-J-condensed";
  /**
   * Bulk modulus of the nearly incompressible formulation.
   */
  bulk: number;
  /**
   * The volumetric part U(J) of the strain energy with the bulk modulus K (fem.NearlyIncompressible): volume-ratio K/2 (J - 1)², stretch 9K/2 (J^(1/3) - 1)² or log K/2 ln(J)².
   */
  volumetric?: "volume-ratio" | "stretch" | "log";
  color?: Color;
}
/**
 * Nearly incompressible on mixed fields (u-p-J-mixed): the displacements, the pressure and the volume ratio are fields of their own (fem.FieldsMixed with fem.NearlyIncompressible), of every cell type: linear tetrahedra and triangles with a bubble point (MINI), and a constant pressure and volume ratio per cell of linear hexahedrons and quads. It takes a material without a volumetric part: the section adds it with its bulk modulus.
 *
 * This interface was referenced by `CommandList`'s JSON-Schema
 * via the `definition` "SectionMixed".
 */
export interface SectionMixed {
  command: "section.add";
  name: Name;
  cellset: Name;
  material: Name;
  formulation: "u-p-J-mixed";
  /**
   * Bulk modulus of the nearly incompressible formulation.
   */
  bulk: number;
  /**
   * The volumetric part U(J) of the strain energy with the bulk modulus K (fem.NearlyIncompressible): volume-ratio K/2 (J - 1)², stretch 9K/2 (J^(1/3) - 1)² or log K/2 ln(J)².
   */
  volumetric?: "volume-ratio" | "stretch" | "log";
  color?: Color;
}
/**
 * The three-field variation (u-p-J-three-field) of the displacements, the pressure and the volume ratio on mixed fields (fem.FieldsMixed with fem.ThreeFieldVariation), of every cell type like u-p-J-mixed. It takes any material with a volumetric part of its own: its bulk modulus, or a compressible or a strain-based model, also with state variables. The section has no bulk modulus. The slowest way of u-p-J.
 *
 * This interface was referenced by `CommandList`'s JSON-Schema
 * via the `definition` "SectionThreeField".
 */
export interface SectionThreeField {
  command: "section.add";
  name: Name;
  cellset: Name;
  material: Name;
  formulation: "u-p-J-three-field";
  color?: Color;
}
/**
 * The displacement formulation u-isochoric: a field of the displacements only (fem.SolidBody), with a material without a bulk modulus whose strain energy has no volumetric part, e.g. air as a third medium between the parts of a model that come into contact.
 *
 * This interface was referenced by `CommandList`'s JSON-Schema
 * via the `definition` "SectionIsochoric".
 */
export interface SectionIsochoric {
  command: "section.add";
  name: Name;
  cellset: Name;
  material: Name;
  formulation: "u-isochoric";
  color?: Color;
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
        value: number;
        /**
         * Absolute tolerance (default 1e-8).
         */
        atol?: number;
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
        atol?: number;
      }
    | {
        /**
         * The radius of the cylinder.
         */
        radius: number;
        /**
         * The direction of the axis of the cylinder.
         */
        axis: "x" | "y" | "z";
        center?: Coordinates;
        /**
         * Absolute tolerance (default 1e-8).
         */
        atol?: number;
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
        atol?: number;
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
        radius: number;
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
        centers: [Coordinates1, ...Coordinates1[]];
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
   * Prescribed displacement of the constrained components (default 0): one number for all of them, or one number per constrained component in the order x, y, z (e.g. a point set that moves diagonally); a rotation in rad at a rotation point.
   *
   * @minItems 1
   * @maxItems 3
   */
  value?: number | [number] | [number, number] | [number, number, number];
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
  x?: number;
  /**
   * Coordinate of the plane normal to y (default 0), only with y in axes.
   */
  y?: number;
  /**
   * Coordinate of the plane normal to z (default 0), only with z in axes.
   */
  z?: number;
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
 * A Cartesian constraint (fem.CartesianConstraint, #421): the points of a point set held or moved in the directions of a rotated coordinate system by a penalty, the other directions free, e.g. points that slide on an inclined plane. The coordinate system is fixed in space: e1, e2 and e3 = e1 × e2, normalized by the script. An item of the steps; a ramp of a step moves the points like a boundary, and it may be the curve of a job.
 *
 * This interface was referenced by `CommandList`'s JSON-Schema
 * via the `definition` "CartesianAdd".
 */
export interface CartesianAdd {
  command: "cartesian.add";
  name: Name;
  /**
   * Name of an object, unique within the command list. Used as a Python identifier in the generated script; at most 24 characters keep the script readable.
   */
  points: string;
  e1: Coordinates6;
  e2?: Coordinates7;
  /**
   * The constrained directions of e1, e2 and e3 (skip the others).
   *
   * @minItems 1
   */
  constrained: [Direction, ...Direction[]];
  /**
   * Prescribed displacement in the constrained directions (default 0): one number for all of them, or one number per constrained direction in the order 1, 2, 3.
   *
   * @minItems 1
   * @maxItems 3
   */
  value?: number | [number] | [number, number] | [number, number, number];
  /**
   * The penalty per point and direction (default 1000).
   */
  multiplier?: number;
}
/**
 * A cylindrical constraint (fem.CylindricalConstraint, #422): the points of a point set held or moved radially, around and along an axis by a penalty, the other directions free, e.g. points that slide in a rigid sleeve (radially only) or the end of a bushing that is turned (around the axis). The directions r, theta and z are those of each point about the axis, evaluated in the deformed configuration; in a 2D model (plane strain), the axis is z and the directions are r and theta. An item of the steps; a ramp of a step moves the points like a boundary, and it may be the curve of a job.
 *
 * This interface was referenced by `CommandList`'s JSON-Schema
 * via the `definition` "CylindricalAdd".
 */
export interface CylindricalAdd {
  command: "cylindrical.add";
  name: Name;
  /**
   * Name of an object, unique within the command list. Used as a Python identifier in the generated script; at most 24 characters keep the script readable.
   */
  points: string;
  center?: Coordinates8;
  axis?: Coordinates9;
  /**
   * The constrained directions: radially (r), around the axis (theta) and along it (z); the others are free.
   *
   * @minItems 1
   */
  constrained: [CylindricalDirection, ...CylindricalDirection[]];
  /**
   * Prescribed displacement in the constrained directions (default 0): one number for all of them, or one number per constrained direction in the order r, theta, z. Around the axis, the arc length on the undeformed radius: the points at the radius R turn by the angle value / R.
   *
   * @minItems 1
   * @maxItems 3
   */
  value?: number | [number] | [number, number] | [number, number, number];
  /**
   * The penalty per point and direction (default 1000).
   */
  multiplier?: number;
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
  friction?: number;
  /**
   * The factor of the penalty of the contact, times the mean stiffness of the solid bodies at the points (default 1).
   */
  multiplier?: number;
  /**
   * The allowable elastic slip of sticking points (default none: a constant tangential penalty), e.g. 0.5 % to 1 % of the size of a cell.
   */
  elastic_slip?: number;
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
  force: Coordinates10;
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
  pressure: number;
}
/**
 * A step with its items and boundaries (all by default), optionally ramping items, each with its own values (fem.Step).
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
   * Multi-point constraints, Cartesian and cylindrical constraints and contacts that are items of the step (default: all).
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
   * Boundaries, load cases and symmetry planes of the step (default: all). A boundary that the step does not have is off in it: its points are free, and its reaction force is released at once.
   *
   * @minItems 1
   */
  boundaries?: [Name, ...Name[]];
  /**
   * The values of the boundaries that the step switches on, those that the step evaluated before it does not have: the displacements of their points at the start of the step (default), or at the start of the job (of a boundary that was on then, its values then). A ramp of such a boundary is relative to these values.
   */
  switched_on?: "step" | "job";
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
 * A ramped item: a boundary (its value, e.g. a displacement, or one value per constrained component), a load case (the displacement of its moving faces), a Cartesian or cylindrical constraint (its displacement, or one per constrained direction), a point load (a factor of its force) or a pressure (a factor of its pressure).
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
   * Value at the start of the step (default 0); of a boundary with several constrained components one number for all of them, or one per component in the order x, y, z (of a Cartesian constraint per direction in the order 1, 2, 3, of a cylindrical constraint r, theta, z).
   *
   * @minItems 1
   * @maxItems 3
   */
  start?: number | [number] | [number, number] | [number, number, number];
  /**
   * Value at the end of the step; of a boundary with several constrained components one number for all of them, or one per component in the order x, y, z (of a Cartesian constraint per direction in the order 1, 2, 3, of a cylindrical constraint r, theta, z).
   *
   * @minItems 1
   * @maxItems 3
   */
  end: number | [number] | [number, number] | [number, number, number];
}
/**
 * A job evaluating steps one after another (fem.Job). With a curve, the force-displacement curve of a boundary, a load case, a Cartesian or cylindrical constraint or a point load is recorded (fem.CharacteristicCurve).
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
  tol?: number;
  /**
   * The maximum number of Newton iterations of a substep (default 16).
   */
  maxiter?: number;
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
    rtol?: number;
    /**
     * The maximum number of iterations of the iterative method (default of SciPy).
     */
    maxiter?: number;
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
