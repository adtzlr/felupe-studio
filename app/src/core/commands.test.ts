import { describe, expect, it } from "vitest";
import fixture from "../../../tests/data/two_sections.json";
import type { Command, CommandList } from "./commands";

// The same command list as the Python fixture, checked by the TypeScript compiler.
const twoSections: CommandList = {
  schema_version: 2,
  commands: [
    {
      command: "mesh.import",
      name: "specimen",
      file: "specimen.vtu",
      tag: "material",
    },
    { command: "cellset.from_tag", name: "hard", mesh: "specimen", value: 1 },
    { command: "cellset.from_tag", name: "soft", mesh: "specimen", value: 2 },
    {
      command: "material.add",
      name: "umat_hard",
      model: "LinearElasticLargeStrain",
      parameters: { E: 10, nu: 0.3 },
    },
    {
      command: "material.add",
      name: "umat_soft",
      model: "NeoHooke",
      parameters: { mu: 1 },
    },
    {
      command: "section.add",
      name: "section_hard",
      cellset: "hard",
      material: "umat_hard",
      formulation: "u",
    },
    {
      command: "section.add",
      name: "section_soft",
      cellset: "soft",
      material: "umat_soft",
      formulation: "u-p-J",
      bulk: 5000,
    },
    { command: "pointset.add", name: "left", select: { axis: "x", value: 0 } },
    { command: "pointset.add", name: "right", select: { axis: "x", value: 3 } },
    {
      command: "boundary.add",
      name: "fixed",
      pointset: "left",
      constrained: ["x", "y", "z"],
    },
    {
      command: "boundary.add",
      name: "move",
      pointset: "right",
      constrained: ["x"],
    },
    {
      command: "step.add",
      name: "step_1",
      ramp: { num: 5, items: [{ target: "move", start: 0, end: 0.5 }] },
    },
    { command: "job.add", name: "job_1", steps: ["step_1"], curve: "move" },
  ],
};

describe("command types", () => {
  it("describe the Python fixture", () => {
    expect(twoSections).toEqual(fixture);
  });

  it("narrow material parameters by model", () => {
    const material = twoSections.commands.find(
      (c): c is Extract<Command, { command: "material.add" }> =>
        c.command === "material.add" && c.model === "LinearElasticLargeStrain",
    );
    if (material?.model !== "LinearElasticLargeStrain")
      throw new Error("not found");
    expect(material.parameters.E).toBe(10);
  });
});

describe("invalid commands", () => {
  it("are rejected by the compiler", () => {
    const material: Command = {
      command: "material.add",
      name: "m",
      model: "NeoHooke",
      // @ts-expect-error: NeoHooke has no Young's modulus
      parameters: { E: 1 },
    };
    const section: Command = {
      command: "section.add",
      name: "s",
      cellset: "c",
      material: "m",
      // @ts-expect-error: unknown formulation
      formulation: "u-p",
    };
    const boundary: Command = {
      command: "boundary.add",
      name: "b",
      pointset: "p",
      // @ts-expect-error: at least one constrained component
      constrained: [],
    };
    expect([material, section, boundary]).toHaveLength(3);
  });
});
