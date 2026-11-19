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

/** The values of the parameters, integer parameters as integers, like the script. */
export function parameterValues(
  commands: readonly Command[],
): Record<string, number> {
  const values: Record<string, number> = {};
  for (const c of commands)
    if (c.command === "parameter.add")
      values[c.name] = c.integer ? Math.trunc(c.value) : c.value;
  return values;
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
  const values = parameterValues(commands);
  const problems: ExpressionProblem[] = [];
  const resolved: ResolvedCommand[] = [];
  commands.forEach((command, index) => {
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
