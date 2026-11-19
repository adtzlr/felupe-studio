// Project files (*.felupe.json): save and load command lists. Mirrors
// felupe_studio.project; both write byte-identical files (tested with
// tests/data/*.felupe.json).
import Ajv2020 from "ajv/dist/2020";
import type { Command, CommandList } from "./commands";
import { schema, SCHEMA_VERSION } from "./schema";

export { SUFFIX } from "./files";

export class ProjectError extends Error {
  constructor(readonly errors: string[]) {
    super(errors.join("\n"));
  }
}

type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
type SchemaNode = {
  $ref?: string;
  oneOf?: SchemaNode[];
  properties?: Record<string, SchemaNode & { const?: unknown }>;
  required?: string[];
  items?: SchemaNode;
  enum?: unknown[];
  additionalProperties?: boolean;
};

/** Migrations from a schema version to the next one. */
export const MIGRATIONS: Record<
  number,
  (document: Record<string, unknown>) => Record<string, unknown>
> = { 1: rampItems, 2: cutbackSettings };

/**
 * Schema version 2 → 3: the cutback of a job has settings (#133), `"cutback": true`
 * becomes `"cutback": {}` (the defaults of FElupe) and `false` is removed. The
 * settings of the model (#132) are new.
 */
function cutbackSettings(
  document: Record<string, unknown>,
): Record<string, unknown> {
  const commands = Array.isArray(document.commands) ? document.commands : [];
  return {
    ...document,
    schema_version: 3,
    commands: commands.map((command: unknown) => {
      if (typeof command !== "object" || command === null) return command;
      const cmd = command as Record<string, unknown>;
      if (cmd.command !== "job.add" || !("cutback" in cmd)) return cmd;
      const { cutback, ...rest } = cmd;
      return cutback === true ? { ...rest, cutback: {} } : rest;
    }),
  };
}

/**
 * Schema version 1 → 2: the ramp of a step has items with their own values
 * (`boundary` and `also` become items with the same `start` and `end`, #90).
 */
function rampItems(document: Record<string, unknown>): Record<string, unknown> {
  const commands = Array.isArray(document.commands) ? document.commands : [];
  return {
    ...document,
    schema_version: 2,
    commands: commands.map((command: unknown) => {
      if (typeof command !== "object" || command === null) return command;
      const cmd = command as Record<string, unknown>;
      const ramp = cmd.ramp as Record<string, unknown> | undefined;
      if (cmd.command !== "step.add" || typeof ramp !== "object" || !ramp)
        return cmd;
      const values = Object.fromEntries(
        ["start", "end"].filter((k) => k in ramp).map((k) => [k, ramp[k]]),
      );
      const also = Array.isArray(ramp.also) ? ramp.also : [];
      const items = [ramp.boundary, ...also].map((target) => ({
        target,
        ...values,
      }));
      const num = "num" in ramp ? { num: ramp.num } : {};
      return { ...cmd, ramp: { ...num, items } };
    }),
  };
}

const defs = (schema as unknown as { $defs: Record<string, SchemaNode> }).$defs;

function resolve(node: SchemaNode): SchemaNode {
  while (node.$ref) node = defs[node.$ref.split("/").pop()!];
  return node;
}

function variant(node: SchemaNode, value: Json): SchemaNode | undefined {
  for (let option of node.oneOf ?? []) {
    option = resolve(option);
    if (option.oneOf) {
      const nested = variant(option, value);
      if (nested) return nested;
      continue;
    }
    if (!value || typeof value !== "object" || Array.isArray(value)) continue;
    const properties = option.properties ?? {};
    const matches = Object.entries(properties).every(
      ([key, p]) => !("const" in p) || value[key] === p.const,
    );
    if (matches && (option.required ?? []).every((key) => key in value))
      return option;
  }
  return undefined;
}

/** Order the keys of the value like the properties of its schema node. */
function canonical(value: Json, node: SchemaNode | undefined): Json {
  if (node) node = resolve(node);
  if (node?.oneOf) node = variant(node, value);
  if (Array.isArray(value)) return value.map((v) => canonical(v, node?.items));
  if (value && typeof value === "object") {
    const properties = node?.properties ?? {};
    const keys = [
      ...Object.keys(properties).filter((k) => k in value),
      ...Object.keys(value)
        .filter((k) => !(k in properties))
        .sort(),
    ];
    return Object.fromEntries(
      keys.map((k) => [k, canonical(value[k], properties[k])]),
    );
  }
  return value;
}

/** Return the text of a project file for a command list. */
export function serialize(document: CommandList): string {
  const value = canonical(
    document as unknown as Json,
    schema as unknown as SchemaNode,
  );
  return JSON.stringify(value, null, 2) + "\n";
}

/** Bring a command list to the current schema version. */
export function migrate(
  document: Record<string, unknown>,
): Record<string, unknown> {
  const initial = document.schema_version;
  if (typeof initial !== "number" || !Number.isInteger(initial)) {
    throw new ProjectError(["The file has no valid schema_version."]);
  }
  let version: number = initial;
  if (version > SCHEMA_VERSION) {
    throw new ProjectError([
      `The file has schema version ${version}, but this version of FElupe Studio ` +
        `supports ${SCHEMA_VERSION}. Please update FElupe Studio.`,
    ]);
  }
  while (version < SCHEMA_VERSION) {
    const migration = MIGRATIONS[version];
    if (!migration)
      throw new ProjectError([`No migration from schema version ${version}.`]);
    document = migration(document);
    version = document.schema_version as number;
  }
  return document;
}

/** The keywords of the schema that are not JSON schema, e.g. `x-label`. */
function extensionKeywords(
  node: unknown,
  found = new Set<string>(),
): Set<string> {
  if (Array.isArray(node)) {
    for (const item of node) extensionKeywords(item, found);
  } else if (typeof node === "object" && node !== null) {
    for (const [key, value] of Object.entries(node)) {
      if (key.startsWith("x-")) found.add(key);
      else extensionKeywords(value, found);
    }
  }
  return found;
}

/** A validator of the schema that knows its extension keywords. */
function newAjv(): Ajv2020 {
  const ajv = new Ajv2020({ allErrors: true });
  for (const keyword of extensionKeywords(schema)) ajv.addKeyword(keyword);
  return ajv;
}

let validator: ReturnType<Ajv2020["compile"]> | undefined;

/** Messages of the JSON schema validation of a command list (empty if valid). */
export function schemaErrors(document: unknown): string[] {
  if (!validator) {
    validator = newAjv().compile(schema);
  }
  if (validator(document)) return [];
  return (validator.errors ?? []).map(
    (e) =>
      `${e.instancePath.slice(1) || "(document)"}: ${e.message ?? "is invalid"}`,
  );
}

let commandAjv: Ajv2020 | undefined;
const commandValidators = new Map<string, ReturnType<Ajv2020["compile"]>>();

/** Name of the schema definition of a command, e.g. `MaterialNeoHooke`. */
function definitionOf(command: Command): string | undefined {
  const visit = (node: SchemaNode, name?: string): string | undefined => {
    const id = node.$ref?.split("/").pop();
    if (id) return visit(defs[id], id);
    if (node.oneOf) {
      for (const option of node.oneOf) {
        const found = visit(option);
        if (found) return found;
      }
      return undefined;
    }
    const properties = node.properties ?? {};
    const matches = Object.entries(properties).every(
      ([key, p]) =>
        !("const" in p) ||
        (command as unknown as Record<string, unknown>)[key] === p.const,
    );
    return matches && properties.command ? name : undefined;
  };
  return visit(defs.Command);
}

/**
 * Messages of the JSON schema validation of a single command against its own
 * definition (shorter than the messages of the whole command list).
 */
export function commandErrors(command: Command): string[] {
  const name = definitionOf(command);
  if (!name) return [`Unknown command '${command.command}'.`];
  if (!commandAjv) {
    commandAjv = newAjv();
    commandAjv.addSchema(schema);
  }
  let validate = commandValidators.get(name);
  if (!validate) {
    validate = commandAjv.compile({ $ref: `${schema.$id}#/$defs/${name}` });
    commandValidators.set(name, validate);
  }
  if (validate(command)) return [];
  return (validate.errors ?? []).map(
    (e) =>
      `${e.instancePath.slice(1) || "(command)"}: ${e.message ?? "is invalid"}`,
  );
}

/**
 * Read a project file and return the command list. The file is migrated to the
 * current schema version and checked against the schema; references between
 * commands are checked by the store (validate.ts).
 */
export function parse(text: string): CommandList {
  let document: unknown;
  try {
    document = JSON.parse(text);
  } catch (error) {
    throw new ProjectError([
      `The file is not valid JSON: ${(error as Error).message}`,
    ]);
  }
  if (!document || typeof document !== "object" || Array.isArray(document)) {
    throw new ProjectError(["The file does not contain a command list."]);
  }
  const migrated = migrate(document as Record<string, unknown>);
  const errors = schemaErrors(migrated);
  if (errors.length) {
    const message = newerMessage(newerFeatures(migrated));
    throw new ProjectError(message ? [message, ...errors] : errors);
  }
  return migrated as unknown as CommandList;
}

// Projects of a newer version (#344), like felupe_studio.project: what a command
// list uses that this version does not know. The schema version rises only with
// changes that are not additive, so a newer project usually has the same one.

type JsonObject = { [key: string]: Json };
/** A part of a value that the schema does not know: a value or a property. */
type Part = [kind: "value" | "property", path: string[], value?: string];

const isObject = (value: unknown): value is JsonObject =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** The variants of a `oneOf`, with those of a nested `oneOf`. */
function options(node: SchemaNode): SchemaNode[] {
  return (node.oneOf ?? []).flatMap((option) => {
    const resolved = resolve(option);
    return resolved.oneOf ? options(resolved) : [resolved];
  });
}

function consts(option: SchemaNode): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(option.properties ?? {})
      .filter(([, p]) => "const" in p)
      .map(([key, p]) => [key, p.const]),
  );
}

/**
 * The first key of the value that tells the variants apart (e.g. `command`, `tool`
 * or `model`) and has a value that no variant has, else undefined. A missing key or
 * a value that is no string is an error of the schema, not a new variant.
 */
function unknownConst(
  variants: SchemaNode[],
  value: JsonObject,
): [string, string] | undefined {
  const keys = new Set(variants.flatMap((o) => Object.keys(consts(o))));
  for (const key of keys) {
    const known = new Set(
      variants.filter((o) => key in consts(o)).map((o) => consts(o)[key]),
    );
    const loose = variants.some(
      (o) => key in (o.properties ?? {}) && !(key in consts(o)),
    );
    const given = value[key];
    if (loose || typeof given !== "string") continue;
    if (!known.has(given)) return [key, given];
    variants = variants.filter((o) => {
      const c = consts(o);
      return !(key in c) || c[key] === given;
    });
  }
  return undefined;
}

/** The variant of a `oneOf` for the value, or undefined if a part is new. */
function variantOf(
  value: JsonObject,
  node: SchemaNode,
  path: string[],
  found: Part[],
): SchemaNode | undefined {
  const variants = options(node);
  const known = unknownConst(variants, value);
  if (known) {
    found.push(["value", [...path, known[0]], known[1]]);
    return undefined;
  }
  const fitting = variants.filter((o) =>
    Object.entries(consts(o)).every(
      ([k, v]) => !(k in value) || value[k] === v,
    ),
  );
  if (fitting.length === 1) return fitting[0];
  // variants told apart by their keys, e.g. the select of a point set: a key of no
  // variant is new
  const keys = new Set(fitting.flatMap((o) => Object.keys(o.properties ?? {})));
  const fresh = fitting.length
    ? Object.keys(value).filter((k) => !keys.has(k))
    : [];
  for (const key of fresh) found.push(["property", [...path, key]]);
  return fresh.length ? undefined : variant(node, value);
}

/** Collect the parts of a value that its schema node does not know. */
function newParts(
  value: Json,
  node: SchemaNode,
  path: string[],
  found: Part[],
): void {
  node = resolve(node);
  if (Array.isArray(value)) {
    for (const item of value) newParts(item, node.items ?? {}, path, found);
  } else if (typeof value === "string") {
    const values = node.enum ?? [];
    const strings = values.every((e) => typeof e === "string");
    if (values.length && strings && !values.includes(value))
      found.push(["value", path, value]);
  } else if (isObject(value)) {
    const chosen = node.oneOf ? variantOf(value, node, path, found) : node;
    if (!chosen) return;
    const properties = chosen.properties ?? {};
    if (chosen.additionalProperties === false) {
      for (const key of Object.keys(value))
        if (!(key in properties)) found.push(["property", [...path, key]]);
    }
    for (const [key, child] of Object.entries(properties))
      if (key in value) newParts(value[key], child, [...path, key], found);
  }
}

function phrase([kind, path, value]: Part, command: unknown): string {
  const where = path.join(".");
  const owner = typeof command === "string" ? `\`${command}\`` : "the project";
  if (kind === "property") return `the property \`${where}\` of ${owner}`;
  if (where === "command") return `\`${value}\``;
  if (path.length === 1) return `the ${where} \`${value}\` of ${owner}`;
  return `the value \`${value}\` of \`${where}\` of ${owner}`;
}

/**
 * What a command list uses that this version of FElupe Studio does not know (#344):
 * a command type, a tool of `mesh.generate`, a material model, a value of an
 * enumeration or a property. The phrases of the message, without repeats.
 */
export function newerFeatures(document: Record<string, unknown>): string[] {
  const root = schema as unknown as SchemaNode;
  const found = Object.keys(document)
    .filter((key) => !(key in (root.properties ?? {})))
    .map((key) => phrase(["property", [key]], undefined));
  const commands = Array.isArray(document.commands) ? document.commands : [];
  for (const command of commands as Json[]) {
    if (!isObject(command)) continue;
    const parts: Part[] = [];
    newParts(command, defs.Command, [], parts);
    found.push(...parts.map((part) => phrase(part, command.command)));
  }
  return [...new Set(found)];
}

/** The version of the app: null outside of it, e.g. in the config of Vite. */
const APP_VERSION =
  typeof __APP_VERSION__ === "string" ? __APP_VERSION__ : null;

/** The message about the features of a newer version, if there are any. */
export function newerMessage(
  features: readonly string[],
  version: string | null = APP_VERSION,
): string | undefined {
  if (!features.length) return undefined;
  const listed =
    features.length > 1
      ? `${features.slice(0, -1).join(", ")} and ${features.at(-1)}`
      : features[0];
  const app = version
    ? `FElupe Studio ${version}`
    : "this version of FElupe Studio";
  return (
    `This project uses ${listed}, which ${app} does not know. ` +
    "It may have been saved with a newer version: please update FElupe Studio."
  );
}
