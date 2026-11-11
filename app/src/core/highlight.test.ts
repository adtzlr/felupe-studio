import { describe, expect, it } from "vitest";
import { highlightPython } from "./highlight";

const kinds = (line: { text: string; kind?: string }[]) =>
  line.filter((t) => t.kind).map((t) => [t.kind, t.text]);

describe("highlightPython", () => {
  it("splits the source into lines of tokens", () => {
    const source = "import felupe as fem\n\nmesh = fem.Cube(n=3)  # a cube\n";
    const lines = highlightPython(source);
    expect(lines).toHaveLength(3);
    expect(lines.map((l) => l.map((t) => t.text).join(""))).toEqual(
      source.split("\n").slice(0, 3),
    );
    expect(kinds(lines[0])).toEqual([
      ["keyword", "import"],
      ["keyword", "as"],
    ]);
    expect(lines[1]).toEqual([]);
    expect(kinds(lines[2])).toEqual([
      ["call", "Cube"],
      ["number", "3"],
      ["comment", "# a cube"],
    ]);
  });

  it("keeps strings with their prefixes, also over several lines", () => {
    const lines = highlightPython(
      'def f(x):\n    """A docstring\n    over lines, # no comment"""\n    return f"{x}" or None\n',
    );
    expect(kinds(lines[0])).toEqual([
      ["keyword", "def"],
      ["call", "f"],
    ]);
    expect(kinds(lines[1])).toEqual([["string", '"""A docstring']]);
    expect(kinds(lines[2])).toEqual([
      ["string", '    over lines, # no comment"""'],
    ]);
    expect(kinds(lines[3])).toEqual([
      ["keyword", "return"],
      ["string", 'f"{x}"'],
      ["keyword", "or"],
      ["constant", "None"],
    ]);
  });

  it("knows numbers with exponents and names with digits", () => {
    const [line] = highlightPython("tol = 1.5e-08 + x2 + .5");
    expect(kinds(line)).toEqual([
      ["number", "1.5e-08"],
      ["number", ".5"],
    ]);
  });
});
