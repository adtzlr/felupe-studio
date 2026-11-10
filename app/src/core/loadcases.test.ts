import { describe, expect, it } from "vitest";
import {
  describeLoadcase,
  type Loadcase,
  loadcaseFieldErrors,
  loadcaseProblems,
} from "./loadcases";

const loadcase = (fields: Partial<Loadcase> & Pick<Loadcase, "type">) =>
  ({ command: "loadcase.add", name: "test", ...fields }) as Loadcase;

describe("load cases", () => {
  it("describe their type, axes and flags", () => {
    expect(describeLoadcase(loadcase({ type: "uniaxial" }))).toBe("uniaxial x");
    expect(
      describeLoadcase(
        loadcase({ type: "planar", axis: "z", clamped: true, symmetry: false }),
      ),
    ).toBe("planar z, y · clamped · no symmetry");
    expect(describeLoadcase(loadcase({ type: "shear", normal: "z" }))).toBe(
      "shear x, z",
    );
  });

  it("need two axes and a support", () => {
    expect(
      loadcaseProblems(loadcase({ type: "biaxial", second: "x" })),
    ).toEqual([
      "load case 'test' needs different axes for 'axis' and 'second'.",
    ]);
    expect(
      loadcaseProblems(loadcase({ type: "uniaxial", symmetry: false })),
    ).toHaveLength(1);
    expect(
      loadcaseProblems(
        loadcase({ type: "uniaxial", symmetry: false, clamped: true }),
      ),
    ).toEqual([]);
    // the bottom face of a shear test is fixed
    expect(
      loadcaseProblems(loadcase({ type: "shear", symmetry: false })),
    ).toEqual([]);
  });
});

describe("load cases in forms", () => {
  it("show their problems at the fields", () => {
    expect(
      loadcaseFieldErrors(loadcase({ type: "shear", normal: "x" })),
    ).toEqual({ normal: "Choose an axis other than the first one." });
    expect(
      loadcaseFieldErrors(loadcase({ type: "biaxial", symmetry: false })),
    ).toEqual({ symmetry: "Use symmetry planes or clamped end faces." });
    expect(loadcaseFieldErrors(loadcase({ type: "uniaxial" }))).toEqual({});
  });
});
