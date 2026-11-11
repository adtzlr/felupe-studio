// Validation of the references between commands. Mirrors the Python validation
// (felupe_studio.commands); both are tested with tests/data/validation_cases.json,
// so the messages are identical.
import type { Command } from "./commands";
import { loadcaseProblems } from "./loadcases";
import { materialProblems, needsBulk } from "./materials";
import {
  NAME_MAX_LENGTH,
  NAME_PATTERN,
  RESERVED_KEYWORDS,
  RESERVED_NAMES,
  RESERVED_PREFIXES,
} from "./schema";

export type CommandType = Command["command"];

const AXES = ["x", "y", "z"] as const;

export type Kind =
  | "settings"
  | "mesh"
  | "merge"
  | "cellset"
  | "material"
  | "section"
  | "pointset"
  | "boundary"
  | "constraint"
  | "load"
  | "step"
  | "job";

/** Kind of object created by each command. */
/** Commands of which a model has at most one. */
export const SINGLE: string[] = ["model.settings", "mesh.merge"];

export const KINDS: Record<CommandType, Kind> = {
  "mesh.import": "mesh",
  "model.settings": "settings",
  "mesh.merge": "merge",
  "cellset.from_tag": "cellset",
  "cellset.from_file": "cellset",
  "material.add": "material",
  "section.add": "section",
  "pointset.add": "pointset",
  // a control point is a point set of one point (boundaries, constraints, curves)
  "point.add": "pointset",
  "boundary.add": "boundary",
  // a load case is referenced like a boundary (ramps of steps, curves of jobs)
  "loadcase.add": "boundary",
  "mpc.add": "constraint",
  "load.add": "load",
  "step.add": "step",
  "job.add": "job",
};

/** Kinds of objects that a step can ramp (a load case is a boundary). */
export const RAMPED: readonly Kind[] = ["boundary", "load"];

/** The kind or kinds of objects that a reference may point to. */
export type RefKind = Kind | readonly Kind[];

/** The kinds of a reference as a list. */
export const kindsOf = (kind: RefKind): readonly Kind[] =>
  typeof kind === "string" ? [kind] : kind;

/** References of a command: field → [kind or kinds, is a list]. */
export const REFERENCES: Partial<
  Record<CommandType, Record<string, [RefKind, boolean]>>
> = {
  "cellset.from_tag": { mesh: ["mesh", false] },
  "cellset.from_file": { mesh: ["mesh", false] },
  "section.add": { cellset: ["cellset", false], material: ["material", false] },
  "boundary.add": { pointset: ["pointset", false] },
  "mpc.add": {
    points: ["pointset", false],
    center: ["pointset", false],
    rotation: ["pointset", false],
  },
  "load.add": { points: ["pointset", false] },
  "step.add": {
    sections: ["section", true],
    constraints: ["constraint", true],
    loads: ["load", true],
  },
  // the curve of a job: a boundary (force-displacement) or a point load
  "job.add": { steps: ["step", true], curve: [["boundary", "load"], false] },
};

export interface Issue {
  /** Index of the command in the command list. */
  index: number;
  /** Name of the command. */
  name: string;
  /** Message, prefixed with `commands/<index>: ` like in Python. */
  message: string;
}

/** Names referenced by a command, with the field they appear in. */
export function references(
  command: Command,
): { field: string; name: string }[] {
  const fields = REFERENCES[command.command] ?? {};
  const result: { field: string; name: string }[] = [];
  for (const [field, [, isList]] of Object.entries(fields)) {
    const value = (command as unknown as Record<string, unknown>)[field];
    if (value === undefined) continue;
    const names = isList ? (value as string[]) : [value as string];
    result.push(...names.map((name) => ({ field, name })));
  }
  if (command.command === "step.add" && command.ramp) {
    for (const item of command.ramp.items)
      result.push({ field: "ramp", name: item.target });
  }
  return result;
}

/**
 * The commands in an order in which every reference points to an object before
 * (a stable topological order): a command that references a later object moves
 * behind it, with the commands that depend on it; all other commands keep their
 * order. References to names that do not exist do not move a command (the
 * validation reports them).
 */
export function order(commands: readonly Command[]): Command[] {
  const names = new Set(commands.map((c) => c.name));
  const placed = new Set<string>();
  const rest = [...commands];
  const result: Command[] = [];
  while (rest.length) {
    // the first command whose references are all placed
    let index = rest.findIndex((c) =>
      references(c).every(
        (r) => placed.has(r.name) || !names.has(r.name) || r.name === c.name,
      ),
    );
    // a cycle cannot be ordered: keep the rest as it is
    if (index < 0) index = 0;
    const [command] = rest.splice(index, 1);
    result.push(command);
    placed.add(command.name);
  }
  return result;
}

/** A copy of the command in which references to one name point to another. */
export function renameReferences(
  command: Command,
  from: string,
  to: string,
): Command {
  const copy = structuredClone(command) as unknown as Record<string, unknown>;
  for (const [field, [, isList]] of Object.entries(
    REFERENCES[command.command] ?? {},
  )) {
    const value = copy[field];
    if (isList && Array.isArray(value))
      copy[field] = value.map((n) => (n === from ? to : n));
    else if (value === from) copy[field] = to;
  }
  const ramp = copy.ramp as { items: { target: string }[] } | undefined;
  if (command.command === "step.add" && ramp) {
    for (const item of ramp.items) if (item.target === from) item.target = to;
  }
  return copy as unknown as Command;
}

/** Reason why a name is not allowed, or undefined if it is allowed. */
export function nameProblem(name: string): string | undefined {
  if (!NAME_PATTERN.test(name)) {
    return "A name starts with a letter or _ and contains only letters, digits and _.";
  }
  if (name.length > NAME_MAX_LENGTH) {
    return `A name has at most ${NAME_MAX_LENGTH} characters.`;
  }
  if (
    RESERVED_KEYWORDS.has(name) ||
    RESERVED_NAMES.has(name) ||
    RESERVED_PREFIXES.some((prefix) => name.startsWith(prefix))
  ) {
    return `name '${name}' is reserved for the generated script.`;
  }
  return undefined;
}

/** Validate the references between the commands of a command list. */
export function validate(commands: readonly Command[]): Issue[] {
  const issues: Issue[] = [];
  const defined = new Map<string, [number, Command]>();
  const kindOf = (name: string) => {
    const entry = defined.get(name);
    return entry ? KINDS[entry[1].command] : undefined;
  };

  commands.forEach((cmd, i) => {
    const name = cmd.name;
    const add = (message: string) =>
      issues.push({ index: i, name, message: `commands/${i}: ${message}` });

    // references must point to objects of the right kind, created before
    for (const [field, [refKind, isList]] of Object.entries(
      REFERENCES[cmd.command] ?? {},
    )) {
      const value = (cmd as unknown as Record<string, unknown>)[field];
      if (value === undefined) continue;
      const kinds = kindsOf(refKind);
      const text = kinds.join(" or ");
      for (const ref of isList ? (value as string[]) : [value as string]) {
        const other = kindOf(ref);
        if (other === undefined) {
          add(
            `${cmd.command} '${name}' references unknown ${text} '${ref}' in '${field}'.`,
          );
        } else if (!kinds.includes(other)) {
          add(
            `'${ref}' in '${field}' of '${name}' is a ${other}, not a ${text}.`,
          );
        }
      }
    }

    // the ramped items of a step
    if (cmd.command === "step.add" && cmd.ramp) {
      const targets = cmd.ramp.items.map((item) => item.target);
      for (const ref of targets) {
        const kind = kindOf(ref);
        if (kind === undefined || !RAMPED.includes(kind)) {
          add(`step '${name}' ramps unknown boundary or load '${ref}'.`);
        }
      }
      const twice = targets.filter((t, i) => targets.indexOf(t) !== i);
      for (const ref of [...new Set(twice)].sort()) {
        add(`step '${name}' ramps '${ref}' twice.`);
      }
    }

    // cell sets from tags need a mesh imported with a tag
    if (cmd.command === "cellset.from_tag" && defined.has(cmd.mesh)) {
      const mesh = defined.get(cmd.mesh)![1];
      if (mesh.command === "mesh.import" && mesh.tag === undefined) {
        add(
          `cell set '${name}' uses tag values, but mesh '${mesh.name}' was imported without a tag.`,
        );
      }
    }

    if (cmd.command === "loadcase.add") {
      for (const problem of loadcaseProblems(cmd)) add(problem);
    }

    // a model with an optional bulk modulus has no volumetric part without it
    if (cmd.command === "section.add" && cmd.formulation === "u") {
      const material = defined.get(cmd.material)?.[1];
      if (material?.command === "material.add" && needsBulk(material)) {
        add(
          `section '${name}' uses the displacement formulation with ${material.model} ` +
            `'${material.name}' without a bulk modulus. Add 'bulk' to the material or use 'u-p-J'.`,
        );
      }
    }

    // control points at the same coordinates are merged by the script
    if (cmd.command === "point.add") {
      const same = [...defined.values()].find(
        ([, c]) =>
          c.command === "point.add" &&
          c.coordinates.every((x, k) => x === cmd.coordinates[k]),
      );
      if (same) {
        add(
          `control point '${name}' is at the coordinates of control point '${same[1].name}': the script merges them.`,
        );
      }
    }

    // a rotation point needs all components of the center point
    if (
      cmd.command === "mpc.add" &&
      cmd.rotation !== undefined &&
      new Set(cmd.constrained).size < 3
    ) {
      add(
        `constraint '${name}' with a rotation point connects all components x, y and z.`,
      );
    }

    if (cmd.command === "material.add") {
      for (const problem of materialProblems(cmd)) {
        add(`material '${name}': ${problem}`);
      }
    }

    if (
      SINGLE.includes(cmd.command) &&
      [...defined.values()].some(([, c]) => c.command === cmd.command)
    ) {
      add(`only one ${cmd.command} is allowed.`);
    }

    const problem = nameProblem(name);
    if (problem?.endsWith("reserved for the generated script.")) add(problem);

    const previous = defined.get(name);
    if (previous) {
      add(`name '${name}' is already used by commands/${previous[0]}.`);
    } else {
      defined.set(name, [i, cmd]);
    }
  });

  // a control point has no stiffness of its own: its components need a boundary
  // or a constraint (as the center point, or all of them as the rotation point)
  commands.forEach((cmd, i) => {
    if (cmd.command !== "point.add") return;
    const fixed = new Set<string>();
    for (const c of commands) {
      if (c.command === "boundary.add" && c.pointset === cmd.name)
        c.constrained.forEach((a) => fixed.add(a));
      else if (c.command === "mpc.add") {
        if (c.center === cmd.name) c.constrained.forEach((a) => fixed.add(a));
        if (c.rotation === cmd.name) AXES.forEach((a) => fixed.add(a));
      }
    }
    const missing = AXES.filter((a) => !fixed.has(a));
    if (missing.length) {
      const components =
        missing.length > 1
          ? `${missing.slice(0, -1).join(", ")} and ${missing.at(-1)}`
          : missing[0];
      issues.push({
        index: i,
        name: cmd.name,
        message:
          `commands/${i}: control point '${cmd.name}' has no stiffness in ` +
          `${components}: it needs a boundary or a multi-point constraint of ` +
          "these components.",
      });
    }
  });

  return issues;
}
