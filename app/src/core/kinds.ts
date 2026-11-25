// The kinds of the objects of the commands and the references between them, like
// felupe_studio.commands.
import type { Command } from "./commands";

export type CommandType = Command["command"];

export const AXES = ["x", "y", "z"] as const;

export type Kind =
  | "settings"
  | "parameter"
  | "mesh"
  | "merge"
  | "cellset"
  | "material"
  | "section"
  | "pointset"
  | "rigid"
  | "faceset"
  | "boundary"
  | "symmetry"
  | "constraint"
  | "load"
  | "pressure"
  | "step"
  | "job";

/**
 * The commands of the files next to a project (ADR 0007): of the mesh files, and of
 * the Python scripts of meshes (#182) and of user-defined materials (ADR 0025), like
 * `FILES` of felupe_studio.commands.
 */
export const FILE_COMMANDS: readonly string[] = [
  "mesh.import",
  "mesh.script",
  "material.script",
];

/**
 * The names of the files next to the project that a model uses, once each: of its
 * meshes and of its user-defined materials (like `file_names` of
 * felupe_studio.commands, unsorted).
 */
export const projectFileNames = (commands: readonly Command[]): string[] => [
  ...new Set(
    commands.flatMap((c) =>
      FILE_COMMANDS.includes(c.command) && "file" in c ? [c.file] : [],
    ),
  ),
];

/** Commands of which a model has at most one. */
export const SINGLE: string[] = ["model.settings", "mesh.merge"];

/** Kind of object created by each command. */
export const KINDS: Record<CommandType, Kind> = {
  "mesh.import": "mesh",
  // a mesh made by a script (#182)
  "mesh.script": "mesh",
  // a mesh made by a tool of FElupe (ADR 0019)
  "mesh.generate": "mesh",
  "model.settings": "settings",
  "parameter.add": "parameter",
  "mesh.merge": "merge",
  "cellset.from_tag": "cellset",
  "cellset.from_file": "cellset",
  "material.add": "material",
  // a user-defined material of a Python file (ADR 0025), referenced by a section
  // like a material of the registry
  "material.script": "material",
  "section.add": "section",
  "pointset.add": "pointset",
  // a control point is a point set of one point (boundaries, constraints, curves)
  "point.add": "pointset",
  // a rigid surface (#219): its reference point is used like a point set of one
  // point by boundaries and loads
  "rigid.add": "rigid",
  "faceset.add": "faceset",
  "boundary.add": "boundary",
  // a load case is referenced like a boundary (ramps of steps, curves of jobs)
  "loadcase.add": "boundary",
  // symmetry planes (#186): boundaries of all steps, neither ramped nor a curve
  "symmetry.add": "symmetry",
  "mpc.add": "constraint",
  // a Cartesian constraint (#421): an item of the steps like a multi-point
  // constraint, also ramped by the steps and the curve of a job
  "cartesian.add": "constraint",
  // a cylindrical constraint (#422): like a Cartesian constraint, about an axis
  "cylindrical.add": "constraint",
  // a contact with a rigid surface (#220): an item of the steps like a constraint
  "contact.add": "constraint",
  "load.add": "load",
  "pressure.add": "pressure",
  "step.add": "step",
  "job.add": "job",
};

/**
 * The commands of the vertices of the control points: control points and the
 * reference points of rigid surfaces (#219).
 */
export type Vertex = "point.add" | "rigid.add";
export const VERTICES: Record<Vertex, string> = {
  "point.add": "control point",
  "rigid.add": "rigid surface",
};

/** Kinds of objects that a step can ramp (a load case is a boundary). */
export const RAMPED: readonly Kind[] = ["boundary", "load", "pressure"];

/**
 * The constraints that a step can ramp and that can be the curve of a job: those in
 * local coordinates (#421, #422).
 */
export const MOVED: readonly CommandType[] = [
  "cartesian.add",
  "cylindrical.add",
];

/**
 * Whether a reference to objects of these kinds takes the object of a command: of
 * the constraints together with the boundaries (the ramp of a step and the curve of
 * a job) only those that a step moves (#421).
 */
export function takes(kinds: readonly Kind[], command: CommandType): boolean {
  const kind = KINDS[command];
  if (!kinds.includes(kind)) return false;
  return (
    kind !== "constraint" ||
    !kinds.includes("boundary") ||
    MOVED.includes(command)
  );
}

/**
 * The names of the kinds of references in the messages, if not the kinds
 * themselves: the curve of a job is a constraint only of a Cartesian or cylindrical
 * constraint (#421, #422).
 */
export const REFERENCE_NAMES: Record<string, string> = {
  "job.add curve": "boundary, load, Cartesian or cylindrical constraint",
};

/** The name of a kind in the messages (#219). */
export const kindName = (kind: Kind) =>
  kind === "rigid" ? "rigid surface" : kind;

/** The kind or kinds of objects that a reference may point to. */
export type RefKind = Kind | readonly Kind[];

/** The kinds of a reference as a list. */
export const kindsOf = (kind: RefKind): readonly Kind[] =>
  typeof kind === "string" ? [kind] : kind;

/**
 * References of a command: field (or a path of fields, joined by dots) → [kind or
 * kinds, is a list].
 */
export const REFERENCES: Partial<
  Record<CommandType, Record<string, [RefKind, boolean]>>
> = {
  "mesh.script": { parameters: ["parameter", true] },
  "material.script": { parameters: ["parameter", true] },
  // the meshes that an operation of the mesh tools takes (ADR 0019)
  "mesh.generate": { inputs: ["mesh", true] },
  "cellset.from_tag": { mesh: ["mesh", false] },
  "cellset.from_file": { mesh: ["mesh", false] },
  "section.add": { cellset: ["cellset", false], material: ["material", false] },
  "faceset.add": { section: ["section", false] },
  // the points of the cells of a section (#241), a path in the command
  "pointset.add": { "select.section": ["section", false] },
  // the reference point of a rigid surface is moved by boundaries (#219)
  "boundary.add": { pointset: [["pointset", "rigid"], false] },
  "mpc.add": {
    points: ["pointset", false],
    center: ["pointset", false],
    rotation: ["pointset", false],
  },
  "cartesian.add": { points: ["pointset", false] },
  "cylindrical.add": { points: ["pointset", false] },
  "load.add": { points: [["pointset", "rigid"], false] },
  "contact.add": {
    points: [["pointset", "faceset"], false],
    surface: ["rigid", false],
  },
  "pressure.add": { faces: ["faceset", false] },
  "step.add": {
    sections: ["section", true],
    constraints: ["constraint", true],
    loads: [["load", "pressure"], true],
    // the boundaries, load cases and symmetry planes of a step (#393)
    boundaries: [["boundary", "symmetry"], true],
  },
  // the curve of a job: a boundary (force-displacement), a point load or a
  // Cartesian or cylindrical constraint (#421, #422, checked by a rule)
  "job.add": {
    steps: ["step", true],
    curve: [["boundary", "load", "constraint"], false],
  },
};

/** The value of a field of a command, or of a path of fields joined by dots. */
export function valueAt(command: object, path: string): unknown {
  let value: unknown = command;
  for (const key of path.split(".")) {
    if (typeof value !== "object" || value === null || !(key in value))
      return undefined;
    value = (value as Record<string, unknown>)[key];
  }
  return value;
}
