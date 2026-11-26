// The text of the fields of a command form (#312): numbers, lists of numbers,
// integers and coordinates as typed, also with expressions of the parameters
// (#242), and the text of their values.

export const NUMBER = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?$/i;

/**
 * A number, or an expression of the parameters as written (#242), without a leading
 * `=` (like a spreadsheet); a field without expressions takes numbers only.
 */
export const parseValue = (text: string, expressions = false): unknown => {
  const trimmed = text.trim().replace(/^=\s*/, "");
  if (trimmed === "") return undefined;
  // a number with a decimal comma is not a number, nor an expression
  const number = NUMBER.test(trimmed) || /^[+-]?\d*,\d+$/.test(trimmed);
  return number || !expressions ? Number(trimmed) : trimmed;
};

/** The parts of a text between the commas outside of parentheses. */
export function splitCommas(text: string): string[] {
  const parts = [""];
  let depth = 0;
  for (const char of text) {
    if (char === "(") depth++;
    if (char === ")") depth--;
    if (char === "," && depth <= 0) parts.push("");
    else parts[parts.length - 1] += char;
  }
  return parts;
}

/**
 * Numbers separated by commas or spaces, or with expressions of the parameters
 * separated by commas (#242), e.g. `0, 0, 2 * height`.
 */
export const parseValues = (text: string, expressions = false): unknown[] =>
  splitCommas(text).flatMap((part) => {
    const words = part
      .trim()
      .split(/\s+/)
      .filter((w) => w !== "");
    if (!words.length) return [];
    if (!expressions || words.every((w) => NUMBER.test(w)))
      return words.map(Number);
    return [parseValue(part, true)];
  });

export const parseIntegers = (text: string) =>
  text
    .split(/[,\s]+/)
    .filter((part) => part !== "")
    .map(Number);

/**
 * The shapes of the state variables of a strain-based function of a file (#425) as
 * typed: a tuple of Python like `statevars` of fem.MaterialStrain, e.g. `(1, (3, 3))`
 * for a scalar and a tensor, also with brackets or without the outer parentheses. As
 * in Python, `(3, 3)` are two state variables of 3 values, `((3, 3),)` one tensor.
 * Undefined if empty; the text if it is no tuple, for the error of the field.
 */
export function parseShapes(text: string): unknown {
  const trimmed = text.trim();
  if (trimmed === "") return undefined;
  const json = trimmed
    .replace(/\(/g, "[")
    .replace(/\)/g, "]")
    .replace(/,\s*(?=\])/g, "")
    .replace(/,\s*$/, "");
  for (const candidate of [json, `[${json}]`]) {
    try {
      const value: unknown = JSON.parse(candidate);
      if (typeof value === "number") return [value];
      if (Array.isArray(value)) return value;
    } catch {
      // not a list of JSON: the next candidate
    }
  }
  return trimmed;
}

/** A tuple of Python, with the comma of one item, e.g. `(1,)`. */
const tuple = (items: string[]) =>
  items.length === 1 ? `(${items[0]},)` : `(${items.join(", ")})`;

/** The shapes of state variables as a tuple of Python (#425), e.g. `(1, (3, 3))`. */
export const shapesText = (value: unknown): string =>
  Array.isArray(value)
    ? tuple(
        value.map((shape) =>
          Array.isArray(shape) ? tuple(shape.map(String)) : String(shape),
        ),
      )
    : typeof value === "string"
      ? value
      : "";

/** Points, one per line (or separated by ;), three numbers each. */
export const parseCoordinates = (text: string, expressions = false) =>
  text
    .split(/[\n;]/)
    .map((line) => line.trim())
    .filter((line) => line !== "")
    .map((line) => parseValues(line, expressions));

/** A number, or an expression as written. */
export const valueOf = (value: unknown) =>
  typeof value === "string" ? value : String(value);

export const coordinatesText = (value: unknown) =>
  Array.isArray(value)
    ? value
        .map((p) => (Array.isArray(p) ? p.map(valueOf).join(", ") : valueOf(p)))
        .join("\n")
    : "";

export const numberText = (value: unknown) =>
  typeof value === "string"
    ? value
    : typeof value === "number" && Number.isFinite(value)
      ? String(value)
      : "";

/** The hint of a field that takes expressions of the parameters (#242). */
export const EXPRESSION_HINT =
  "A number, or an expression of the parameters, e.g. 2 * height";
