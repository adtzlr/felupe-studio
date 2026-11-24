import { describe, expect, it } from "vitest";
import type { Command } from "./commands";
import {
  cellProblem,
  FORMULATIONS,
  first,
  fits,
  fitting,
  formulationOf,
  sibling,
  takes,
} from "./formulations";

type Material = Extract<Command, { command: "material.add" }>;
const material = (model: string, parameters: Record<string, number>) =>
  ({ command: "material.add", name: "m", model, parameters }) as Material;

// a material of every kind, and the formulations that take it (like
// tests/test_formulations.py)
const KINDS: [string, Material, string[]][] = [
  [
    "incompressible",
    material("NeoHooke", { mu: 1 }),
    ["u-p-J", "u-p-J-condensed", "u-p-J-mixed", "u-isochoric"],
  ],
  [
    "with a bulk modulus",
    material("NeoHooke", { mu: 1, bulk: 5000 }),
    ["u", "u-p-J-three-field"],
  ],
  [
    "compressible",
    material("NeoHookeCompressible", { mu: 1, lmbda: 5000 }),
    ["u", "u-p-J-three-field"],
  ],
  [
    "strain-based",
    material("LinearElastic", { E: 210000, nu: 0.3 }),
    ["u", "u-p-J-three-field"],
  ],
];

const CONDENSED = [
  "hexahedron",
  "hexahedron20",
  "hexahedron27",
  "quad",
  "quad8",
  "quad9",
];

describe("formulation registry (ADR 0024)", () => {
  it("reads the formulations from the schema", () => {
    expect(
      FORMULATIONS.map((f) => [
        f.name,
        f.label,
        f.group,
        f.body,
        f.fields,
        f.cells,
        f.material,
      ]),
    ).toEqual([
      [
        "u",
        "Displacement (u)",
        "Displacement",
        "fem.SolidBody",
        "u",
        undefined,
        "volumetric",
      ],
      [
        "u-p-J",
        "Automatic",
        "Nearly incompressible",
        "nearly_incompressible",
        "automatic",
        undefined,
        "isochoric",
      ],
      [
        "u-p-J-condensed",
        "Condensed per cell",
        "Nearly incompressible",
        "fem.SolidBodyNearlyIncompressible",
        "condensed",
        CONDENSED,
        "isochoric",
      ],
      [
        "u-p-J-mixed",
        "Mixed fields",
        "Nearly incompressible",
        "fem.NearlyIncompressible",
        "mixed",
        undefined,
        "isochoric",
      ],
      [
        "u-p-J-three-field",
        "Three-field variation",
        "Nearly incompressible",
        "fem.ThreeFieldVariation",
        "mixed",
        undefined,
        "volumetric",
      ],
      [
        "u-isochoric",
        "Isochoric part only (third medium)",
        "Third medium",
        "fem.SolidBody",
        "u",
        undefined,
        "none",
      ],
    ]);
    expect(formulationOf("u-p-J")).toBe(FORMULATIONS[1]);
    expect(formulationOf("u-p-J-automatic")).toBeUndefined();
    // every formulation says when to use it (#420)
    expect(FORMULATIONS.every((f) => f.hint.length > 0)).toBe(true);
    expect(formulationOf("u-p-J-three-field")!.hint).toMatch(/the slowest$/);
  });

  it.each(KINDS)("fits a material %s", (_, m, fitting) => {
    expect(FORMULATIONS.filter((f) => fits(f, m)).map((f) => f.name)).toEqual(
      fitting,
    );
  });

  it("names the first formulation that takes a material", () => {
    expect([first("volumetric"), first("isochoric"), first("none")]).toEqual([
      "u",
      "u-p-J",
      "u-isochoric",
    ]);
    // a new section of a material keeps the automatic u-p-J (#420)
    expect(KINDS.map(([, m]) => fitting(m)?.name)).toEqual([
      "u-p-J",
      "u",
      "u",
      "u",
    ]);
  });

  it("names a formulation of the same menu that takes a material (#420)", () => {
    const [incompressible, withBulk] = KINDS.map(([, m]) => m);
    const of = (name: string) => formulationOf(name)!;
    expect(sibling(of("u-p-J"), withBulk)).toBe("u-p-J-three-field");
    expect(sibling(of("u-p-J-three-field"), incompressible)).toBe("u-p-J");
    expect(sibling(of("u"), incompressible)).toBeUndefined();
    expect(sibling(of("u-isochoric"), withBulk)).toBeUndefined();
  });

  it("takes the cell types of a formulation (#420)", () => {
    const condensed = formulationOf("u-p-J-condensed")!;
    expect(CONDENSED.every((type) => takes(condensed, type))).toBe(true);
    expect(takes(condensed, "tetra10")).toBe(false);
    expect(takes(formulationOf("u-p-J")!, "tetra")).toBe(true);
    // the same message as cell_problem() in Python
    expect(cellProblem("rubber", condensed, "tetra")).toBe(
      "Condensed per cell (u-p-J-condensed) takes hexahedrons and quads, not " +
        "the tetra cells of 'rubber'. Use 'u-p-J' or 'u-p-J-mixed'.",
    );
    expect(cellProblem("rubber", condensed, "triangle6")).toMatch(
      /not the triangle6 cells of 'rubber'/,
    );
    expect(cellProblem("rubber", condensed, "quad9")).toBeUndefined();
    expect(
      cellProblem("rubber", formulationOf("u-p-J-mixed")!, "tetra"),
    ).toBeUndefined();
  });
});
