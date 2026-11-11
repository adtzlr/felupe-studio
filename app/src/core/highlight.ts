// A small highlighter of Python for the script view (#130): comments, strings,
// numbers, keywords, constants and the names of calls. It splits the source into
// lines of tokens; the text of the tokens of a line is the line itself.

export type TokenKind =
  "comment" | "string" | "number" | "keyword" | "constant" | "call";

export interface Token {
  text: string;
  kind?: TokenKind;
}

const KEYWORDS = new Set([
  "and",
  "as",
  "assert",
  "break",
  "class",
  "continue",
  "def",
  "del",
  "elif",
  "else",
  "except",
  "finally",
  "for",
  "from",
  "global",
  "if",
  "import",
  "in",
  "is",
  "lambda",
  "nonlocal",
  "not",
  "or",
  "pass",
  "raise",
  "return",
  "try",
  "while",
  "with",
  "yield",
]);

const CONSTANTS = new Set(["None", "True", "False"]);

// strings with an optional prefix (f, r, b, …), triple-quoted ones first; then
// comments, numbers and names
const PATTERN = new RegExp(
  [
    String.raw`(?<string>[rRbBfFuU]{0,2}(?:"""[\s\S]*?"""|'''[\s\S]*?'''|"(?:\\.|[^"\\\n])*"|'(?:\\.|[^'\\\n])*'))`,
    String.raw`(?<comment>#[^\n]*)`,
    String.raw`(?<number>\b\d+(?:\.\d*)?(?:[eE][+-]?\d+)?\b|\.\d+(?:[eE][+-]?\d+)?\b)`,
    String.raw`(?<name>[A-Za-z_][A-Za-z0-9_]*)`,
  ].join("|"),
  "g",
);

/** The kind of a match of the pattern, and whether a name is called. */
function kindOf(
  groups: Record<string, string | undefined>,
  called: boolean,
): TokenKind | undefined {
  if (groups.string !== undefined) return "string";
  if (groups.comment !== undefined) return "comment";
  if (groups.number !== undefined) return "number";
  const name = groups.name!;
  if (KEYWORDS.has(name)) return "keyword";
  if (CONSTANTS.has(name)) return "constant";
  return called ? "call" : undefined;
}

/** Split Python source into lines of tokens. */
export function highlightPython(source: string): Token[][] {
  const tokens: Token[] = [];
  let last = 0;
  for (const match of source.matchAll(PATTERN)) {
    const groups = match.groups ?? {};
    const end = match.index + match[0].length;
    const called = /^\s*\(/.test(source.slice(end, end + 8));
    if (match.index > last)
      tokens.push({ text: source.slice(last, match.index) });
    tokens.push({ text: match[0], kind: kindOf(groups, called) });
    last = end;
  }
  if (last < source.length) tokens.push({ text: source.slice(last) });

  // split the tokens at the line breaks
  const lines: Token[][] = [[]];
  for (const token of tokens) {
    const parts = token.text.split("\n");
    parts.forEach((part, i) => {
      if (i > 0) lines.push([]);
      if (part) lines[lines.length - 1].push({ text: part, kind: token.kind });
    });
  }
  // a final line break ends the last line, it does not start a new one
  if (source.endsWith("\n")) lines.pop();
  return lines;
}
