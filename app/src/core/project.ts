// Project files (*.felupe.json): save and load command lists. Mirrors
// felupe_studio.project; both write byte-identical files (tested with
// tests/data/*.felupe.json).
import Ajv2020 from "ajv/dist/2020";
import type { CommandList } from "./commands";
import { schema, SCHEMA_VERSION } from "./schema";

export const SUFFIX = ".felupe.json";

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
};

/** Migrations from a schema version to the next one. */
export const MIGRATIONS: Record<
  number,
  (document: Record<string, unknown>) => Record<string, unknown>
> = {};

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

let validator: ReturnType<Ajv2020["compile"]> | undefined;

function schemaErrors(document: unknown): string[] {
  if (!validator) {
    const ajv = new Ajv2020({ allErrors: true });
    ajv.addKeyword("x-reserved");
    validator = ajv.compile(schema);
  }
  if (validator(document)) return [];
  return (validator.errors ?? []).map(
    (e) =>
      `${e.instancePath.slice(1) || "(document)"}: ${e.message ?? "is invalid"}`,
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
  if (errors.length) throw new ProjectError(errors);
  return migrated as unknown as CommandList;
}
