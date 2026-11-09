import { describe, expect, it } from "vitest";
import { DEFAULT_SIZES, parseSizes, seconds, toMarkdown } from "./format";

describe("parseSizes", () => {
  it("parses the default sizes", () => {
    expect(parseSizes(DEFAULT_SIZES)).toEqual([3, 5, 7, 9, 11]);
  });

  it("accepts spaces and commas", () => {
    expect(parseSizes(" 2 4,6 ")).toEqual([2, 4, 6]);
  });

  it("rejects invalid sizes", () => {
    expect(() => parseSizes("")).toThrow();
    expect(() => parseSizes("1")).toThrow();
    expect(() => parseSizes("3.5")).toThrow();
    expect(() => parseSizes("26")).toThrow();
    expect(() => parseSizes("a")).toThrow();
  });
});

describe("toMarkdown", () => {
  it("contains the load times and one row per result", () => {
    const md = toMarkdown(
      { userAgent: "Test", cores: 8 },
      {
        pyodide: "314.0.7",
        python: "3.14.2",
        felupe: "12.0.0",
        numpy: "2.4.6",
        scipy: "1.18.0",
      },
      { pyodide: 1500, packages: 2500, felupe: 1000, total: 5000 },
      [
        {
          n: 3,
          points: 27,
          cells: 8,
          dofs: 81,
          increments: 5,
          setup: 0.01,
          solve: 0.1,
          force: 1.8216,
        },
        {
          n: 5,
          points: 125,
          cells: 64,
          dofs: 375,
          increments: 5,
          setup: 0.02,
          solve: 0.3,
          force: 1.8007,
        },
      ],
    );
    expect(md).toContain("| **Total** | **5.000** |");
    expect(md).toContain("| 3 | 81 | 8 | 0.010 | 0.100 | 1.8216 |");
    expect(md).toContain("| 5 | 375 | 64 | 0.020 | 0.300 | 1.8007 |");
    expect(md).toContain("**Memory:** unknown");
    expect(md).toContain("**Service worker cache:** not active");
  });

  it("formats seconds", () => {
    expect(seconds(1.23456)).toBe("1.235");
  });
});
