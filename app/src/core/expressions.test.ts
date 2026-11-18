import { describe, expect, it } from "vitest";
import data from "../../../tests/data/expression_cases.json";
import { ExpressionError, evaluate, names, parse, rename } from "./expressions";

describe("expressions of parameters (#242)", () => {
  // the same cases, values and messages as felupe_studio.expressions
  it.each(data.expressions.map((c) => [JSON.stringify(c.text), c] as const))(
    "%s",
    (_, c) => {
      const values = c.values as Record<string, number>;
      if ("error" in c) {
        expect(() => evaluate(c.text, values)).toThrow(ExpressionError);
        expect(() => evaluate(c.text, values)).toThrow(c.error);
      } else {
        // the functions of the math libraries may differ in the last digit
        const value = evaluate(c.text, values);
        expect(Math.abs(value - c.value!)).toBeLessThanOrEqual(
          1e-12 * Math.abs(c.value!),
        );
      }
    },
  );

  it("parses a power before a unary minus on its left", () => {
    expect(parse("-2 ** 2")).toEqual([
      "neg",
      ["**", ["number", 2], ["number", 2]],
    ]);
    expect(parse("2 ** -1")).toEqual([
      "**",
      ["number", 2],
      ["neg", ["number", 1]],
    ]);
  });

  it("knows the names of the parameters of an expression", () => {
    expect(names("max(h, 2 * pi * r) + h")).toEqual(["h", "pi", "r"]);
    expect(names("-(a ** b) / sqrt(c)")).toEqual(["a", "b", "c"]);
  });

  it("renames whole names only", () => {
    expect(rename("2 * h + h2 + sqrt(h)", "h", "height")).toBe(
      "2 * height + h2 + sqrt(height)",
    );
    expect(rename("1.h + h_", "h", "x")).toBe("1.h + h_");
  });
});
