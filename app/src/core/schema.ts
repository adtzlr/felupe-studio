// The command schema (single source of truth, ADR 0003) and values read from it.
import schema from "../../../python/felupe_studio/commands.schema.json";

export { schema };

export const SCHEMA_VERSION: number = schema.properties.schema_version.const;

const reserved = schema.$defs.Name["x-reserved"];

/** Python keywords, which cannot be names in the generated script. */
export const RESERVED_KEYWORDS: ReadonlySet<string> = new Set(
  reserved.keywords,
);

/** Names used by the generated script. */
export const RESERVED_NAMES: ReadonlySet<string> = new Set(reserved.names);

/** Prefixes of names used by the generated script. */
export const RESERVED_PREFIXES: readonly string[] = reserved.prefixes;

/** Pattern and maximum length of a name. */
export const NAME_PATTERN = new RegExp(schema.$defs.Name.pattern);
export const NAME_MAX_LENGTH: number = schema.$defs.Name.maxLength;
