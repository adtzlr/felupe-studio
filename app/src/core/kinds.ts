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

/** Commands of which a model has at most one. */
export const SINGLE: string[] = ["model.settings", "mesh.merge"];

/** Kind of object created by each command. */
export const KINDS: Record<CommandType, Kind> = {
  "mesh.import": "mesh",
  // a mesh made by a script (#182)
  "mesh.script": "mesh",
  "model.settings": "settings",
  "parameter.add": "parameter",
  "mesh.merge": "merge",
  "cellset.from_tag": "cellset",
  "cellset.from_file": "cellset",
  "material.add": "material",
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
  },
  // the curve of a job: a boundary (force-displacement) or a point load
  "job.add": { steps: ["step", true], curve: [["boundary", "load"], false] },
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
