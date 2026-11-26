import { describe, expect, it } from "vitest";
import { parseShapes, shapesText } from "./formText";

describe("the shapes of state variables (#425)", () => {
  it("are a tuple of Python as typed", () => {
    expect(parseShapes("(1, (3, 3))")).toEqual([1, [3, 3]]);
    expect(parseShapes("1, (3, 3)")).toEqual([1, [3, 3]]);
    expect(parseShapes("[1, [3, 3]]")).toEqual([1, [3, 3]]);
    // as in Python: two state variables of 3 values, and one tensor
    expect(parseShapes("(3, 3)")).toEqual([3, 3]);
    expect(parseShapes("((3, 3),)")).toEqual([[3, 3]]);
    expect(parseShapes("(1,)")).toEqual([1]);
    expect(parseShapes("2")).toEqual([2]);
    expect(parseShapes(" ")).toBeUndefined();
    // not a tuple: the text, for the error of the field
    expect(parseShapes("(1, (3, 3)")).toBe("(1, (3, 3)");
  });

  it("are shown like statevars of the script", () => {
    expect(shapesText([1, [3, 3]])).toBe("(1, (3, 3))");
    expect(shapesText([[3, 3]])).toBe("((3, 3),)");
    expect(shapesText([1])).toBe("(1,)");
    expect(shapesText(undefined)).toBe("");
    for (const text of ["(1, (3, 3))", "((3, 3),)", "(0,)", "(2, 1)"])
      expect(shapesText(parseShapes(text))).toBe(text);
  });
});
