// Registry of labels, hints and defaults for the commands. The structure of a form
// (fields, types, ranges, variants) comes from the command schema, see form.ts; this
// file only adds what the schema does not know.
import type { Command } from "./commands";
import { needsBulk } from "./materials";
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
   * Adjust the defaults of a new object to the model, e.g. a section takes a cell
   * set without a section. Values of a preset are applied afterwards.
   */
  initial?: (
    draft: Record<string, unknown>,
    commands: readonly Command[],
  ) => Record<string, unknown>;
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
    ...draft,
    ...(sets.length ? { points: sets.at(-1)!.name } : {}),
    ...(points.length ? { center: points.at(-1)!.name } : {}),
  };
}

/** The first cell set without a section, and u-p-J for incompressible materials. */
function initialSection(
  draft: Record<string, unknown>,
  commands: readonly Command[],
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
  const material = commands.find((c) => c.name === next.material);
  if (material?.command === "material.add" && needsBulk(material)) {
    next.formulation = "u-p-J";
  }
  return next;
}

export const KIND_LABELS: Record<Kind, string> = {
  settings: "Settings",
  mesh: "Mesh",
  merge: "Merge",
  cellset: "Cell set",
  material: "Material",
  section: "Section",
  pointset: "Point set",
  boundary: "Boundary",
  constraint: "Constraint",
  load: "Load",
  step: "Step",
  job: "Job",
};

const AXES = { x: "x", y: "y", z: "z" };

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
    },
  },
  "cellset.from_file": {
    label: "Cell set of a mesh",
    tab: "mesh",
    prefix: "cells",
    fields: {
      mesh: { label: "Mesh" },
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
    },
  },
  "section.add": {
    label: "Section",
    tab: "sections",
    prefix: "section",
    fields: {
      cellset: { label: "Cell set" },
      material: { label: "Material" },
      formulation: {
        label: "Formulation",
        hint: "u-p-J for (nearly) incompressible materials; linear tetrahedra get a bubble point (MINI)",
        default: "u",
      },
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
    },
    options: {
      formulation: { u: "Displacement (u)", "u-p-J": "Mixed (u, p, J)" },
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
      "select.atol": { label: "Tolerance", placeholder: "1e-8" },
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
        points: "By nodes",
        ids: "By point ids",
      },
      "select.axis": AXES,
    },
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
        hint: "Prescribed displacement",
        placeholder: "0",
      },
    },
    options: {
      constrained: AXES,
    },
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
  "model.settings": {
    label: "Model settings",
    tab: "mesh",
    prefix: "settings",
    single: true,
    fields: {
      units: {
        label: "Units",
        hint: "What the numbers mean; nothing is converted",
      },
      "units.length": { label: "Length", default: "mm" },
      "units.force": { label: "Force", default: "N" },
    },
    options: {
      "units.length": { mm: "mm", m: "m" },
      "units.force": { N: "N", kN: "kN" },
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
  "mpc.add": {
    label: "Multi-point constraint",
    tab: "loads",
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
  "load.add": {
    label: "Point load",
    tab: "loads",
    prefix: "load",
    noun: "load",
    fields: {
      points: {
        label: "Points",
        hint: "A point set or a control point",
      },
      force: {
        label: "Force",
        hint: "fx, fy, fz at every point; a ramp of a step scales it",
        default: [0, 0, 0],
      },
    },
  },
  "step.add": {
    label: "Step",
    tab: "steps",
    prefix: "step",
    fields: {
      sections: { label: "Sections", placeholder: "all" },
      constraints: { label: "Constraints", placeholder: "all" },
      loads: { label: "Loads", placeholder: "all" },
      ramp: { label: "Ramp" },
      "ramp.num": { label: "Increments", default: 5 },
      "ramp.items": {
        label: "Ramped",
        hint: "Boundaries, load cases or loads (a factor of the force), each from its start to its end value",
      },
      "ramp.items.target": { label: "Item", unique: true },
      "ramp.items.start": { label: "Start", placeholder: "0" },
      "ramp.items.end": { label: "End", default: 1 },
    },
  },
  "job.add": {
    label: "Job",
    tab: "steps",
    prefix: "job",
    fields: {
      steps: { label: "Steps" },
      curve: {
        label: "Curve boundary",
        hint: "Records the reaction force over the displacement",
        placeholder: "none",
      },
      tol: {
        label: "Tolerance",
        hint: "Of the Newton iterations: residual forces relative to the reaction forces",
        placeholder: "1.49e-8",
      },
      maxiter: {
        label: "Max. iterations",
        hint: "Newton iterations of a substep",
        placeholder: "16",
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
  },
};
