// Generate TypeScript types from the command schema (single source of truth:
// python/felupe_studio/commands.schema.json). Run with `npm run schema:types`.
import { readFile, writeFile } from "node:fs/promises";
import { compile } from "json-schema-to-typescript";

const source = new URL(
  "../../python/felupe_studio/commands.schema.json",
  import.meta.url,
);
const target = new URL("../src/core/commands.ts", import.meta.url);

const schema = JSON.parse(await readFile(source, "utf-8"));
const types = await compile(schema, "CommandList", {
  bannerComment:
    "/* Generated from python/felupe_studio/commands.schema.json by\n" +
    " * `npm run schema:types`. Do not edit by hand. */",
  additionalProperties: false,
  unreachableDefinitions: true,
  style: { singleQuote: false },
});
await writeFile(target, types);
