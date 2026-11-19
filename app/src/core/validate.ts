// Validation of a command list: the expressions of the parameters, then the rules
// of the commands (rules.ts), like `errors()` of felupe_studio.commands, and the
// references between the commands (kinds.ts).
import type { Command } from "./commands";
import type { Command as ResolvedCommand } from "./resolved";
import { REFERENCES, valueAt } from "./kinds";
import { type Resolved, renameParameter, resolveCommands } from "./resolve";
import { type Issue, problems } from "./rules";

export {
  type CommandType,
  type Kind,
  KINDS,
  kindsOf,
  RAMPED,
  REFERENCES,
  type RefKind,
  SINGLE,
} from "./kinds";
export { type Issue, nameProblem } from "./rules";

/** Names referenced by a command, with the field they appear in. */
export function references(
  command: Command,
): { field: string; name: string }[] {
  const fields = REFERENCES[command.command] ?? {};
  const result: { field: string; name: string }[] = [];
  for (const [field, [, isList]] of Object.entries(fields)) {
    const value = valueAt(command, field);
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
  for (const [path, [, isList]] of Object.entries(
    REFERENCES[command.command] ?? {},
  )) {
    // the object of the field of a path, e.g. `select` of `select.section`
    const keys = path.split(".");
    const field = keys.pop()!;
    const parent = valueAt(copy, keys.join(".") || ".") as
      Record<string, unknown> | undefined;
    const owner = keys.length ? parent : copy;
    if (typeof owner !== "object" || owner === null) continue;
    const value = owner[field];
    if (isList && Array.isArray(value))
      owner[field] = value.map((n) => (n === from ? to : n));
    else if (value === from) owner[field] = to;
  }
  const ramp = copy.ramp as { items: { target: string }[] } | undefined;
  if (command.command === "step.add" && ramp) {
    for (const item of ramp.items) if (item.target === from) item.target = to;
  }
  // the expressions of a renamed parameter (#242)
  return renameParameter(copy as unknown as Command, from, to);
}

/**
 * Validate a command list: first the expressions of the parameters (#242), then,
 * with their values, the references between the commands, like `errors()` in
 * Python.
 */
export function validate(commands: readonly Command[]): Issue[] {
  return validateResolution(resolveCommands(commands));
}

/** The issues of the commands with the values of their expressions. */
export function validateResolution({
  commands: resolved,
  problems,
}: Resolved): Issue[] {
  if (problems.length)
    return problems.map(({ index, name, message, field }) => ({
      index,
      name,
      message,
      // the field of the form: a vector without the index of its component, e.g.
      // `coordinates` of `coordinates.1`, a cell of rows with it (`ramp.items.0.end`)
      field: field.replace(/(\.\d+)+$/, ""),
    }));
  return validateResolved(resolved);
}

/** Validate the rules of the commands with the values of their expressions. */
export function validateResolved(
  commands: readonly ResolvedCommand[],
): Issue[] {
  return problems(commands);
}
