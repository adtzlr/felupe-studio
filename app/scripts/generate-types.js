// Generate TypeScript types from the command schema (single source of truth:
// python/felupe_studio/commands.schema.json). Run with `npm run schema:types`.
//
// Two files: src/core/commands.ts has the commands as written, whose numbers may be
// expressions of the parameters (#242, ADR 0013: `number | string`), and
// src/core/resolved.ts the commands with the values of their expressions (numbers
// only), which the viewer and the validation read.
import { readFile, writeFile } from "node:fs/promises";
import { compile } from "json-schema-to-typescript";

const source = new URL(
  "../../python/felupe_studio/commands.schema.json",
  import.meta.url,
);

const schema = JSON.parse(await readFile(source, "utf-8"));

/** The schema without the expressions: a number field is a number. */
function withoutExpressions(node) {
  if (Array.isArray(node)) return node.map(withoutExpressions);
  if (!node || typeof node !== "object") return node;
  const result = {};
  for (const [key, value] of Object.entries(node)) {
    if (
      key === "type" &&
      Array.isArray(value) &&
      value.includes("string") &&
      (value.includes("number") || value.includes("integer"))
    ) {
      const types = value.filter((t) => t !== "string");
      result.type = types.length === 1 ? types[0] : types;
    } else result[key] = withoutExpressions(value);
  }
  return result;
}

const options = {
  additionalProperties: false,
  unreachableDefinitions: true,
  style: { singleQuote: false },
};
const banner = (what) =>
  "/* Generated from python/felupe_studio/commands.schema.json by\n" +
  ` * \`npm run schema:types\`. Do not edit by hand. ${what} */`;

await writeFile(
  new URL("../src/core/commands.ts", import.meta.url),
  await compile(schema, "CommandList", {
    ...options,
    bannerComment: banner(
      "The commands as written:\n * a number may be an expression of the parameters (#242).",
    ),
  }),
);
await writeFile(
  new URL("../src/core/resolved.ts", import.meta.url),
  await compile(withoutExpressions(schema), "CommandList", {
    ...options,
    bannerComment: banner(
      "The commands with the values of\n * their expressions (#242): numbers only.",
    ),
  }),
);
