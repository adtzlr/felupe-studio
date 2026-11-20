// The values of the expressions of the parameters in the commands (#242, ADR 0013),
// like felupe_studio.expressions.resolve: the fields that may hold an expression
// come from the schema (the types ["number", "string"]), their problems are issues
// with the messages of the Python validation (the shared cases).
import type { Command } from "./commands";
import { ExpressionError, evaluate, names, rename } from "./expressions";
import type { Command as ResolvedCommand } from "./resolved";
import { schema } from "./schema";

export type { ResolvedCommand };

type SchemaNode = Record<string, unknown>;
type Path = (string | number)[];

const DEFS = schema.$defs as unknown as Record<string, SchemaNode>;

/** A node of the schema with its reference resolved. */
function definition(node: SchemaNode): SchemaNode {
  let current = node;
  while (typeof current.$ref === "string")
    current = DEFS[current.$ref.split("/").at(-1)!];
  return current;
}

/** Whether a branch of a oneOf may describe an instance (constants, required). */
function matches(branch: SchemaNode, instance: unknown): boolean {
  const node = definition(branch);
  if (!instance || typeof instance !== "object" || Array.isArray(instance))
    return true;
  const object = instance as Record<string, unknown>;
  for (const [key, child] of Object.entries(
    (node.properties ?? {}) as Record<string, SchemaNode>,
  )) {
    if ("const" in child && object[key] !== child.const) return false;
  }
  return ((node.required ?? []) as string[]).every((key) => key in object);
}

const BOUNDS = [
  "minimum",
  "maximum",
  "exclusiveMinimum",
  "exclusiveMaximum",
] as const;

export interface ExpressionField {
  /** The path of keys and indices. */
  path: Path;
  /** The value is an integer, e.g. the substeps of a ramp. */
  integer: boolean;
  /** The bounds of the value of the schema. */
  bounds: Partial<Record<(typeof BOUNDS)[number], number>>;
}

/**
 * The fields of a command that hold an expression, in the order of the schema, like
 * `fields()` of felupe_studio.expressions.
 */
export function expressionFields(command: Command): ExpressionField[] {
  const walker = new FieldWalker();
  walker.walk(
    { oneOf: (DEFS.Command as { oneOf: SchemaNode[] }).oneOf },
    command,
    [],
  );
  return walker.result;
}

/**
 * The fields of an expression, found by walking the schema along a command, like
 * `_Fields` of felupe_studio.expressions.
 */
class FieldWalker {
  result: ExpressionField[] = [];
  private seen = new Set<string>();

  walk(raw: SchemaNode, instance: unknown, path: Path): void {
    const node = definition(raw);
    this.branches(node, instance, path);
    if (this.leaf(node, instance, path)) return;
    if (instance && typeof instance === "object" && !Array.isArray(instance)) {
      const object = instance as Record<string, unknown>;
      for (const [key, child] of Object.entries(
        (node.properties ?? {}) as Record<string, SchemaNode>,
      ))
        if (key in object) this.walk(child, object[key], [...path, key]);
    } else if (Array.isArray(instance) && node.items) {
      instance.forEach((item, i) =>
        this.walk(node.items as SchemaNode, item, [...path, i]),
      );
    }
  }

  /** The branches of a node that may describe the instance. */
  private branches(node: SchemaNode, instance: unknown, path: Path): void {
    for (const key of ["oneOf", "anyOf"] as const)
      for (const branch of (node[key] ?? []) as SchemaNode[])
        if (matches(branch, instance)) this.walk(branch, instance, path);
    for (const branch of (node.allOf ?? []) as SchemaNode[])
      this.walk(branch, instance, path);
    for (const key of ["then", "else"] as const)
      if (node[key]) this.walk(node[key] as SchemaNode, instance, path);
  }

  /** A string where the schema takes types: an expression, if one is a number. */
  private leaf(node: SchemaNode, instance: unknown, path: Path): boolean {
    const types = node.type;
    if (typeof instance !== "string" || !Array.isArray(types)) return false;
    const numeric = types.includes("number") || types.includes("integer");
    const id = JSON.stringify(path);
    if (!types.includes("string") || !numeric || this.seen.has(id)) return true;
    this.seen.add(id);
    const bounds: ExpressionField["bounds"] = {};
    for (const key of BOUNDS)
      if (typeof node[key] === "number") bounds[key] = node[key];
    this.result.push({ path, integer: types.includes("integer"), bounds });
    return true;
  }
}

/**
 * A number as text like Python's `number_text()` (JavaScript's `String()`), e.g. 3,
 * 0.5 or 1e-7.
 */
export const numberText = (value: number): string => String(value);

const RULES: Record<
  (typeof BOUNDS)[number],
  [(v: number, b: number) => boolean, string]
> = {
  minimum: [(v, b) => v >= b, "at least"],
  maximum: [(v, b) => v <= b, "at most"],
  exclusiveMinimum: [(v, b) => v > b, "greater than"],
  exclusiveMaximum: [(v, b) => v < b, "less than"],
};

/** The bound of the schema that a value breaks, as a phrase. */
function boundProblem(
  value: number,
  bounds: ExpressionField["bounds"],
): string | undefined {
  for (const key of BOUNDS) {
    const bound = bounds[key];
    if (bound !== undefined && !RULES[key][0](value, bound))
      return `${RULES[key][1]} ${numberText(bound)}`;
  }
  return undefined;
}

/** The names in quotes as a list in words: 'a', 'a' and 'b', 'a', 'b' and 'c'. */
function listed(items: string[]): string {
  const quoted = items.map((n) => `'${n}'`);
  return quoted.length === 1
    ? quoted[0]
    : `${quoted.slice(0, -1).join(", ")} and ${quoted.at(-1)}`;
}

/**
 * The groups of derived parameters that depend on themselves (#333): the strongly
 * connected components with more than one parameter or a parameter that uses
 * itself; `uses` maps a name to the derived parameters it uses.
 */
function cycles(uses: Map<string, string[]>): Set<string>[] {
  const index = new Map<string, number>();
  const low = new Map<string, number>();
  const stack: string[] = [];
  const onStack = new Set<string>();
  const groups: Set<string>[] = [];
  const visit = (name: string) => {
    index.set(name, index.size);
    low.set(name, index.get(name)!);
    stack.push(name);
    onStack.add(name);
    for (const other of uses.get(name)!) {
      if (!index.has(other)) {
        visit(other);
        low.set(name, Math.min(low.get(name)!, low.get(other)!));
      } else if (onStack.has(other))
        low.set(name, Math.min(low.get(name)!, index.get(other)!));
    }
    if (low.get(name) !== index.get(name)) return;
    const group = new Set<string>();
    for (;;) {
      const other = stack.pop()!;
      onStack.delete(other);
      group.add(other);
      if (other === name) break;
    }
    if (group.size > 1 || uses.get(name)!.includes(name)) groups.push(group);
  };
  for (const name of uses.keys()) if (!index.has(name)) visit(name);
  return groups;
}

export interface Parameters {
  /** The values by name, without those with a problem. */
  values: Record<string, number>;
  /** The messages of the derived parameters with a problem, by command index. */
  problems: Map<number, string>;
  /** The derived parameters without a value: with a problem, or using one. */
  failed: Set<string>;
  /** The derived parameters with a value, in the order of their evaluation. */
  order: string[];
}

/**
 * The values of the parameters (ADR 0021), like felupe_studio.expressions.Parameters:
 * a free parameter is its number, a derived parameter the value of its expression,
 * evaluated in the order of the dependencies (parameters without a dependency
 * between them in the order of the command list). Integer parameters are integers,
 * like the script.
 */
export function evaluateParameters(commands: readonly Command[]): Parameters {
  const result: Parameters = {
    values: {},
    problems: new Map(),
    failed: new Set(),
    order: [],
  };
  const fail = (index: number, name: string, message?: string) => {
    result.failed.add(name);
    if (message) result.problems.set(index, message);
  };
  const derived = new Map<
    string,
    { index: number; text: string; integer: boolean; used: string[] }
  >();
  commands.forEach((c, index) => {
    if (c.command !== "parameter.add") return;
    if (typeof c.value !== "string") {
      result.values[c.name] = c.integer ? Math.trunc(c.value) : c.value;
      return;
    }
    try {
      const used = names(c.value);
      derived.set(c.name, {
        index,
        text: c.value,
        integer: !!c.integer,
        used,
      });
    } catch (error) {
      if (!(error instanceof ExpressionError)) throw error;
      fail(index, c.name, error.message);
    }
  });
  const uses = new Map(
    [...derived].map(([name, d]) => [
      name,
      d.used.filter((u) => derived.has(u)),
    ]),
  );
  for (const group of cycles(uses)) {
    for (const name of group) {
      const others = [...group]
        .filter((n) => n !== name)
        .sort((a, b) => derived.get(a)!.index - derived.get(b)!.index);
      const through = others.length ? ` through ${listed(others)}` : "";
      fail(
        derived.get(name)!.index,
        name,
        `'${name}' depends on itself${through}.`,
      );
    }
  }
  const pending = [...derived.keys()].filter((n) => !result.failed.has(n));
  while (pending.length) {
    // the first in the command list whose derived parameters are known
    const name = pending.find(
      (n) => !uses.get(n)!.some((u) => pending.includes(u)),
    )!;
    pending.splice(pending.indexOf(name), 1);
    const { index, text, integer, used } = derived.get(name)!;
    // only the cause is reported, at the parameter with the problem
    if (used.some((u) => result.failed.has(u))) {
      fail(index, name);
      continue;
    }
    let value: number;
    try {
      value = evaluate(text, result.values);
    } catch (error) {
      if (!(error instanceof ExpressionError)) throw error;
      fail(index, name, error.message);
      continue;
    }
    if (integer && !Number.isInteger(value)) {
      fail(index, name, `'${text}' is ${numberText(value)}, not an integer.`);
      continue;
    }
    result.values[name] = value;
    result.order.push(name);
  }
  return result;
}

/**
 * The values of the parameters, integer parameters as integers, like the script;
 * derived parameters with the values of their expressions (ADR 0021).
 */
export function parameterValues(
  commands: readonly Command[],
): Record<string, number> {
  return evaluateParameters(commands).values;
}

/** Whether an expression uses a derived parameter without a value (ADR 0021). */
function usesFailed(text: string, failed: ReadonlySet<string>): boolean {
  if (!failed.size) return false;
  try {
    return names(text).some((n) => failed.has(n));
  } catch (error) {
    if (!(error instanceof ExpressionError)) throw error;
    return false;
  }
}

export interface ExpressionProblem {
  index: number;
  name: string;
  /** The field of the expression, its path joined by dots. */
  field: string;
  message: string;
}

export interface Resolved {
  /**
   * The commands with the values of their expressions; a command with a problem of
   * an expression is left out (the viewer does not draw it).
   */
  commands: readonly ResolvedCommand[];
  /** The problems of the expressions, like the Python validation. */
  problems: ExpressionProblem[];
}

/** The commands with the values of their expressions, and the problems of these. */
export function resolveCommands(commands: readonly Command[]): Resolved {
  const parameters = evaluateParameters(commands);
  const { values } = parameters;
  const problems: ExpressionProblem[] = [];
  const resolved: ResolvedCommand[] = [];
  commands.forEach((command, index) => {
    if (command.command === "parameter.add") {
      // a derived parameter (ADR 0021), evaluated before the other fields
      if (typeof command.value !== "string") {
        resolved.push(command as ResolvedCommand);
        return;
      }
      const problem = parameters.problems.get(index);
      if (problem)
        problems.push({
          index,
          name: command.name,
          field: "value",
          message: `commands/${index}: 'value' of '${command.name}': ${problem}`,
        });
      if (command.name in values)
        resolved.push({
          ...command,
          value: values[command.name],
        } as ResolvedCommand);
      return;
    }
    const fields = expressionFields(command);
    if (!fields.length) {
      resolved.push(command as ResolvedCommand);
      return;
    }
    const copy = structuredClone(command) as unknown as Record<string, unknown>;
    let failed = false;
    for (const { path, integer, bounds } of fields) {
      const owner = path
        .slice(0, -1)
        .reduce<Record<string | number, unknown>>(
          (o, key) => o[key] as Record<string | number, unknown>,
          copy,
        );
      const key = path.at(-1)!;
      const text = owner[key] as string;
      // a field of a derived parameter without a value: only the cause is reported
      if (usesFailed(text, parameters.failed)) {
        failed = true;
        continue;
      }
      const field = path.join(".");
      const report = (problem: string) => {
        failed = true;
        problems.push({
          index,
          name: command.name,
          field,
          message: `commands/${index}: '${field}' of '${command.name}': ${problem}`,
        });
      };
      let value: number;
      try {
        value = evaluate(text, values);
      } catch (error) {
        if (!(error instanceof ExpressionError)) throw error;
        report(error.message);
        continue;
      }
      if (integer && !Number.isInteger(value)) {
        report(`'${text}' is ${numberText(value)}, not an integer.`);
        continue;
      }
      const bound = boundProblem(value, bounds);
      if (bound) {
        report(`'${text}' is ${numberText(value)}, it must be ${bound}.`);
        continue;
      }
      owner[key] = value;
    }
    if (!failed) resolved.push(copy as unknown as ResolvedCommand);
  });
  return { commands: resolved, problems };
}

/** Whether an expression of a command uses a name, e.g. of a parameter. */
export function usesName(command: Command, name: string): boolean {
  return expressionFields(command).some(({ path }) => {
    const text = path.reduce<unknown>(
      (o, key) => (o as Record<string | number, unknown>)[key],
      command,
    ) as string;
    try {
      return names(text).includes(name);
    } catch {
      // an expression that is not valid: its whole names
      return rename(text, name, "") !== text;
    }
  });
}

/** A command whose expressions use a renamed parameter. */
export function renameParameter<T extends Command>(
  command: T,
  old: string,
  name: string,
): T {
  const fields = expressionFields(command);
  if (!fields.length) return command;
  const copy = structuredClone(command) as unknown as Record<string, unknown>;
  for (const { path } of fields) {
    const owner = path
      .slice(0, -1)
      .reduce<Record<string | number, unknown>>(
        (o, key) => o[key] as Record<string | number, unknown>,
        copy,
      );
    const key = path.at(-1)!;
    owner[key] = rename(owner[key] as string, old, name);
  }
  return copy as unknown as T;
}
