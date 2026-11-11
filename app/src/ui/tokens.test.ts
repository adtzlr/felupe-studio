// The styles use the design tokens of the :root block only (#125).
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// read as a file: CSS modules are empty in the tests
const source = readFileSync(new URL("./shell.css", import.meta.url), "utf-8");
const css = source.replace(/\/\*[\s\S]*?\*\//g, "");
const end = css.indexOf("}", css.indexOf(":root {")) + 1;
const root = css.slice(0, end);
const rest = css.slice(end);

const defined = new Set([...root.matchAll(/(--[\w-]+):/g)].map((m) => m[1]));
const used = new Set([...css.matchAll(/var\((--[\w-]+)\)/g)].map((m) => m[1]));

/** The values of a property outside the token block. */
function values(property: string): string[] {
  const pattern = new RegExp(`(?:^|[\\s;{])${property}:\\s*([^;]+);`, "g");
  return [...rest.matchAll(pattern)].map((m) => m[1].trim());
}

describe("design tokens", () => {
  it("has no colors outside the tokens", () => {
    expect(rest.length).toBeGreaterThan(10000);
    expect(rest.match(/#[0-9a-fA-F]{3,8}\b/g)).toBeNull();
    expect(rest.match(/\brgba?\(/g)).toBeNull();
  });

  it("uses tokens for type, shapes, depth and stacking", () => {
    for (const v of values("font-size"))
      expect(v).toMatch(/^var\(--text-[\w-]+\)$|em$/);
    for (const v of values("font-weight")) expect(v).toMatch(/^var\(--weight-/);
    for (const v of values("border-radius"))
      expect(v).toMatch(/^var\(--radius-|^50%$/);
    for (const v of values("box-shadow"))
      expect(v).toMatch(/^(var\(--[\w-]+\)|none)$/);
    for (const v of values("z-index")) expect(v).toMatch(/^var\(--z-/);
  });

  it("uses the spacing scale for gaps, margins and paddings", () => {
    const properties = ["gap", "margin", "padding"].flatMap((p) => [
      p,
      ...["top", "right", "bottom", "left"].map((side) => `${p}-${side}`),
    ]);
    for (const property of properties) {
      for (const value of values(property)) {
        for (const part of value.split(/\s+/)) {
          // a hairline, a negative offset or a relative length is fine
          expect(part).toMatch(
            /^(0|auto|1px|-\d+px|\d+(vh|vw|%)|var\(--space-\d+\))$/,
          );
        }
      }
    }
  });

  it("defines every token that is used, and uses every token", () => {
    const external = [...used].filter((name) => name.startsWith("--fv-"));
    expect([...used].filter((name) => !defined.has(name))).toEqual(external);
    expect([...defined].filter((name) => !used.has(name))).toEqual([]);
  });
});
