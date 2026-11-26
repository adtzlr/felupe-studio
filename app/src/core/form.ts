// Forms of the commands, derived from the command schema (ADR 0003): which fields a
// command has, their types, ranges and variants. Labels, hints and defaults come
// from the registry, or from the schema (`x-label`, `description`, `default`) like
// the models of the material registry: a new material model needs a schema
// definition only.
import type { Quantity } from "./units";
import type { Command } from "./commands";
import { isColor } from "./colormaps";
import { ExpressionError, evaluate } from "./expressions";
import { type Loadcase, loadcaseFieldErrors } from "./loadcases";
import { MATERIAL_MODELS } from "./materials";
import { usersOf } from "./meshtools";
import { KIND_LABELS, REGISTRY } from "./registry";
import { numberText, parameterValues } from "./resolve";
import { schema } from "./schema";
import {
  type CommandType,
  kindsOf,
  nameProblem,
  RAMPED,
  REFERENCES,
  type RefKind,
  references,
  takes,
} from "./validate";

/** A command that is being edited; it may be incomplete or hold invalid values. */
export type Draft = Record<string, unknown>;

export interface Option {
  value: string;
  label: string;
  /** A group of options, e.g. a menu of the ribbon (`x-group`, #136). */
  group?: string;
}

export type Input =
  | { type: "name" }
  | { type: "text" }
  /** A color #rrggbb of an object (#336, #376); without it, automatic. */
  | { type: "color" }
  | {
      type: "number";
      integer: boolean;
      min?: number;
      max?: number;
      exclusiveMin?: number;
      exclusiveMax?: number;
      /** The value may be an expression of the parameters (#242). */
      expressions?: boolean;
    }
  | { type: "choice"; options: Option[] }
  /** Switches the fields below it; `seeds` holds the value to set per option. */
  | { type: "variant"; options: Option[]; seeds: Record<string, unknown> }
  | { type: "multichoice"; options: Option[]; minItems: number }
  | { type: "integers"; minItems: number; min?: number }
  /** Points, one per line: three coordinates each. */
  | { type: "coordinates"; minItems: number; expressions?: boolean }
  /** A list of numbers, e.g. the coordinates x, y, z of a point. */
  | {
      type: "numbers";
      minItems: number;
      maxItems?: number;
      /** No item may be zero, e.g. an exponent of Ogden (#136). */
      nonzero?: boolean;
      /**
       * One number is a number, more are a list, e.g. one value for all components
       * of a boundary or one per component (#225).
       */
      collapse?: boolean;
      /** A value may be an expression of the parameters (#242). */
      expressions?: boolean;
      /** Whole numbers from a minimum, e.g. the points per axis of a mesh tool. */
      integer?: boolean;
      min?: number;
    }
  | {
      type: "reference";
      kind: RefKind;
      multiple: boolean;
      minItems: number;
      /** At most this many, e.g. the one mesh of an operation (ADR 0019). */
      maxItems?: number;
      /**
       * A list in order that may repeat an object, e.g. the steps of a job (#331):
       * of the schema without `uniqueItems` and without a fixed number of items.
       */
      repeats?: boolean;
    }
  /**
   * A list of objects, edited as rows; `columns` are the fields of a row, with
   * paths relative to the row (see `cells`).
   */
  | { type: "rows"; columns: FieldSpec[]; minItems: number }
  /** Switches an optional group of fields on or off. */
  | { type: "toggle" }
  /** A flag; without a value, the default of the schema applies. */
  | { type: "boolean"; default: boolean };

export interface FieldSpec {
  /** Path of the value in the command, e.g. ["parameters", "mu"]. */
  path: string[];
  /** The path joined by dots; key of the field in the registry. */
  key: string;
  label: string;
  hint?: string;
  /** Description of the schema, for a tooltip. */
  description?: string;
  /**
   * The key of a value with a label of its own in the schema, e.g. `C10` of the
   * label `C₁₀`, for the tooltip of the label (#137).
   */
  symbolOf?: string;
  placeholder?: string;
  required: boolean;
  input: Input;
  /** Index of the row of a cell of rows (see `cells`). */
  row?: number;
  /** A column of rows whose objects may appear only once (registry `unique`). */
  unique?: boolean;
  /** The physical quantity of the value, for its unit (`x-quantity`, #132). */
  quantity?: Quantity;
}

/**
 * A field of an object of values whose keys are not in the schema, e.g. an argument
 * of the strain energy function of a file (#424).
 */
export interface KeyField {
  name: string;
  required?: boolean;
  /** E.g. the default value of an optional argument. */
  placeholder?: string;
  hint?: string;
}

export interface Context {
  /** Commands of the model. */
  commands: readonly Command[];
  /** Name of the edited command; undefined for a new command. */
  editing?: string;
  /**
   * The sections without volume that are off in every step (#429), grayed out in
   * the sections of a step.
   */
  withoutVolume?: ReadonlySet<string>;
  /**
   * The fields of an object of values whose keys are not in the schema, by the
   * key of the object, e.g. the arguments of the strain energy function of a file
   * (#424) from its run: undefined if they are not known. The keys of the draft
   * are fields too.
   */
  keys?: (
    type: CommandType,
    key: string,
    draft: Draft,
  ) => readonly KeyField[] | undefined;
}

interface Node {
  $ref?: string;
  /** A list of types, e.g. a number or a list of numbers (#225). */
  type?: string | string[];
  const?: unknown;
  enum?: string[];
  oneOf?: Node[];
  properties?: Record<string, Node>;
  /** The values of the keys that are not properties, e.g. of arguments (#424). */
  additionalProperties?: Node | boolean;
  required?: string[];
  items?: Node;
  minimum?: number;
  maximum?: number;
  exclusiveMinimum?: number;
  exclusiveMaximum?: number;
  minItems?: number;
  maxItems?: number;
  uniqueItems?: boolean;
  description?: string;
  default?: unknown;
  /** Short label of a definition or a property, e.g. `Mooney-Rivlin` or `μ`. */
  "x-label"?: string;
  /** A number of the schema that may be an expression (types with "string"). */
  "x-expressions"?: boolean;
  /** The physical quantity of a value, e.g. `stress` (#132). */
  "x-quantity"?: Quantity;
  /** A group of the definitions of a variant, e.g. `Polynomial` (#136). */
  "x-group"?: string;
  /** When to use a definition, the hint of the field that selects it (#420). */
  "x-hint"?: string;
  /** Lists of values that need the same number of values, e.g. of Ogden. */
  "x-same-length"?: string[];
  /**
   * The coordinate of the axis of its name, shown only if the list of axes of this
   * property has it, e.g. `x` of a symmetry with `x` in `axes` (#186).
   */
  "x-if-axis"?: string;
  not?: Node;
  if?: Node;
  then?: Node;
  else?: { not?: Node };
  anyOf?: Node[];
}

const defs = (schema as unknown as { $defs: Record<string, Node> }).$defs;

const refName = (node: Node) => node.$ref?.split("/").pop();

/** The nodes of number fields without the type of their expressions, by node. */
const numbersOnly = new WeakMap<Node, Node>();

/**
 * A node with its reference resolved. A number field that may hold an expression
 * of the parameters (#242, the types ["number", "string"]) is a number field with
 * `x-expressions`.
 */
function resolve(node: Node): Node {
  while (node.$ref) node = defs[refName(node)!];
  const types = node.type;
  if (
    !Array.isArray(types) ||
    !types.includes("string") ||
    !(types.includes("number") || types.includes("integer"))
  )
    return node;
  let result = numbersOnly.get(node);
  if (!result) {
    const rest = types.filter((t) => t !== "string");
    result = {
      ...node,
      type: rest.length === 1 ? rest[0] : rest,
      "x-expressions": true,
    };
    numbersOnly.set(node, result);
  }
  return result;
}

/** The flag of a number field that may hold an expression (#242). */
const expressions = (node: Node) =>
  node["x-expressions"] ? { expressions: true } : {};

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
    // a constant, or a type, e.g. the expression of a derived parameter (ADR 0021),
    // which has no range
    const matches = Object.entries(node.if.properties ?? {}).every(
      ([key, property]) =>
        typeof property.type === "string"
          ? typeof value[key] === property.type
          : value[key] === property.const,
    );
    // properties that must not exist: not required, or not any of them, e.g. the
    // options of an iterative solver otherwise and its precision with it (#152)
    const forbid = (not?: Node) => {
      for (const n of [not, ...(not?.anyOf ?? [])])
        for (const key of n?.required ?? []) hidden.add(key);
    };
    if (matches) {
      for (const key of node.then?.required ?? []) required.add(key);
      forbid(node.then?.not);
    } else forbid(node.else?.not);
  }
  // coordinates of axes that are not chosen (#186)
  for (const [name, property] of Object.entries(node.properties ?? {})) {
    const list = property["x-if-axis"];
    if (list === undefined) continue;
    const axes = value[list];
    if (!Array.isArray(axes) || !axes.includes(name)) hidden.add(name);
  }
  return { required, hidden };
}

/** Id of a variant of a oneOf of objects: its first required property. */
const variantId = (node: Node) => node.required?.[0] ?? "";

/**
 * Variant of a oneOf of objects for a value: all its required properties exist, or
 * else the one whose id is set (a variant just chosen, e.g. `{ bound: "max" }` of a
 * point set at a bound, whose other properties are not filled yet).
 */
function variantOf(node: Node, value: Draft): Node {
  const options = node.oneOf!.map(resolve);
  return (
    options.find((o) => (o.required ?? []).every((key) => key in value)) ??
    options.find((o) => variantId(o) in value) ??
    options[0]
  );
}

/** Key of a field in the registry: without the indices of rows. */
const columnKey = (key: string) =>
  key
    .split(".")
    .filter((part) => !/^\d+$/.test(part))
    .join(".");

/** Kind (or kinds) of objects a reference field points to. */
function referenceKind(type: CommandType, key: string): RefKind {
  // the ramped boundaries, loads and pressures, and the constraints in local
  // coordinates (#421, #422)
  if (type === "step.add" && columnKey(key) === "ramp.items.target")
    return [...RAMPED, "constraint"];
  const reference = REFERENCES[type]?.[key];
  if (!reference) throw new Error(`No reference kind for ${type} ${key}.`);
  return reference[0];
}

/**
 * Names of the objects of a kind that the edited command may reference: all of
 * them, also the ones created later (the store keeps the command list ordered, #80).
 */
export function available(context: Context, kind: RefKind): string[] {
  const { commands, editing } = context;
  const kinds = kindsOf(kind);
  return commands
    .filter((c) => takes(kinds, c.command) && c.name !== editing)
    .map((c) => c.name);
}

/**
 * The object that a new item of a list in order takes (#331): the one after the
 * last item in the order of the objects, after the last object the first one
 * again, so the steps load and unload give load, unload, load; the first object
 * in an empty list.
 */
export function nextReference(
  names: readonly string[],
  items: readonly string[],
): string | undefined {
  const last = names.indexOf(items.at(-1) ?? "");
  return names[(last + 1) % names.length];
}

/** The label of the kind of a reference, e.g. "boundary or load". */
export const kindLabel = (kind: RefKind): string =>
  kindsOf(kind)
    .map((k) => KIND_LABELS[k].toLowerCase())
    .join(" or ");

/**
 * The input of a property of a command (#312): its kind and constraints, whether
 * the field is required (if not as in the schema), and whether the field takes the
 * description of the property and its labels of the schema (`raw`).
 */
interface Leaf {
  input: Input;
  required?: boolean;
  described?: boolean;
  labelled?: boolean;
}

/** The input of a property that is not an array, an object or variants. */
function scalarLeaf(
  type: CommandType,
  key: string,
  raw: Node,
  property: Node,
): Leaf | undefined {
  if (refName(raw) === "Color")
    return { input: { type: "color" }, described: true };
  if (refName(raw) === "Name") {
    if (key === "name") return { input: { type: "name" }, required: true };
    const kind = referenceKind(type, key);
    return {
      input: { type: "reference", kind, multiple: false, minItems: 0 },
    };
  }
  if (property.enum) {
    const options = property.enum.map((v) => option(type, key, v));
    return { input: { type: "choice", options }, described: true };
  }
  if (Array.isArray(property.type)) {
    // a number or a list of numbers, e.g. one value per component of a boundary
    // (#225): numbers separated by commas, one number is a number
    const input: Input = {
      type: "numbers",
      minItems: property.minItems ?? 1,
      maxItems: property.maxItems,
      collapse: true,
      ...expressions(property),
    };
    return { input, described: true, labelled: true };
  }
  if (property.type === "string")
    return { input: { type: "text" }, described: true };
  if (property.type === "boolean")
    return {
      input: { type: "boolean", default: raw.default === true },
      described: true,
    };
  if (property.type === "number" || property.type === "integer") {
    const input: Input = {
      type: "number",
      integer: property.type === "integer",
      min: property.minimum,
      max: property.maximum,
      exclusiveMin: property.exclusiveMinimum,
      exclusiveMax: property.exclusiveMaximum,
      ...expressions(property),
    };
    return { input, described: true, labelled: true };
  }
  return undefined;
}

/** The input of an array of values (not of objects, which are rows). */
function arrayLeaf(type: CommandType, key: string, property: Node): Leaf {
  const items = resolve(property.items!);
  const minItems = property.minItems ?? 0;
  // whole numbers that may be expressions, e.g. the points per axis of a mesh tool
  // (ADR 0019); ids without expressions are integers below
  const integer = items.type === "integer" && !!items["x-expressions"];
  if (items.type === "number" || integer) {
    const input: Input = {
      type: "numbers",
      minItems,
      maxItems: property.maxItems,
      ...(items.not?.const === 0 ? { nonzero: true } : {}),
      ...(integer ? { integer: true, min: items.minimum } : {}),
      ...expressions(items),
    };
    return { input, described: true, labelled: true };
  }
  if (items.type === "array") {
    const input: Input = {
      type: "coordinates",
      minItems,
      ...expressions(resolve(items.items!)),
    };
    return { input, described: true, labelled: true };
  }
  if (refName(property.items!) === "Name") {
    const kind = referenceKind(type, key);
    const { maxItems } = property;
    const repeats = !property.uniqueItems && maxItems === undefined;
    return {
      input: {
        type: "reference",
        kind,
        multiple: true,
        minItems,
        ...(maxItems !== undefined ? { maxItems } : {}),
        ...(repeats ? { repeats } : {}),
      },
    };
  }
  if (items.enum) {
    const options = items.enum.map((v) => option(type, key, v));
    return {
      input: { type: "multichoice", options, minItems },
      described: true,
    };
  }
  return {
    input: { type: "integers", minItems, min: items.minimum },
    described: true,
  };
}

/** The variant field of the constant that selects the definition of a command. */
function definitionInput(
  type: CommandType,
  key: string,
  name: string,
  nodes: readonly Node[],
): Input {
  const ids = nodes.map((n) => String(n.properties![name].const));
  return {
    type: "variant",
    options: nodes.map((n, i) => ({
      ...option(type, key, ids[i]),
      ...(n["x-label"] && !REGISTRY[type].options?.[key]?.[ids[i]]
        ? { label: n["x-label"] }
        : {}),
      ...(n["x-group"] ? { group: n["x-group"] } : {}),
    })),
    seeds: Object.fromEntries(ids.map((id) => [id, id])),
  };
}

/**
 * The variant field of a oneOf of objects: the first required property marks the
 * variant, with the defaults of its other required properties, which a draft that
 * had them in another variant would not fill again (e.g. the axis of a point set
 * at a bound after one by a plane, #181).
 */
function variantInput(type: CommandType, key: string, property: Node): Input {
  const variants = property.oneOf!.map(resolve);
  const seeds = Object.fromEntries(
    variants.map((v) => {
      const id = variantId(v);
      const first = resolve(v.properties![id]);
      const seed =
        info(type, `${key}.${id}`)?.default ??
        (first.type === "array" ? [] : "");
      const others = (v.required ?? []).slice(1).flatMap((name) => {
        const fallback = info(type, `${key}.${name}`)?.default;
        return fallback === undefined
          ? []
          : [[name, structuredClone(fallback)]];
      });
      return [id, { [id]: seed, ...Object.fromEntries(others) }];
    }),
  );
  const options = variants.map((v) => option(type, key, variantId(v)));
  return { type: "variant", options, seeds };
}

/**
 * The texts of a property with a label in the schema (e.g. a material parameter
 * `μ`): its label, its description as hint, and "none" as placeholder if optional.
 */
function schemaTexts(raw: Node | undefined, required: boolean) {
  const labelled = raw?.["x-label"] !== undefined;
  return {
    labelled,
    label: raw?.["x-label"],
    hint: labelled ? raw!.description : undefined,
    placeholder: labelled && !required ? "none" : undefined,
  };
}

/** The spec of a field of a command at a path. */
function specOf(
  type: CommandType,
  path: string[],
  required: boolean,
  input: Input,
  description?: string,
  raw?: Node,
): FieldSpec {
  const key = path.join(".");
  const field = key === "name" ? { label: "Name" } : info(type, key);
  const schema = schemaTexts(raw, required);
  const unique = !!field && "unique" in field && !!field.unique;
  return {
    path,
    key,
    label: field?.label ?? schema.label ?? key,
    hint: field?.hint ?? schema.hint,
    description,
    // the key of a labelled property as the tooltip of its label (#137)
    ...(schema.labelled && !field?.label ? { symbolOf: path.at(-1) } : {}),
    placeholder: field?.placeholder ?? schema.placeholder,
    required,
    input,
    ...(unique ? { unique: true } : {}),
    ...(raw?.["x-quantity"] ? { quantity: raw["x-quantity"] } : {}),
  };
}

/** The node of the values of an object whose keys are not in the schema (#424). */
const valuesOf = (property: Node): Node | undefined =>
  property.type === "object" &&
  typeof property.additionalProperties === "object"
    ? property.additionalProperties
    : undefined;

/**
 * The fields of an object of values whose keys are not in the schema (#424): those
 * of the context, then the other keys of the draft.
 */
function keyFields(
  type: CommandType,
  key: string,
  draft: Draft,
  value: Draft,
  context?: Context,
): KeyField[] {
  const known = context?.keys?.(type, key, draft) ?? [];
  const names = new Set(known.map((k) => k.name));
  return [
    ...known,
    ...Object.keys(value)
      .filter((name) => !names.has(name))
      .map((name) => ({ name })),
  ];
}

/** Fields of the form of a command, for the current state of the draft. */
export function fieldSpecs(
  type: CommandType,
  draft: Draft,
  context?: Context,
): FieldSpec[] {
  const { node, nodes, discriminator } = definition(type, draft);
  const specs: FieldSpec[] = [];
  const push = (
    ...args: Parameters<typeof specOf> extends [unknown, ...infer R] ? R : never
  ) => specs.push(specOf(type, ...args));

  /** The fields of the items of an array of objects, as the columns of rows. */
  const rowsOf = (
    path: string[],
    property: Node,
    required: boolean,
    raw: Node,
  ) => {
    const before = specs.length;
    walk(resolve(property.items!), {}, path);
    const columns = specs
      .splice(before)
      .map((c) => ({ ...c, path: c.path.slice(path.length) }));
    const minItems = property.minItems ?? 0;
    push(path, required, { type: "rows", columns, minItems }, raw.description);
  };

  /** The fields of a property that has fields of its own, or is an array. */
  const nested = (
    path: string[],
    raw: Node,
    property: Node,
    { required, value }: { required: boolean; value: unknown },
  ) => {
    const key = path.join(".");
    const child = isObject(value) ? value : {};
    if (property.type === "array") {
      if (resolve(property.items!).type === "object")
        return rowsOf(path, property, required, raw);
      const leaf = arrayLeaf(type, key, property);
      return push(
        path,
        required,
        leaf.input,
        leaf.described ? raw.description : undefined,
        leaf.labelled ? raw : undefined,
      );
    }
    if (property.oneOf) {
      push(path, true, variantInput(type, key, property), raw.description);
      return walk(variantOf(property, child), child, path);
    }
    const values = valuesOf(property);
    if (values) {
      // a field per key, e.g. per argument of a function (#424)
      const node = resolve(values);
      for (const field of keyFields(type, key, draft, child, context)) {
        const leaf = scalarLeaf(type, `${key}.${field.name}`, values, node);
        if (!leaf) continue;
        specs.push({
          path: [...path, field.name],
          key: `${key}.${field.name}`,
          label: field.name,
          hint: field.hint,
          placeholder: field.placeholder,
          required: !!field.required,
          input: leaf.input,
        });
      }
      return;
    }
    if (property.type !== "object") return;
    if (!required) {
      push(path, false, { type: "toggle" }, raw.description);
      if (!isObject(value)) return;
    }
    walk(property, child, path);
  };

  const walk = (object: Node, value: Draft, prefix: string[]) => {
    const { required, hidden } = conditions(object, value);
    for (const [name, raw] of Object.entries(object.properties ?? {})) {
      if (hidden.has(name)) continue;
      const path = [...prefix, name];
      const key = path.join(".");
      if (raw.const !== undefined) {
        // constants are not edited, except the one that selects the definition,
        // with the hint of the selected one, e.g. of a formulation (#420)
        if (prefix.length === 0 && name === discriminator) {
          push(path, true, definitionInput(type, key, name, nodes));
          if (node["x-hint"]) specs.at(-1)!.hint ??= node["x-hint"];
        }
        continue;
      }
      const property = resolve(raw);
      const isRequired = required.has(name);
      const leaf = scalarLeaf(type, key, raw, property);
      if (!leaf) {
        nested(path, raw, property, {
          required: isRequired,
          value: value[name],
        });
        continue;
      }
      push(
        path,
        leaf.required ?? isRequired,
        leaf.input,
        leaf.described ? raw.description : undefined,
        leaf.labelled ? raw : undefined,
      );
    }
  };

  walk(node, draft, []);
  return specs;
}

/**
 * The default of a required property without a value: of the registry or the
 * schema, the latest object of a reference, a row, all objects of a list of
 * references, or an empty object; else none.
 */
function defaultOf(
  type: CommandType,
  key: string,
  raw: Node,
  context: Context,
): unknown {
  const property = resolve(raw);
  const fallback = info(type, key)?.default ?? raw.default;
  if (fallback !== undefined) return structuredClone(fallback);
  if (refName(raw) === "Name" && key !== "name")
    return available(context, referenceKind(type, key)).at(-1);
  if (property.type === "array" && resolve(property.items!).type === "object")
    return [seedRow(type, key, resolve(property.items!), [], context)];
  if (property.type === "array" && refName(property.items!) === "Name") {
    const all = available(context, referenceKind(type, key));
    // the inputs of a mesh tool: the meshes that no other tool takes yet, those at
    // the top of the browser (ADR 0019), the latest as many as the tool takes
    const names =
      type === "mesh.generate" && key === "inputs" ? unused(all, context) : all;
    const latest = names.slice(-(property.maxItems ?? names.length));
    return latest.length ? latest : undefined;
  }
  if (property.oneOf || property.type === "object") return {};
  return undefined;
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
    // the values of keys that are not in the schema, e.g. of arguments (#424)
    if (valuesOf(object))
      for (const [name, item] of Object.entries(value))
        if (item !== undefined && item !== "") result[name] ??= item;
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
      if (result[name] === undefined && required.has(name) && !known.has(key))
        result[name] = defaultOf(type, key, raw, context);
      result[name] = nested(result[name], property, path);
      if (result[name] === undefined) delete result[name];
    }
    return result;
  };
  /** An object of a variant or with properties, filled in turn. */
  const nested = (child: unknown, property: Node, path: string[]) => {
    if (!isObject(child)) return child;
    if (property.oneOf) return fill(variantOf(property, child), child, path);
    if (property.type !== "object") return child;
    const filled = fill(property, child, path);
    // no values of keys that are not in the schema: none (#424)
    return valuesOf(property) && Object.keys(filled).length === 0
      ? undefined
      : filled;
  };

  return fill(definition(type, source).node, source, []);
}

/** The meshes that no other tool takes than the edited one (ADR 0019). */
function unused(names: readonly string[], context: Context): string[] {
  const others = context.commands.filter((c) => c.name !== context.editing);
  const used = usersOf(others);
  return names.filter((name) => !used.has(name));
}

/** A new row of rows: the defaults, and the latest object that is not used yet. */
function seedRow(
  type: CommandType,
  key: string,
  item: Node,
  rows: readonly Draft[],
  context: Context,
): Draft {
  const row: Draft = {};
  for (const [name, raw] of Object.entries(item.properties ?? {})) {
    if (!(item.required ?? []).includes(name)) continue;
    const column = `${key}.${name}`;
    const fallback = info(type, column)?.default ?? raw.default;
    if (fallback !== undefined) row[name] = structuredClone(fallback);
    else if (refName(raw) === "Name") {
      const used = info(type, column)?.unique ? rows.map((r) => r[name]) : [];
      row[name] = available(context, referenceKind(type, column))
        .filter((n) => !used.includes(n))
        .at(-1);
      if (row[name] === undefined) delete row[name];
    }
  }
  return row;
}

/** The schema of the value at a path of a draft. */
function nodeAt(type: CommandType, draft: Draft, path: string[]): Node {
  let node = resolve(definition(type, draft).node);
  let value: unknown = draft;
  for (const key of path) {
    if (node.type === "array") node = resolve(node.items!);
    else {
      if (node.oneOf) node = variantOf(node, isObject(value) ? value : {});
      node = resolve(node.properties![key]);
    }
    value = getValue(value as Draft, [key]);
  }
  return node;
}

/** The rows of a rows field with a new row at the end (see `seedRow`). */
export function addRow(
  type: CommandType,
  spec: FieldSpec,
  draft: Draft,
  context: Context,
): Draft[] {
  const value = getValue(draft, spec.path);
  const rows = Array.isArray(value) ? (value as Draft[]) : [];
  const item = resolve(nodeAt(type, draft, spec.path).items!);
  return [...rows, seedRow(type, spec.key, item, rows, context)];
}

/** The fields of the rows of a rows field, by row, with their full paths. */
export function cells(spec: FieldSpec, draft: Draft): FieldSpec[][] {
  if (spec.input.type !== "rows") return [];
  const value = getValue(draft, spec.path);
  const rows = Array.isArray(value) ? value : [];
  const { columns } = spec.input;
  return rows.map((_, row) =>
    columns.map((column) => {
      const path = [...spec.path, String(row), ...column.path];
      return { ...column, path, key: path.join("."), row };
    }),
  );
}

/**
 * Names a reference field offers: the objects of its kind, without the edited one
 * and the objects that use it, which would make a cycle (e.g. the mesh revolved
 * from a stack, as an input of the stack); in a column of rows with unique
 * objects, without the ones of the other rows.
 */
export function offered(
  spec: FieldSpec,
  draft: Draft,
  context: Context,
): string[] {
  if (spec.input.type !== "reference") return [];
  const users = usersOfEdited(context);
  const names = available(context, spec.input.kind).filter(
    (name) => !users.has(name),
  );
  if (spec.row === undefined || !spec.unique) return names;
  const rowsPath = spec.path.slice(0, -2);
  const name = spec.path.at(-1)!;
  const rows = getValue(draft, rowsPath);
  const used = (Array.isArray(rows) ? (rows as Draft[]) : [])
    .filter((_, i) => i !== spec.row)
    .map((r) => r[name]);
  return names.filter((n) => !used.includes(n));
}

/** The objects that use the edited one, directly or through others. */
function usersOfEdited({ commands, editing }: Context): Set<string> {
  const users = new Set<string>();
  if (editing === undefined) return users;
  const used = new Set([editing]);
  let grown: boolean;
  do {
    grown = false;
    for (const command of commands) {
      if (used.has(command.name)) continue;
      if (!references(command).some((r) => used.has(r.name))) continue;
      used.add(command.name);
      users.add(command.name);
      grown = true;
    }
  } while (grown);
  return users;
}

/**
 * Options of a choice field. An optional field starts with an empty option for its
 * default. If the placeholder is one of the options (an axis), the empty option is
 * labelled with it, e.g. "x (default)", and the option is not listed twice, unless
 * the value is set to it explicitly.
 */
export function choiceOptions(
  spec: FieldSpec,
  value: unknown,
): { empty?: string; options: Option[] } {
  if (spec.input.type !== "choice") return { options: [] };
  const { options } = spec.input;
  if (spec.required) return { options };
  const fallback = options.find((o) => o.value === spec.placeholder);
  if (!fallback) return { empty: spec.placeholder ?? "none", options };
  return {
    empty: `${fallback.label} (default)`,
    options: options.filter((o) => o !== fallback || value === o.value),
  };
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
  const draft = normalize(type, { name, ...preset, command: type }, context);
  const initial = REGISTRY[type].initial;
  if (!initial) return draft;
  const adjusted = initial(draft, context.commands, preset);
  return normalize(type, { ...adjusted, ...preset, command: type }, context);
}

/** Value of a draft at a path. */
export function getValue(draft: Draft, path: string[]): unknown {
  let value: unknown = draft;
  for (const key of path) {
    if (Array.isArray(value)) value = value[Number(key)];
    else if (isObject(value)) value = value[key];
    else return undefined;
  }
  return value;
}

const keysOf = (type: CommandType, draft: Draft, context: Context) =>
  new Set(fieldSpecs(type, draft, context).map((spec) => spec.key));

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
  assign(next, path, value);
  const known = keysOf(type, draft, context);
  // another definition, e.g. another mesh tool: lists that do not fit it get its
  // defaults, e.g. the corners of a rectangle after those of a cube (ADR 0019)
  const { discriminator } = definition(type, draft);
  if (path.length === 1 && path[0] === discriminator)
    dropMisfits(definition(type, next).node, next, [], known);
  return normalize(type, next, context, known);
}

/**
 * Remove the lists of a draft whose length does not fit their property, in place,
 * and the lists of a property of one value, e.g. the points of a line after those
 * of a cube.
 */
function dropMisfits(
  object: Node,
  value: Draft,
  prefix: string[],
  known: Set<string>,
) {
  for (const [name, raw] of Object.entries(object.properties ?? {})) {
    const property = resolve(raw);
    const child = value[name];
    const path = [...prefix, name];
    const one =
      property.type !== undefined && ![property.type].flat().includes("array");
    if (isObject(child) && property.type === "object") {
      dropMisfits(property, child, path, known);
    } else if (
      Array.isArray(child) &&
      (one ||
        child.length < (property.minItems ?? 0) ||
        child.length > (property.maxItems ?? Infinity))
    ) {
      delete value[name];
      known.delete(path.join("."));
    }
  }
}

/** Set (or with undefined: remove) the value at a path of a draft, in place. */
function assign(draft: Draft, path: string[], value: unknown) {
  let target = draft;
  for (const key of path.slice(0, -1)) {
    const next = target[key];
    if (typeof next !== "object" || next === null) target[key] = {};
    target = target[key] as Draft;
  }
  const last = path[path.length - 1];
  if (value === undefined) delete target[last];
  else target[last] = value;
}

const article = (word: string) => (/^[aeiou]/i.test(word) ? "an" : "a");

/** A small number in words, e.g. "two" of 2. */
const count = (n: number) =>
  ["one", "two", "three", "four"][n - 1] ?? String(n);

/**
 * The value of an expression of the parameters (#242) in a field, with the values
 * of the parameters of the model, or the message of its problem.
 */
export function expressionValue(
  text: string,
  context: Context,
): { value: number } | { error: string } {
  try {
    return { value: evaluate(text, parameterValues(context.commands)) };
  } catch (error) {
    if (error instanceof ExpressionError) return { error: error.message };
    throw error;
  }
}

const NOT_A_NUMBER = "Enter a number, with a point as decimal separator.";

/**
 * The problem of a value of a field that may be an expression: of the expression,
 * or of its value, e.g. `'1 - cells' is -3. Must be at least 1.`
 */
function valueError(
  value: unknown,
  expressions: boolean | undefined,
  context: Context,
  check: (value: number) => string | undefined,
): string | undefined {
  if (typeof value !== "string") return check(value as number);
  if (!expressions) return NOT_A_NUMBER;
  const result = expressionValue(value, context);
  if ("error" in result) return result.error;
  const problem = check(result.value);
  return problem && `'${value}' is ${numberText(result.value)}. ${problem}`;
}

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

/** The error of a field with an input of a type, for its value. */
type FieldError<T extends Input["type"]> = (
  spec: FieldSpec,
  input: Extract<Input, { type: T }>,
  value: unknown,
  context: Context,
) => string | undefined;

const isMissing = (value: unknown) => value === undefined || value === "";

const nameError: FieldError<"name"> = (_, __, value, context) => {
  if (typeof value !== "string" || value === "") return "Required.";
  const problem = nameProblem(value);
  if (problem) return problem.startsWith("name '") ? `The ${problem}` : problem;
  const taken = context.commands.some(
    (c) => c.name === value && c.name !== context.editing,
  );
  return taken ? `The name '${value}' is already used.` : undefined;
};

const textError: FieldError<"text"> = (spec, _, value) =>
  isMissing(value) && spec.required ? "Required." : undefined;

/** A color #rrggbb of an object (#336, #376). */
export { isColor };

const colorError: FieldError<"color"> = (_, __, value) =>
  isMissing(value) || isColor(value)
    ? undefined
    : "A color like #7f8c8d: # and six hexadecimal digits.";

const numberFieldError: FieldError<"number"> = (
  spec,
  input,
  value,
  context,
) => {
  if (isMissing(value)) return spec.required ? "Required." : undefined;
  return valueError(value, input.expressions, context, (v) =>
    numberError(input, v),
  );
};

const choiceError: FieldError<"choice"> = (spec, input, value) => {
  if (isMissing(value)) return spec.required ? "Required." : undefined;
  return input.options.some((o) => o.value === value)
    ? undefined
    : "Choose an option.";
};

const multichoiceError: FieldError<"multichoice"> = (spec, input, value) => {
  const items = Array.isArray(value) ? value : [];
  const unknown = items.find(
    (item) => !input.options.some((o) => o.value === item),
  );
  if (unknown !== undefined) {
    return `Unknown value '${String(unknown)}'; choose from ${input.options.map((o) => o.value).join(", ")}.`;
  }
  if (new Set(items).size < items.length)
    return "Each value may appear only once.";
  return items.length < Math.max(input.minItems, spec.required ? 1 : 0)
    ? "Select at least one."
    : undefined;
};

const integersError: FieldError<"integers"> = (_, input, value) => {
  const ids = Array.isArray(value) ? (value as number[]) : [];
  if (ids.length < input.minItems) return "Enter at least one id.";
  const bad = (id: number) =>
    !Number.isInteger(id) || (input.min !== undefined && id < input.min);
  if (ids.some(bad))
    return `Enter whole numbers from ${input.min ?? 0}, separated by commas.`;
  return new Set(ids).size < ids.length
    ? "Each id may appear only once."
    : undefined;
};

/**
 * A reference to several objects: at least one, existing, and each once, unless the
 * list may repeat one (#331).
 */
const referencesError: FieldError<"reference"> = (
  spec,
  input,
  value,
  context,
) => {
  if (value === undefined && !spec.required) return undefined;
  const names = available(context, input.kind);
  const kind = kindLabel(input.kind);
  const items = Array.isArray(value) ? (value as string[]) : [];
  const least = Math.max(input.minItems, 1);
  if (items.length < least) {
    return names.length
      ? `Select at least ${count(least)}.`
      : `Create ${article(kind)} ${kind} first.`;
  }
  if (items.length > (input.maxItems ?? Infinity))
    return `Select at most ${count(input.maxItems!)}.`;
  const unknown = items.find((item) => !names.includes(item));
  if (unknown) return `There is no ${kind} '${unknown}'.`;
  return !input.repeats && new Set(items).size < items.length
    ? "Each object may appear only once."
    : undefined;
};

const referenceError: FieldError<"reference"> = (
  spec,
  input,
  value,
  context,
) => {
  if (input.multiple) return referencesError(spec, input, value, context);
  const names = available(context, input.kind);
  const kind = kindLabel(input.kind);
  if (isMissing(value)) {
    if (!spec.required) return undefined;
    return names.length
      ? "Required."
      : `Create ${article(kind)} ${kind} first.`;
  }
  return names.includes(value as string)
    ? undefined
    : `There is no ${kind} '${String(value)}'.`;
};

/** Whether a value of a list is a finite number, or an expression where allowed. */
const isNumberOf = (x: unknown, expressions: boolean | undefined) =>
  (typeof x === "number" && Number.isFinite(x)) ||
  (typeof x === "string" && !!expressions);

/** A list of numbers: their count and each a number, an expression or not 0. */
const listError: FieldError<"numbers"> = (spec, input, value, context) => {
  const numbers = Array.isArray(value) ? (value as unknown[]) : [];
  if (!numbers.length && !spec.required) return undefined;
  const ok =
    numbers.length >= input.minItems &&
    numbers.length <= (input.maxItems ?? Infinity) &&
    numbers.every((x) => isNumberOf(x, input.expressions));
  if (!ok) {
    const count =
      input.maxItems === input.minItems
        ? `${input.minItems} numbers`
        : "numbers";
    const range =
      input.maxItems !== undefined && input.maxItems !== input.minItems
        ? ` ${input.minItems} to ${input.maxItems}`
        : "";
    return `Enter${range} ${count}, separated by commas, with a point as decimal separator.`;
  }
  // the expressions, and the values that are zero, not whole or too small
  for (const x of numbers) {
    const problem = valueError(x, input.expressions, context, (v) =>
      itemProblem(input, v),
    );
    if (problem) return problem;
  }
  return undefined;
};

/** What is wrong with an item of a list of numbers, or undefined. */
function itemProblem(
  input: Extract<Input, { type: "numbers" }>,
  value: number,
): string | undefined {
  if (input.nonzero && value === 0) return "Enter numbers other than 0.";
  if (input.integer && !Number.isInteger(value)) return "Enter whole numbers.";
  if (input.min !== undefined && value < input.min)
    return `Enter numbers of at least ${input.min}.`;
  return undefined;
}

/** A list of numbers, or one number of a number or a list of numbers (#225). */
const numbersError: FieldError<"numbers"> = (spec, input, value, context) => {
  if (!input.collapse) return listError(spec, input, value, context);
  if (value === undefined || (Array.isArray(value) && !value.length))
    return spec.required ? "Required." : undefined;
  if (typeof value === "number" || typeof value === "string")
    return valueError(value, input.expressions, context, (v) =>
      Number.isFinite(v) ? undefined : NOT_A_NUMBER,
    );
  return listError(spec, input, value, context);
};

const coordinatesError: FieldError<"coordinates"> = (
  spec,
  input,
  value,
  context,
) => {
  const points = Array.isArray(value) ? (value as unknown[]) : [];
  if (points.length < Math.max(input.minItems, spec.required ? 1 : 0))
    return "Enter at least one point.";
  const bad = points.findIndex(
    (p) =>
      !Array.isArray(p) ||
      p.length !== 3 ||
      !p.every((x) => isNumberOf(x, input.expressions)),
  );
  if (bad >= 0)
    return `Line ${bad + 1}: enter three numbers x, y, z, with a point as decimal separator.`;
  // the expressions of the coordinates (#242)
  for (const [line, point] of (points as unknown[][]).entries()) {
    for (const x of point) {
      const problem = valueError(x, true, context, () => undefined);
      if (problem) return `Line ${line + 1}: ${problem}`;
    }
  }
  return undefined;
};

const rowsError: FieldError<"rows"> = (spec, input, value) => {
  const rows = Array.isArray(value) ? (value as Draft[]) : [];
  if (rows.length < Math.max(input.minItems, spec.required ? 1 : 0))
    return "Add at least one row.";
  for (const column of input.columns) {
    const name = column.path.at(-1)!;
    const values = rows.map((r) => r[name]).filter((v) => v !== undefined);
    if (column.unique && new Set(values).size < values.length)
      return `Each ${column.label.toLowerCase()} may appear only once.`;
  }
  return undefined;
};

/** The errors of the fields by the type of their input. */
const FIELD_ERRORS: { [T in Input["type"]]?: FieldError<T> } = {
  name: nameError,
  text: textError,
  color: colorError,
  number: numberFieldError,
  choice: choiceError,
  multichoice: multichoiceError,
  integers: integersError,
  reference: referenceError,
  numbers: numbersError,
  coordinates: coordinatesError,
  rows: rowsError,
};

function fieldError(
  spec: FieldSpec,
  value: unknown,
  context: Context,
): string | undefined {
  const check = FIELD_ERRORS[spec.input.type] as
    FieldError<Input["type"]> | undefined;
  return check?.(spec, spec.input, value, context);
}

/** Error messages of a draft by field key; empty if the draft is a valid command. */
export function draftErrors(
  type: CommandType,
  draft: Draft,
  context: Context,
): Record<string, string> {
  const errors: Record<string, string> = {};
  for (const spec of fieldSpecs(type, draft, context)) {
    const error = fieldError(spec, getValue(draft, spec.path), context);
    if (error) errors[spec.key] = error;
    for (const row of cells(spec, draft)) {
      for (const cell of row) {
        const message = fieldError(cell, getValue(draft, cell.path), context);
        if (message) errors[cell.key] = message;
      }
    }
  }
  if (type === "loadcase.add" && typeof draft.type === "string") {
    Object.assign(errors, loadcaseFieldErrors(draft as unknown as Loadcase));
  }
  if (type === "material.add") Object.assign(errors, sameLengthErrors(draft));
  return errors;
}

/**
 * Lists of values of a material that need the same number of values (`x-same-length`,
 * e.g. the moduli and the exponents of Ogden, #136): an error at the later ones.
 */
function sameLengthErrors(draft: Draft): Record<string, string> {
  const model = MATERIAL_MODELS.find((m) => m.name === draft.model);
  const values = isObject(draft.parameters) ? draft.parameters : {};
  const [first, ...rest] = model?.sameLength ?? [];
  const errors: Record<string, string> = {};
  const length = (key: string) =>
    Array.isArray(values[key]) ? (values[key] as unknown[]).length : undefined;
  for (const key of rest) {
    const [a, b] = [length(first), length(key)];
    if (a !== undefined && b !== undefined && a !== b) {
      const label = model!.parameters.find((p) => p.key === first)!.label;
      errors[`parameters.${key}`] =
        `Enter as many values as for ${label} (${a}).`;
    }
  }
  return errors;
}

/** The command of a draft without errors. */
export function toCommand(
  type: CommandType,
  draft: Draft,
  context: Context,
): Command {
  const known = keysOf(type, draft, context);
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
