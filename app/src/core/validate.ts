// Validation of the references between commands. Mirrors the Python validation
// (felupe_studio.commands); both are tested with tests/data/validation_cases.json,
// so the messages are identical.
import type { Command } from "./commands";
import { loadcaseProblems } from "./loadcases";
import { needsBulk } from "./materials";
import {
  NAME_MAX_LENGTH,
  NAME_PATTERN,
  RESERVED_KEYWORDS,
  RESERVED_NAMES,
  RESERVED_PREFIXES,
} from "./schema";

export type CommandType = Command["command"];

export type Kind =
  | "mesh"
  | "merge"
  | "cellset"
  | "material"
  | "section"
  | "pointset"
  | "boundary"
  | "step"
  | "job";

/** Kind of object created by each command. */
export const KINDS: Record<CommandType, Kind> = {
  "mesh.import": "mesh",
  "mesh.merge": "merge",
  "cellset.from_tag": "cellset",
  "cellset.from_file": "cellset",
  "material.add": "material",
  "section.add": "section",
  "pointset.add": "pointset",
  "boundary.add": "boundary",
  // a load case is referenced like a boundary (ramps of steps, curves of jobs)
  "loadcase.add": "boundary",
  "step.add": "step",
  "job.add": "job",
};

/** References of a command: field → [kind, is a list]. */
export const REFERENCES: Partial<
  Record<CommandType, Record<string, [Kind, boolean]>>
> = {
  "cellset.from_tag": { mesh: ["mesh", false] },
  "cellset.from_file": { mesh: ["mesh", false] },
  "section.add": { cellset: ["cellset", false], material: ["material", false] },
  "boundary.add": { pointset: ["pointset", false] },
  "step.add": { sections: ["section", true] },
  "job.add": { steps: ["step", true], curve: ["boundary", false] },
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
    for (const name of [command.ramp.boundary, ...(command.ramp.also ?? [])])
      result.push({ field: "ramp", name });
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
  const ramp = copy.ramp as { boundary: string; also?: string[] } | undefined;
  if (command.command === "step.add" && ramp) {
    if (ramp.boundary === from) ramp.boundary = to;
    if (ramp.also) ramp.also = ramp.also.map((n) => (n === from ? to : n));
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
      for (const ref of isList ? (value as string[]) : [value as string]) {
        const other = kindOf(ref);
        if (other === undefined) {
          add(
            `${cmd.command} '${name}' references unknown ${refKind} '${ref}' in '${field}'.`,
          );
        } else if (other !== refKind) {
          add(
            `'${ref}' in '${field}' of '${name}' is a ${other}, not a ${refKind}.`,
          );
        }
      }
    }

    // the ramped boundary of a step
    if (cmd.command === "step.add" && cmd.ramp) {
      for (const ref of [cmd.ramp.boundary, ...(cmd.ramp.also ?? [])]) {
        if (kindOf(ref) !== "boundary") {
          add(`step '${name}' ramps unknown boundary '${ref}'.`);
        }
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

    if (
      cmd.command === "mesh.merge" &&
      [...defined.values()].some(([, c]) => c.command === "mesh.merge")
    ) {
      add("only one mesh.merge is allowed.");
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

  return issues;
}
