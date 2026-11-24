import { describe, expect, it } from "vitest";
import type { Command } from "./commands";
import {
  FORMULATIONS,
  first,
  fits,
  fitting,
  formulationOf,
} from "./formulations";

type Material = Extract<Command, { command: "material.add" }>;
const material = (model: string, parameters: Record<string, number>) =>
  ({ command: "material.add", name: "m", model, parameters }) as Material;

// a material of every kind, and the formulations that take it (like
// tests/test_formulations.py)
const KINDS: [string, Material, string[]][] = [
  ["incompressible", material("NeoHooke", { mu: 1 }), ["u-p-J", "u-isochoric"]],
  ["with a bulk modulus", material("NeoHooke", { mu: 1, bulk: 5000 }), ["u"]],
  [
    "compressible",
    material("NeoHookeCompressible", { mu: 1, lmbda: 5000 }),
    ["u"],
  ],
  ["strain-based", material("LinearElastic", { E: 210000, nu: 0.3 }), ["u"]],
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
        "Nearly incompressible (u, p, J)",
        "Nearly incompressible",
        "nearly_incompressible",
        "mixed",
        undefined,
        "isochoric",
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
    expect(formulationOf("u-p-J-condensed")).toBeUndefined();
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
    expect(KINDS.map(([, m]) => fitting(m)?.name)).toEqual([
      "u-p-J",
      "u",
      "u",
      "u",
    ]);
  });
});
