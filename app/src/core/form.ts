// Forms of the commands, derived from the command schema (ADR 0003): which fields a
// command has, their types, ranges and variants. Labels, hints and defaults come
// from the registry, or from the schema (`x-label`, `description`, `default`) like
// the models of the material registry: a new material model needs a schema
// definition only.
import type { Command } from "./commands";
import { KIND_LABELS, REGISTRY } from "./registry";
import { schema } from "./schema";
import {
  type CommandType,
  type Kind,
  KINDS,
  nameProblem,
  REFERENCES,
} from "./validate";

/** A command that is being edited; it may be incomplete or hold invalid values. */
export type Draft = Record<string, unknown>;

export interface Option {
  value: string;
  label: string;
}

export type Input =
  | { type: "name" }
  | { type: "text" }
  | {
      type: "number";
      integer: boolean;
      min?: number;
      max?: number;
      exclusiveMin?: number;
      exclusiveMax?: number;
    }
  | { type: "choice"; options: Option[] }
  /** Switches the fields below it; `seeds` holds the value to set per option. */
  | { type: "variant"; options: Option[]; seeds: Record<string, unknown> }
  | { type: "multichoice"; options: Option[]; minItems: number }
  | { type: "integers"; minItems: number; min?: number }
  | { type: "reference"; kind: Kind; multiple: boolean; minItems: number }
  /** Switches an optional group of fields on or off. */
  | { type: "toggle" };

export interface FieldSpec {
  /** Path of the value in the command, e.g. ["parameters", "mu"]. */
  path: string[];
  /** The path joined by dots; key of the field in the registry. */
  key: string;
  label: string;
  hint?: string;
  /** Description of the schema, for a tooltip. */
  description?: string;
  placeholder?: string;
  required: boolean;
  input: Input;
}

export interface Context {
  /** Commands of the model. */
  commands: readonly Command[];
  /** Name of the edited command; undefined for a new command. */
  editing?: string;
}

interface Node {
  $ref?: string;
  type?: string;
  const?: unknown;
  enum?: string[];
  oneOf?: Node[];
  properties?: Record<string, Node>;
  required?: string[];
  items?: Node;
  minimum?: number;
  maximum?: number;
  exclusiveMinimum?: number;
  exclusiveMaximum?: number;
  minItems?: number;
  description?: string;
  default?: unknown;
  /** Short label of a definition or a property, e.g. `Mooney-Rivlin` or `μ`. */
  "x-label"?: string;
  if?: Node;
  then?: Node;
  else?: { not?: Node };
}

const defs = (schema as unknown as { $defs: Record<string, Node> }).$defs;

const refName = (node: Node) => node.$ref?.split("/").pop();

function resolve(node: Node): Node {
  while (node.$ref) node = defs[refName(node)!];
  return node;
}

const isObject = (value: unknown): value is Draft =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const info = (type: CommandType, key: string) => REGISTRY[type].fields[key];

const option = (type: CommandType, key: string, value: string): Option => ({
  value,
  label: REGISTRY[type].options?.[key]?.[value] ?? value,
});

/** Definitions of a command in the schema: one, or one per variant (materials). */
function definitions(type: CommandType): Node[] {
  const result: Node[] = [];
  const visit = (node: Node) => {
    node = resolve(node);
    if (node.oneOf) node.oneOf.forEach(visit);
    else if (node.properties?.command?.const === type) result.push(node);
  };
  visit(defs.Command);
  return result;
}

/** Definition of the command for a draft, and the property that selects it. */
function definition(type: CommandType, draft: Draft) {
  const nodes = definitions(type);
  const discriminator =
    nodes.length > 1
      ? Object.keys(nodes[0].properties ?? {}).find(
          (key) =>
            key !== "command" &&
            nodes.every((n) => n.properties?.[key]?.const !== undefined),
        )
      : undefined;
  const node =
    (discriminator &&
      nodes.find(
        (n) => n.properties![discriminator].const === draft[discriminator],
      )) ||
    nodes[0];
  return { node, nodes, discriminator };
}

/** Required and hidden properties of an object for a value (if / then / else). */
function conditions(node: Node, value: Draft) {
  const required = new Set(node.required ?? []);
  const hidden = new Set<string>();
  if (node.if) {
    const matches = Object.entries(node.if.properties ?? {}).every(
      ([key, property]) => value[key] === property.const,
    );
    if (matches) for (const key of node.then?.required ?? []) required.add(key);
    else for (const key of node.else?.not?.required ?? []) hidden.add(key);
  }
  return { required, hidden };
}

/** Id of a variant of a oneOf of objects: its first required property. */
const variantId = (node: Node) => node.required?.[0] ?? "";

/** Variant of a oneOf of objects for a value: all its required properties exist. */
function variantOf(node: Node, value: Draft): Node {
  const options = node.oneOf!.map(resolve);
  return (
    options.find((o) => (o.required ?? []).every((key) => key in value)) ??
    options[0]
  );
}

/** Kind of object a reference field points to. */
function referenceKind(type: CommandType, key: string): Kind {
  if (type === "step.add" && key === "ramp.boundary") return "boundary";
  const reference = REFERENCES[type]?.[key];
  if (!reference) throw new Error(`No reference kind for ${type} ${key}.`);
  return reference[0];
}

/** Names of the objects of a kind that the edited command may reference. */
export function available(context: Context, kind: Kind): string[] {
  const { commands, editing } = context;
  const index =
    editing === undefined ? -1 : commands.findIndex((c) => c.name === editing);
  return commands
    .slice(0, index < 0 ? commands.length : index)
    .filter((c) => KINDS[c.command] === kind)
    .map((c) => c.name);
}

/** Fields of the form of a command, for the current state of the draft. */
export function fieldSpecs(type: CommandType, draft: Draft): FieldSpec[] {
  const { node, nodes, discriminator } = definition(type, draft);
  const specs: FieldSpec[] = [];

  const push = (
    path: string[],
    required: boolean,
    input: Input,
    description?: string,
    raw?: Node,
  ) => {
    const key = path.join(".");
    const field = key === "name" ? { label: "Name" } : info(type, key);
    // a property with a label in the schema (e.g. a material parameter `μ`) takes
    // its description and its key as hint, and "none" as placeholder if optional
    const labelled = raw?.["x-label"] !== undefined;
    const schemaHint = labelled
      ? `${path.at(-1)}: ${raw!.description}`
      : undefined;
    specs.push({
      path,
      key,
      label: field?.label ?? raw?.["x-label"] ?? key,
      hint: field?.hint ?? schemaHint,
      description,
      placeholder:
        field?.placeholder ?? (labelled && !required ? "none" : undefined),
      required,
      input,
    });
  };

  const walk = (object: Node, value: Draft, prefix: string[]) => {
    const { required, hidden } = conditions(object, value);
    for (const [name, raw] of Object.entries(object.properties ?? {})) {
      if (hidden.has(name)) continue;
      const path = [...prefix, name];
      const key = path.join(".");
      const property = resolve(raw);
      const isRequired = required.has(name);
      const child = isObject(value[name]) ? value[name] : {};

      if (raw.const !== undefined) {
        // constants are not edited, except the one that selects the definition
        if (prefix.length === 0 && name === discriminator) {
          const ids = nodes.map((n) => String(n.properties![name].const));
          push(path, true, {
            type: "variant",
            options: nodes.map((n, i) => ({
              ...option(type, key, ids[i]),
              ...(n["x-label"] && !REGISTRY[type].options?.[key]?.[ids[i]]
                ? { label: n["x-label"] }
                : {}),
            })),
            seeds: Object.fromEntries(ids.map((id) => [id, id])),
          });
        }
      } else if (refName(raw) === "Name") {
        if (key === "name") push(path, true, { type: "name" });
        else {
          const kind = referenceKind(type, key);
          push(path, isRequired, {
            type: "reference",
            kind,
            multiple: false,
            minItems: 0,
          });
        }
      } else if (property.enum) {
        const options = property.enum.map((v) => option(type, key, v));
        push(path, isRequired, { type: "choice", options }, raw.description);
      } else if (property.type === "string") {
        push(path, isRequired, { type: "text" }, raw.description);
      } else if (property.type === "number" || property.type === "integer") {
        push(
          path,
          isRequired,
          {
            type: "number",
            integer: property.type === "integer",
            min: property.minimum,
            max: property.maximum,
            exclusiveMin: property.exclusiveMinimum,
            exclusiveMax: property.exclusiveMaximum,
          },
          raw.description,
          raw,
        );
      } else if (property.type === "array") {
        const items = property.items!;
        const minItems = property.minItems ?? 0;
        if (refName(items) === "Name") {
          const kind = referenceKind(type, key);
          push(path, isRequired, {
            type: "reference",
            kind,
            multiple: true,
            minItems,
          });
        } else if (resolve(items).enum) {
          const options = resolve(items).enum!.map((v) => option(type, key, v));
          push(
            path,
            isRequired,
            { type: "multichoice", options, minItems },
            raw.description,
          );
        } else {
          const min = resolve(items).minimum;
          push(
            path,
            isRequired,
            { type: "integers", minItems, min },
            raw.description,
          );
        }
      } else if (property.oneOf) {
        // variants of an object: the first required property marks the variant
        const variants = property.oneOf.map(resolve);
        const seeds = Object.fromEntries(
          variants.map((v) => {
            const id = variantId(v);
            const first = resolve(v.properties![id]);
            const seed =
              info(type, `${key}.${id}`)?.default ??
              (first.type === "array" ? [] : "");
            return [id, { [id]: seed }];
          }),
        );
        const options = variants.map((v) => option(type, key, variantId(v)));
        push(path, true, { type: "variant", options, seeds }, raw.description);
        walk(variantOf(property, child), child, path);
      } else if (property.type === "object") {
        if (!isRequired) {
          push(path, false, { type: "toggle" }, raw.description);
          if (!isObject(value[name])) continue;
        }
        walk(property, child, path);
      }
    }
  };

  walk(node, draft, []);
  return specs;
}

/**
 * Bring a draft in line with the schema: keep only the properties of its
 * definition, remove hidden ones, and fill required ones that have a default (from
 * the registry, or the latest object for a reference). Fields in `known` are left
 * as they are: a field that the user emptied does not get its default back.
 */
export function normalize(
  type: CommandType,
  draft: Draft,
  context: Context,
  known: ReadonlySet<string> = new Set(),
): Draft {
  let source = draft;
  const { nodes, discriminator } = definition(type, draft);
  if (
    discriminator &&
    !nodes.some(
      (n) => n.properties![discriminator].const === draft[discriminator],
    )
  ) {
    source = { ...draft, [discriminator]: info(type, discriminator)?.default };
  }

  const fill = (object: Node, value: Draft, prefix: string[]): Draft => {
    const result: Draft = {};
    for (const name of Object.keys(object.properties ?? {})) {
      if (value[name] !== undefined) result[name] = value[name];
    }
    for (const [name, raw] of Object.entries(object.properties ?? {})) {
      const { required, hidden } = conditions(object, result);
      const path = [...prefix, name];
      const key = path.join(".");
      const property = resolve(raw);
      if (hidden.has(name)) {
        delete result[name];
        continue;
      }
      if (raw.const !== undefined) {
        result[name] = raw.const;
        continue;
      }
      if (result[name] === undefined && required.has(name) && !known.has(key)) {
        const fallback = info(type, key)?.default ?? raw.default;
        if (fallback !== undefined) {
          result[name] = structuredClone(fallback);
        } else if (refName(raw) === "Name" && key !== "name") {
          result[name] = available(context, referenceKind(type, key)).at(-1);
        } else if (
          property.type === "array" &&
          refName(property.items!) === "Name"
        ) {
          const all = available(context, referenceKind(type, key));
          if (all.length) result[name] = all;
        } else if (property.oneOf || property.type === "object") {
          result[name] = {};
        }
      }
      const child = result[name];
      if (isObject(child)) {
        if (property.oneOf)
          result[name] = fill(variantOf(property, child), child, path);
        else if (property.type === "object")
          result[name] = fill(property, child, path);
      }
      if (result[name] === undefined) delete result[name];
    }
    return result;
  };

  return fill(definition(type, source).node, source, []);
}

/** A name for a new object that is not used yet, e.g. `material_1`. */
export function suggestName(
  type: CommandType,
  commands: readonly Command[],
): string {
  const names = new Set(commands.map((c) => c.name));
  for (let n = 1; ; n++) {
    const name = `${REGISTRY[type].prefix}_${n}`;
    if (!names.has(name)) return name;
  }
}

/**
 * Draft of a new command with a suggested name and the defaults. A preset sets
 * values first, e.g. the model of a material.
 */
export function initialDraft(
  type: CommandType,
  context: Context,
  preset: Draft = {},
): Draft {
  const name = suggestName(type, context.commands);
  return normalize(type, { name, ...preset, command: type }, context);
}

/** Value of a draft at a path. */
export function getValue(draft: Draft, path: string[]): unknown {
  let value: unknown = draft;
  for (const key of path) {
    if (!isObject(value)) return undefined;
    value = value[key];
  }
  return value;
}

const keysOf = (type: CommandType, draft: Draft) =>
  new Set(fieldSpecs(type, draft).map((spec) => spec.key));

/**
 * Set (or with undefined: remove) the value at a path. Fields that appear by the
 * change, e.g. the parameters of another material model, get their defaults.
 */
export function setValue(
  type: CommandType,
  draft: Draft,
  path: string[],
  value: unknown,
  context: Context,
): Draft {
  const next = structuredClone(draft);
  let target = next;
  for (const key of path.slice(0, -1)) {
    if (!isObject(target[key])) target[key] = {};
    target = target[key] as Draft;
  }
  const last = path[path.length - 1];
  if (value === undefined) delete target[last];
  else target[last] = value;
  return normalize(type, next, context, keysOf(type, draft));
}

const article = (word: string) => (/^[aeiou]/i.test(word) ? "an" : "a");

function numberError(input: Extract<Input, { type: "number" }>, value: number) {
  if (!Number.isFinite(value))
    return "Enter a number, with a point as decimal separator.";
  if (input.integer && !Number.isInteger(value)) return "Enter a whole number.";
  if (input.exclusiveMin !== undefined && value <= input.exclusiveMin) {
    return `Must be greater than ${input.exclusiveMin}.`;
  }
  if (input.min !== undefined && value < input.min)
    return `Must be at least ${input.min}.`;
  if (input.exclusiveMax !== undefined && value >= input.exclusiveMax) {
    return `Must be less than ${input.exclusiveMax}.`;
  }
  if (input.max !== undefined && value > input.max)
    return `Must be at most ${input.max}.`;
  return undefined;
}

function fieldError(
  spec: FieldSpec,
  value: unknown,
  context: Context,
): string | undefined {
  const { input, required } = spec;
  const missing = value === undefined || value === "";
  switch (input.type) {
    case "name": {
      if (typeof value !== "string" || value === "") return "Required.";
      const problem = nameProblem(value);
      if (problem)
        return problem.startsWith("name '") ? `The ${problem}` : problem;
      const taken = context.commands.some(
        (c) => c.name === value && c.name !== context.editing,
      );
      return taken ? `The name '${value}' is already used.` : undefined;
    }
    case "text":
      return missing && required ? "Required." : undefined;
    case "number":
      if (missing) return required ? "Required." : undefined;
      return numberError(input, value as number);
    case "choice":
      if (missing) return required ? "Required." : undefined;
      return input.options.some((o) => o.value === value)
        ? undefined
        : "Choose an option.";
    case "multichoice": {
      const items = Array.isArray(value) ? value : [];
      const unknown = items.find(
        (item) => !input.options.some((o) => o.value === item),
      );
      if (unknown !== undefined) {
        return `Unknown value '${String(unknown)}'; choose from ${input.options.map((o) => o.value).join(", ")}.`;
      }
      if (new Set(items).size < items.length)
        return "Each value may appear only once.";
      return items.length < Math.max(input.minItems, required ? 1 : 0)
        ? "Select at least one."
        : undefined;
    }
    case "integers": {
      const ids = Array.isArray(value) ? (value as number[]) : [];
      if (ids.length < input.minItems) return "Enter at least one id.";
      if (
        ids.some(
          (id) =>
            !Number.isInteger(id) ||
            (input.min !== undefined && id < input.min),
        )
      ) {
        return `Enter whole numbers from ${input.min ?? 0}, separated by commas.`;
      }
      return new Set(ids).size < ids.length
        ? "Each id may appear only once."
        : undefined;
    }
    case "reference": {
      const names = available(context, input.kind);
      const kind = KIND_LABELS[input.kind].toLowerCase();
      if (input.multiple) {
        if (value === undefined && !required) return undefined;
        const items = Array.isArray(value) ? (value as string[]) : [];
        if (items.length < Math.max(input.minItems, 1)) {
          return names.length
            ? "Select at least one."
            : `Create ${article(kind)} ${kind} first.`;
        }
        const unknown = items.find((item) => !names.includes(item));
        if (unknown)
          return `There is no ${kind} '${unknown}' before this object.`;
        return new Set(items).size < items.length
          ? "Each object may appear only once."
          : undefined;
      }
      if (missing) {
        if (!required) return undefined;
        return names.length
          ? "Required."
          : `Create ${article(kind)} ${kind} first.`;
      }
      return names.includes(value as string)
        ? undefined
        : `There is no ${kind} '${String(value)}' before this object.`;
    }
    default:
      return undefined;
  }
}

/** Error messages of a draft by field key; empty if the draft is a valid command. */
export function draftErrors(
  type: CommandType,
  draft: Draft,
  context: Context,
): Record<string, string> {
  const errors: Record<string, string> = {};
  for (const spec of fieldSpecs(type, draft)) {
    const error = fieldError(spec, getValue(draft, spec.path), context);
    if (error) errors[spec.key] = error;
  }
  return errors;
}

/** The command of a draft without errors. */
export function toCommand(
  type: CommandType,
  draft: Draft,
  context: Context,
): Command {
  const known = keysOf(type, draft);
  return normalize(type, draft, context, known) as unknown as Command;
}

/** Deep equality of drafts, independent of the order of keys. */
export function sameDraft(a: unknown, b: unknown): boolean {
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((item, i) => sameDraft(item, b[i]));
  }
  if (isObject(a) && isObject(b)) {
    const keys = Object.keys(a).filter((k) => a[k] !== undefined);
    const other = Object.keys(b).filter((k) => b[k] !== undefined);
    return (
      keys.length === other.length && keys.every((k) => sameDraft(a[k], b[k]))
    );
  }
  return Object.is(a, b);
}
