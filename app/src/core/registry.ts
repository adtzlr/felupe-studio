// Registry of labels, hints and defaults for the commands. The structure of a form
// (fields, types, ranges, variants) comes from the command schema, see form.ts; this
// file only adds what the schema does not know.
import { BRAND } from "../app";
import { analysisOf, is2d } from "./analysis";
import type { Command } from "./commands";
import { fits, fitting, formulationOf } from "./formulations";
import { isMaterial } from "./materials";
import type { CommandType, Kind } from "./validate";

export interface FieldInfo {
  label: string;
  /** Short explanation shown below the field. */
  hint?: string;
  /** Shown in an empty optional field, usually what happens without a value. */
  placeholder?: string;
  /** Initial value of a required field of a new object. */
  default?: unknown;
  /**
   * A column of rows (an array of objects) whose objects may appear only once,
   * e.g. a step ramps a boundary only once.
   */
  unique?: boolean;
}

export type Tab = "mesh" | "materials" | "sections" | "loads" | "steps";

export interface CommandInfo {
  /** Label of the command, e.g. on the ribbon. */
  label: string;
  /** Ribbon tab of the command. */
  tab: Tab;
  /** Prefix of suggested names, e.g. `material` gives `material_1`. */
  prefix: string;
  /** Fields by their path in the command, e.g. `parameters.mu`. */
  fields: Record<string, FieldInfo>;
  /** Labels of the options of a field: enum values, material models, variants. */
  options?: Record<string, Record<string, string>>;
  /** At most one object of this command per model. */
  single?: boolean;
  /** Noun of a new object in dialogs, if not its kind (a load case is a boundary). */
  noun?: string;
  /**
   * A menu of the ribbon of this command and the next ones of its tab with the same
   * menu, e.g. *Constraints* (#454), like the variants of a command of the same
   * `x-group` of the schema. A command of a menu has no variants of its own groups.
   */
  menu?: string;
  /**
   * Adjust the defaults of a new object to the model, e.g. a section takes a cell
   * set without a section. Values of a preset (e.g. of a button of the ribbon) are
   * applied afterwards.
   */
  initial?: (
    draft: Record<string, unknown>,
    commands: readonly Command[],
    preset: Record<string, unknown>,
  ) => Record<string, unknown>;
  /**
   * Why the model does not offer the command, if so, e.g. a cylindrical constraint
   * in an axisymmetric model (#422).
   */
  unavailable?: (commands: readonly Command[]) => string | undefined;
}

/** The components x and y of a 2D model (#175), instead of all three. */
/** New model settings take the units of the brand, if it has some (ADR 0020). */
function brandUnits(draft: Record<string, unknown>): Record<string, unknown> {
  const units = BRAND.defaults?.units;
  return units && draft.units === undefined ? { ...draft, units } : draft;
}

function planar(
  draft: Record<string, unknown>,
  commands: readonly Command[],
): Record<string, unknown> {
  return is2d(analysisOf(commands))
    ? { ...draft, constrained: ["x", "y"] }
    : draft;
}

/**
 * A new constraint connects the latest point set (of the mesh) to the latest
 * control point, if there are such objects.
 */
function initialConstraint(
  draft: Record<string, unknown>,
  commands: readonly Command[],
): Record<string, unknown> {
  const sets = commands.filter((c) => c.command === "pointset.add");
  const points = commands.filter((c) => c.command === "point.add");
  return {
    ...planar(draft, commands),
    ...(sets.length ? { points: sets.at(-1)!.name } : {}),
    ...(points.length ? { center: points.at(-1)!.name } : {}),
  };
}

/**
 * A new Cartesian constraint (#421) takes the latest point set; in a 2D model, it
 * holds the points normal to e1 (direction 2, e.g. a support on an inclined line
 * along e1).
 */
function initialCartesian(
  draft: Record<string, unknown>,
  commands: readonly Command[],
): Record<string, unknown> {
  const sets = commands.filter((c) => c.command === "pointset.add");
  return {
    ...draft,
    ...(is2d(analysisOf(commands))
      ? { e1: [1, 0, 0], constrained: ["2"] }
      : {}),
    ...(sets.length ? { points: sets.at(-1)!.name } : {}),
  };
}

/**
 * A new cylindrical constraint (#422) takes the latest point set, and of a point set
 * on a cylinder its axis and center (#181, e.g. of a picked cylinder, #189); it
 * holds the points radially, like a rigid sleeve.
 */
function initialCylindrical(
  draft: Record<string, unknown>,
  commands: readonly Command[],
): Record<string, unknown> {
  const set = commands.filter((c) => c.command === "pointset.add").at(-1);
  if (!set) return draft;
  const select = set.select;
  if (!("radius" in select)) return { ...draft, points: set.name };
  const axis = ["x", "y", "z"].map((a) => (a === select.axis ? 1 : 0));
  const planar = is2d(analysisOf(commands));
  return {
    ...draft,
    points: set.name,
    ...(select.center ? { center: select.center } : {}),
    ...(planar ? {} : { axis }),
  };
}

/**
 * A new contact (#220) takes the latest rigid surface and the latest face set (or
 * point set, without face sets).
 */
function initialContact(
  draft: Record<string, unknown>,
  commands: readonly Command[],
): Record<string, unknown> {
  const latest = (command: string) =>
    commands.filter((c) => c.command === command).at(-1)?.name;
  const points = latest("faceset.add") ?? latest("pointset.add");
  const surface = latest("rigid.add");
  return {
    ...draft,
    ...(points ? { points } : {}),
    ...(surface ? { surface } : {}),
  };
}

/** A new pressure takes the last face set. */
function initialPressure(
  draft: Record<string, unknown>,
  commands: readonly Command[],
): Record<string, unknown> {
  const sets = commands.filter((c) => c.command === "faceset.add");
  return sets.length ? { ...draft, faces: sets.at(-1)!.name } : draft;
}

/** A new face set takes the last section. */
function initialFaceSet(
  draft: Record<string, unknown>,
  commands: readonly Command[],
): Record<string, unknown> {
  const sections = commands.filter((c) => c.command === "section.add");
  return sections.length ? { ...draft, section: sections.at(-1)!.name } : draft;
}

/**
 * The first cell set without a section, and a material and a formulation that fit
 * (ADR 0024): the formulation of a button of the ribbon with the latest material
 * that it takes, else the first formulation that takes the material, e.g. u-p-J of
 * an incompressible material.
 */
function initialSection(
  draft: Record<string, unknown>,
  commands: readonly Command[],
  preset: Record<string, unknown>,
): Record<string, unknown> {
  const used = new Set(
    commands.flatMap((c) => (c.command === "section.add" ? [c.cellset] : [])),
  );
  const free = commands.find(
    (c) =>
      (c.command === "cellset.from_tag" || c.command === "cellset.from_file") &&
      !used.has(c.name),
  );
  const next = { ...draft };
  if (free) next.cellset = free.name;
  // of the registry and of files (ADR 0025)
  const materials = commands.filter(isMaterial);
  const chosen =
    typeof preset.formulation === "string"
      ? formulationOf(preset.formulation)
      : undefined;
  if (chosen) {
    const material = [...materials].reverse().find((m) => fits(chosen, m));
    if (material) next.material = material.name;
    return next;
  }
  const material = materials.find((m) => m.name === next.material);
  const formulation = material && fitting(material);
  if (formulation) next.formulation = formulation.name;
  return next;
}

export const KIND_LABELS: Record<Kind, string> = {
  settings: "Settings",
  parameter: "Parameter",
  mesh: "Mesh",
  merge: "Merge",
  cellset: "Cell set",
  material: "Material",
  section: "Section",
  pointset: "Point set",
  rigid: "Rigid surface",
  faceset: "Face set",
  boundary: "Boundary",
  symmetry: "Symmetry",
  constraint: "Constraint",
  load: "Load",
  pressure: "Pressure",
  step: "Step",
  job: "Job",
};

const AXES = { x: "x", y: "y", z: "z" };

// the framework of a strain-based material (#191), of the registry or of a file
// (#425)
const FRAMEWORK: Record<string, FieldInfo> = {
  framework: {
    label: "Framework",
    hint: "The strain and the stress of a strain-based material, fem.MaterialStrain",
    placeholder: "small-strain",
  },
  strain_exponent: {
    label: "Strain exponent m",
    hint: "Of the Seth-Hill strain: 0 logarithmic (Hencky), 1 Biot, 2 Green-Lagrange",
    default: 0,
  },
};
const FRAMEWORKS = {
  "small-strain": "Small strain",
  "total-lagrange": "Total Lagrange (large rotations)",
  "co-rotational": "Co-rotational (Biot strain)",
  "seth-hill": "Seth-Hill (strain exponent m)",
};

export const REGISTRY: Record<CommandType, CommandInfo> = {
  "mesh.import": {
    label: "Import mesh",
    tab: "mesh",
    prefix: "mesh",
    fields: {
      file: { label: "File", hint: "File name of the mesh, read with meshio" },
      tag: {
        label: "Cell tag",
        hint: "Integer cell data for cell sets, e.g. material or gmsh:physical",
        placeholder: "none",
      },
      cell_type: {
        label: "Cell type",
        hint: "Type of the solid cells, if the file has more than one",
        placeholder: "the only one",
      },
      scale: {
        label: "Scale",
        hint: "Multiplies the coordinates, e.g. 1000 from m to mm",
        placeholder: "1",
      },
      color: {
        label: "Color",
        hint: "Of the mesh in the viewport, with Color by: Meshes",
        placeholder: "automatic",
      },
    },
  },
  // a mesh made by a Python script with the parameters of the model (#182)
  // the labels, hints and defaults of the tools and their parameters are in the
  // registry of the mesh tools of the schema (ADR 0019)
  "mesh.generate": {
    label: "Mesh tool",
    tab: "mesh",
    prefix: "mesh",
    fields: {
      tool: { label: "Tool", default: "Cube" },
      inputs: { label: "Mesh", hint: "Made by a tool before" },
      "parameters.axis": { label: "Axis" },
      "parameters.normalize": {
        label: "Normalize",
        hint: "Keep the shape of the ends: the runouts become indents",
      },
      color: {
        label: "Color",
        hint: "Of the mesh in the viewport, with Color by: Meshes",
        placeholder: "automatic",
      },
    },
  },
  "mesh.script": {
    label: "Mesh script",
    tab: "mesh",
    prefix: "mesh",
    fields: {
      file: {
        label: "Script",
        hint: "A Python file opened with the project that makes a variable mesh",
        placeholder: "e.g. bushing.py",
      },
      parameters: {
        label: "Parameters",
        hint: "The parameters the script gets as variables",
        placeholder: "all",
      },
      item: {
        label: "Item",
        hint: "Of a dict of meshes, e.g. soft",
        placeholder: "none (one mesh)",
      },
      tag: {
        label: "Cell tag",
        hint: "Integer cell data of a meshio mesh for cell sets",
        placeholder: "none",
      },
      cell_type: {
        label: "Cell type",
        hint: "Type of the solid cells, if the mesh has more than one",
        placeholder: "the only one",
      },
      color: {
        label: "Color",
        hint: "Of the mesh in the viewport, with Color by: Meshes",
        placeholder: "automatic",
      },
    },
  },
  "mesh.merge": {
    label: "Merge points",
    tab: "mesh",
    prefix: "merge",
    single: true,
    fields: {
      decimals: {
        label: "Decimals",
        hint: "Points are merged if their coordinates agree to this many decimals",
        default: 6,
      },
    },
  },
  "cellset.from_tag": {
    label: "Cell set from tag",
    tab: "mesh",
    prefix: "cells",
    fields: {
      mesh: { label: "Mesh" },
      value: { label: "Tag value", default: 1 },
      // an own color (#376), like that of a mesh (#336)
      color: {
        label: "Color",
        hint: "Of the cell set in the viewport, with Color by: Cell sets",
        placeholder: "automatic",
      },
    },
  },
  "cellset.from_file": {
    label: "Cell set of a mesh",
    tab: "mesh",
    prefix: "cells",
    fields: {
      mesh: { label: "Mesh" },
      // an own color (#376), like that of a mesh (#336)
      color: {
        label: "Color",
        hint: "Of the cell set in the viewport, with Color by: Cell sets",
        placeholder: "automatic",
      },
    },
  },
  "material.add": {
    label: "Material",
    tab: "materials",
    prefix: "material",
    // the labels, hints and defaults of the models and their parameters are in the
    // material registry of the schema (x-label, description, default)
    fields: {
      model: { label: "Model", default: "NeoHooke" },
      ...FRAMEWORK,
      // an option of the hyperelastic materials (#346)
      mullins: {
        label: "Mullins effect",
        hint: "Softer after the first loading, up to the largest strain energy density of the load history (Ogden-Roxburgh)",
      },
    },
    options: { framework: FRAMEWORKS },
  },
  // a user-defined material of a Python file (ADR 0025): the label of its kind is
  // in the schema (x-label), like the models of the registry
  "material.script": {
    label: "User-defined material",
    tab: "materials",
    prefix: "material",
    fields: {
      // the kinds of user-defined materials, with the labels of the schema (#424)
      kind: { label: "Kind", default: "constitutive" },
      // Download template of the hint is a link that saves the template (#453)
      file: {
        label: "Script",
        hint: "A Python file opened with the project, e.g. of Download template",
        placeholder: "e.g. material.py",
      },
      // a function of a file (#424, #425): its arguments are fields of their own,
      // from the run of the file; the placeholder is its default name of the schema
      function: {
        label: "Function",
        hint: "The function of the file, e.g. of the template",
      },
      mullins: {
        label: "Mullins effect",
        hint: "Softer after the first loading, up to the largest strain energy density of the load history (Ogden-Roxburgh)",
      },
      nstatevars: {
        label: "State variables",
        hint: "Their number, of a function with the argument statevars",
      },
      // a strain-based function of a file (#425): the shapes of its state
      // variables and its framework, like a strain-based model of the registry
      statevars: {
        label: "State variables",
        hint: "Their shapes, like statevars of fem.MaterialStrain, e.g. (1, (3, 3)) for a scalar and a tensor",
        placeholder: "none",
      },
      ...FRAMEWORK,
      parameters: {
        label: "Parameters",
        hint: "The parameters the script gets as variables",
        placeholder: "all",
      },
      volumetric: {
        label: "Volumetric part",
        hint: "The umat has a volumetric part of its own, e.g. a bulk modulus: the displacement formulation u takes it, u-p-J one without",
      },
    },
    options: { framework: FRAMEWORKS },
  },
  "section.add": {
    label: "Section",
    tab: "sections",
    prefix: "section",
    fields: {
      cellset: { label: "Cell set" },
      material: { label: "Material" },
      // the hint of a formulation says when to use it (x-hint of the schema, #420)
      formulation: { label: "Formulation", default: "u" },
      bulk: {
        label: "Bulk modulus",
        hint: "Of the volumetric part, fem.NearlyIncompressible",
        default: 5000,
      },
      volumetric: {
        label: "Volumetric part",
        hint: "The strain energy U(J) with the bulk modulus K",
        placeholder: "volume-ratio",
      },
      // an own color (#376), like that of a mesh (#336)
      color: {
        label: "Color",
        hint: "Of the section in the viewport, with Color by: Sections",
        placeholder: "automatic",
      },
    },
    // the labels and the hints of the formulations are in the formulation registry
    // of the schema (x-label, x-hint, ADR 0024)
    options: {
      volumetric: {
        "volume-ratio": "Volume ratio: K/2 (J − 1)²",
        stretch: "Stretch: 9K/2 (J^⅓ − 1)²",
        log: "Logarithm: K/2 ln(J)²",
      },
    },
    initial: initialSection,
  },
  "pointset.add": {
    label: "Point set",
    tab: "mesh",
    prefix: "points",
    fields: {
      select: { label: "Select" },
      "select.axis": { label: "Axis", default: "x" },
      "select.value": { label: "Coordinate", default: 0 },
      "select.bound": {
        label: "Bound",
        hint: "Of the meshes of the sections, also after they change",
        default: "max",
      },
      "select.radius": {
        label: "Radius",
        hint: "The distance of the points from the axis",
        default: 1,
      },
      "select.center": {
        label: "Center",
        hint: "A point on the axis of the cylinder",
        placeholder: "0, 0, 0",
      },
      "select.atol": { label: "Tolerance", placeholder: "1e-8" },
      "select.surface": { label: "Surface", default: true },
      "select.section": {
        label: "Section",
        hint: "All points of its cells, e.g. of a rigid part moved by boundaries",
      },
      "select.points": {
        label: "Nodes",
        hint: "One point per line: x, y, z",
        default: [],
      },
      "select.ids": {
        label: "Point ids",
        hint: "Separated by commas",
        default: [],
      },
    },
    options: {
      select: {
        axis: "By coordinate",
        bound: "At a bound",
        radius: "On a cylinder",
        surface: "On the outer surface",
        section: "Of a section",
        points: "By nodes",
        ids: "By point ids",
      },
      "select.axis": AXES,
      "select.bound": { min: "Minimum", max: "Maximum" },
    },
  },
  "faceset.add": {
    label: "Face set",
    tab: "mesh",
    prefix: "faces",
    fields: {
      section: {
        label: "Section",
        hint: "Faces of the boundary of this section",
      },
      select: { label: "Select" },
      "select.axis": { label: "Axis", default: "x" },
      "select.value": { label: "Coordinate", default: 0 },
      "select.atol": { label: "Tolerance", placeholder: "default" },
      "select.centers": {
        label: "Centers",
        hint: "The centers of the faces, one per line: x, y, z",
        default: [],
      },
    },
    options: {
      select: {
        axis: "By coordinate",
        centers: "By centers",
      },
      "select.axis": AXES,
    },
    initial: initialFaceSet,
  },
  "boundary.add": {
    label: "Boundary",
    tab: "loads",
    prefix: "boundary",
    fields: {
      pointset: { label: "Point set" },
      constrained: { label: "Constrained", default: ["x", "y", "z"] },
      value: {
        label: "Value",
        hint: "Prescribed displacement, 0 if empty: one value, or one per constrained component (x, y, z), e.g. 0.5, -0.1",
        placeholder: "0",
      },
    },
    options: {
      constrained: AXES,
    },
    initial: planar,
  },
  "loadcase.add": {
    label: "Load case",
    tab: "loads",
    prefix: "loadcase",
    noun: "load case",
    fields: {
      type: { label: "Type", default: "uniaxial" },
      axis: {
        label: "Axis",
        hint: "Direction of the loading, or of the shear",
        placeholder: "x",
      },
      second: {
        label: "Second axis",
        hint: "Biaxial: also loaded; planar: constant width",
        placeholder: "y",
      },
      normal: {
        label: "Normal",
        hint: "Normal of the sheared end faces",
        placeholder: "y",
      },
      clamped: {
        label: "Clamped",
        hint: "Rigid end faces, without transversal displacements",
      },
      symmetry: {
        label: "Symmetry planes",
        hint: "At x = 0, y = 0 and z = 0; without, the opposite faces are at the smallest coordinates",
      },
      compression: {
        label: "Compression",
        hint: "Displacement of the moving face along the normal, held",
        placeholder: "0",
      },
    },
    options: {
      axis: AXES,
      second: AXES,
      normal: AXES,
    },
  },
  "symmetry.add": {
    label: "Symmetry",
    tab: "loads",
    prefix: "symmetry",
    fields: {
      axes: {
        label: "Planes normal to",
        hint: "The normal displacement is zero on a plane, the others are free",
        default: ["x"],
      },
      x: { label: "x of the plane", placeholder: "0" },
      y: { label: "y of the plane", placeholder: "0" },
      z: { label: "z of the plane", placeholder: "0" },
    },
    options: {
      axes: AXES,
    },
  },
  "model.settings": {
    label: "Model settings",
    tab: "mesh",
    prefix: "settings",
    single: true,
    initial: brandUnits,
    fields: {
      // the type of the model (#175): 3D, or 2D in the xy-plane
      analysis: {
        label: "Analysis",
        hint: "Axisymmetric: x is the axis of rotation, y the radius, the forces are totals over the circumference. Plane strain: the forces are per unit thickness",
        placeholder: "3D",
      },
      units: {
        label: "Units",
        hint: "What the numbers mean; nothing is converted",
      },
      "units.length": { label: "Length", default: "mm" },
      "units.force": { label: "Force", default: "N" },
      // the model in single precision (ADR 0016, #297)
      precision: {
        label: "Precision",
        hint: "Single: the regions, the fields and the linear system in float32, half the memory. The accuracy depends on the model; the job panel estimates it. Steel bonded to rubber needs double precision",
        placeholder: "double",
      },
    },
    options: {
      analysis: {
        "3d": "3D",
        "plane-strain": "Plane strain (2D)",
        axisymmetric: "Axisymmetric (2D)",
      },
      precision: {
        double: "Double (float64)",
        single: "Single (float32)",
      },
      "units.length": { mm: "mm", m: "m" },
      "units.force": { N: "N", kN: "kN" },
    },
  },
  // a parameter of the model (#180), e.g. a dimension of a mesh made by a script
  "parameter.add": {
    label: "Parameter",
    tab: "mesh",
    prefix: "parameter",
    fields: {
      value: { label: "Value", default: 1 },
      quantity: {
        label: "Quantity",
        hint: "The unit of the value, from the model settings",
        placeholder: "none (no unit)",
      },
      min: { label: "Minimum", placeholder: "none" },
      max: { label: "Maximum", placeholder: "none" },
      step: {
        label: "Step",
        hint: "Of the value, e.g. of a slider",
        placeholder: "none",
      },
      integer: {
        label: "Integer",
        hint: "E.g. a number of layers or cells",
      },
      description: {
        label: "Description",
        hint: "What the parameter is, in a few words",
        placeholder: "e.g. Radius of the disc",
      },
    },
    options: {
      quantity: { length: "Length", force: "Force", stress: "Stress" },
    },
  },
  "point.add": {
    label: "Control point",
    tab: "loads",
    prefix: "control",
    noun: "control point",
    fields: {
      coordinates: {
        label: "Coordinates",
        hint: "x, y, z; not a node of the meshes, e.g. a center moved off its face",
        default: [0, 0, 0],
      },
    },
  },
  "rigid.add": {
    label: "Rigid surface",
    tab: "loads",
    prefix: "rigid",
    noun: "rigid surface",
    fields: {
      coordinates: {
        label: "Reference point",
        hint: "x, y, z: a point of the plane or of the axis; boundaries move the surface",
        default: [0, 0, 0],
      },
      shape: { label: "Shape" },
      "shape.normal": {
        label: "Normal",
        hint: "Outward, towards the points that touch the plane",
        default: [0, 0, 1],
      },
      "shape.radius": { label: "Radius", default: 1 },
      "shape.axis": {
        label: "Axis",
        hint: "The direction of the axis",
        default: [0, 0, 1],
      },
      "shape.inside": {
        label: "Inside",
        hint: "The points are inside the cylinder (a tube), else outside (a roller)",
      },
    },
    options: {
      shape: { normal: "Plane", radius: "Cylinder" },
    },
  },
  "mpc.add": {
    label: "Multi-point constraint",
    tab: "loads",
    menu: "Constraints",
    prefix: "mpc",
    noun: "constraint",
    fields: {
      points: { label: "Points", hint: "The connected points" },
      center: {
        label: "Center point",
        hint: "A control point (or a point set of one point)",
      },
      constrained: {
        label: "Connected",
        hint: "Components that follow the center point; all with a rotation point",
        default: ["x", "y", "z"],
      },
      multiplier: {
        label: "Multiplier",
        hint: "Penalty of the relative displacements",
        placeholder: "1000",
      },
      rotation: {
        label: "Rotation point",
        hint: "A control point whose values are the rotations in rad",
        placeholder: "none (rotations locked)",
      },
    },
    options: { constrained: AXES },
    initial: initialConstraint,
  },
  // a Cartesian constraint (#421): points held or moved in rotated directions
  "cartesian.add": {
    label: "Cartesian constraint",
    tab: "loads",
    menu: "Constraints",
    prefix: "cartesian",
    noun: "Cartesian constraint",
    fields: {
      points: { label: "Points", hint: "The held or moved points" },
      e1: {
        label: "e1",
        hint: "The first direction, e.g. the normal of an inclined plane; any length",
        default: [0, 0, 1],
      },
      e2: {
        label: "e2",
        hint: "Orthogonal to e1, and e3 = e1 × e2. None in 2D: e1 turned by 90°",
        placeholder: "0, 1, 0",
      },
      constrained: {
        label: "Constrained",
        hint: "Held or moved directions; the others are free, e.g. 1 on a plane normal to e1",
        default: ["1"],
      },
      value: {
        label: "Displacement",
        hint: "In the constrained directions, 0 if empty: one value, or one per direction (1, 2, 3); a ramp of a step moves them",
        placeholder: "0",
      },
      multiplier: {
        label: "Multiplier",
        hint: "Penalty per point and direction",
        placeholder: "1000",
      },
    },
    options: { constrained: { "1": "1 (e1)", "2": "2 (e2)", "3": "3 (e3)" } },
    initial: initialCartesian,
  },
  // a cylindrical constraint (#422): points held or moved radially, around and along
  // an axis
  "cylindrical.add": {
    label: "Cylindrical constraint",
    tab: "loads",
    menu: "Constraints",
    prefix: "cylindrical",
    noun: "cylindrical constraint",
    fields: {
      points: {
        label: "Points",
        hint: "The held or moved points, e.g. on a cylinder; none on the axis if held radially or around it",
      },
      center: {
        label: "Center",
        hint: "A point on the axis",
        placeholder: "0, 0, 0",
      },
      axis: {
        label: "Axis",
        hint: "The direction of the axis; any length. In 2D, the axis is z",
        placeholder: "0, 0, 1",
      },
      constrained: {
        label: "Constrained",
        hint: "Held or moved directions; the others are free, e.g. r of a rigid sleeve",
        default: ["r"],
      },
      value: {
        label: "Displacement",
        hint: "In the constrained directions, 0 if empty: one value, or one per direction (r, θ, z). Around the axis, the arc length on the radius R: the points turn by u / R. A ramp of a step moves them",
        placeholder: "0",
      },
      multiplier: {
        label: "Multiplier",
        hint: "Penalty per point and direction",
        placeholder: "1000",
      },
    },
    options: {
      constrained: {
        r: "r (radial)",
        theta: "θ (around the axis)",
        z: "z (along the axis)",
      },
    },
    initial: initialCylindrical,
    unavailable: (commands) =>
      analysisOf(commands) === "axisymmetric"
        ? "An axisymmetric model has no direction around its axis: a boundary holds or moves its points radially (y) or axially (x)."
        : undefined,
  },
  "contact.add": {
    label: "Contact",
    tab: "loads",
    prefix: "contact",
    fields: {
      points: {
        label: "Points",
        hint: "A face set (its points) or a point set that may touch the surface",
      },
      surface: { label: "Rigid surface" },
      friction: {
        label: "Friction",
        hint: "Coulomb friction coefficient",
        placeholder: "0 (none)",
      },
      multiplier: {
        label: "Multiplier",
        hint: "Factor of the penalty, times the mean stiffness at the points",
        placeholder: "1",
      },
      elastic_slip: {
        label: "Elastic slip",
        hint: "Allowable slip of sticking points, e.g. 1 % of a cell",
        placeholder: "none",
      },
    },
    initial: initialContact,
  },
  "load.add": {
    label: "Point load",
    tab: "loads",
    prefix: "load",
    noun: "load",
    fields: {
      points: {
        label: "Points",
        hint: "A point set, a control point or a rigid surface",
      },
      force: {
        label: "Force",
        hint: "fx, fy, fz at every point; a ramp of a step scales it",
        default: [0, 0, 0],
      },
    },
  },
  "pressure.add": {
    label: "Pressure",
    tab: "loads",
    prefix: "pressure",
    fields: {
      faces: { label: "Faces", hint: "A face set" },
      pressure: {
        label: "Pressure",
        hint: "Per deformed area, positive onto the faces; a ramp of a step scales it",
        default: 0,
      },
    },
    initial: initialPressure,
  },
  "step.add": {
    label: "Step",
    tab: "steps",
    prefix: "step",
    fields: {
      sections: { label: "Sections", placeholder: "all" },
      constraints: { label: "Constraints", placeholder: "all" },
      loads: { label: "Loads", placeholder: "all" },
      // steps that switch boundaries on and off (#393)
      boundaries: {
        label: "Boundaries",
        hint: "Boundaries, load cases and symmetry planes of the step; one that it does not have is off: its points are free",
        placeholder: "all",
      },
      switched_on: {
        label: "Switched on",
        hint: "The values of the boundaries that the step switches on (off in the step before it): the displacements of their points at the start of the step or of the job; a ramp adds to them",
        placeholder: "step",
      },
      ramp: { label: "Ramp" },
      "ramp.num": { label: "Increments", default: 5 },
      "ramp.items": {
        label: "Ramped",
        hint: "Boundaries, load cases or loads (a factor of the force), each from its start to its end value; a boundary may have one value per constrained component (x, y, z), e.g. 0.5, -0.1",
      },
      "ramp.items.target": { label: "Item", unique: true },
      "ramp.items.start": { label: "Start", placeholder: "0" },
      "ramp.items.end": { label: "End", default: 1 },
    },
    options: {
      switched_on: {
        step: "At the start of the step",
        job: "At the start of the job",
      },
    },
  },
  "job.add": {
    label: "Job",
    tab: "steps",
    prefix: "job",
    fields: {
      steps: { label: "Steps" },
      curve: {
        label: "Curve",
        hint: "A boundary, load case or point load: its reaction force over its displacement",
        placeholder: "none",
      },
      tol: {
        label: "Tolerance",
        hint: "Of the Newton iterations: residual forces relative to the reaction forces (or the forces of pressures and contacts), like commercial codes",
        placeholder: "0.01",
      },
      maxiter: {
        label: "Max. iterations",
        hint: "Newton iterations of a substep",
        placeholder: "16",
      },
      solver: {
        label: "Linear solver",
        hint: "Of the Newton iterations; without it, SuperLU of FElupe",
      },
      "solver.type": { label: "Type", default: "superlu" },
      "solver.method": {
        label: "Method",
        hint: "cg needs a positive definite matrix, minres a symmetric one",
        default: "minres",
      },
      "solver.rtol": {
        label: "Rel. tolerance",
        hint: "Of the iterative method, relative to the residual forces",
        placeholder: "tolerance / 100",
      },
      "solver.maxiter": {
        label: "Max. iterations",
        hint: "Of the iterative method",
        placeholder: "SciPy",
      },
      "solver.precision": {
        label: "Precision",
        hint: "Single: the factorization in float32 needs half the memory; the results are those of double precision, with a few more iterations at tight tolerances",
        placeholder: "double",
      },
      cutback: {
        label: "Cutback",
        hint: "Retries a substep that does not converge with smaller increments",
      },
      "cutback.factor": {
        label: "Factor",
        hint: "Reduces the increment after a failed attempt",
        placeholder: "0.5",
      },
      "cutback.max_cutbacks": {
        label: "Max. cutbacks",
        hint: "Successive reductions; the smallest increment is factor^n",
        placeholder: "10",
      },
      "cutback.growth": {
        label: "Growth",
        hint: "Increases the increment after a converged one; 1 keeps it",
        placeholder: "2",
      },
    },
    options: {
      "solver.type": {
        superlu: "SuperLU (FElupe)",
        spsolve: "spsolve (SciPy)",
        pardiso: "PARDISO (local Python)",
        iterative: "Iterative (SciPy)",
      },
      "solver.precision": {
        double: "Double (float64)",
        single: "Single (float32)",
      },
      "solver.method": {
        minres: "minres (symmetric)",
        cg: "cg (positive definite)",
        gmres: "gmres",
        bicgstab: "bicgstab",
      },
    },
  },
};
