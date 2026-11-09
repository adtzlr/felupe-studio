import { describe, expect, it } from "vitest";
import fixture from "../../../tests/data/two_sections.json";
import type { Command } from "../core/commands";
import { fields } from "./properties";

const commands = fixture.commands as Command[];
const get = (name: string) => fields(commands.find((c) => c.name === name)!);

describe("fields", () => {
  it("labels the fields of commands", () => {
    expect(get("specimen")).toEqual([
      { label: "File", value: "specimen.vtu" },
      { label: "Cell tag", value: "material" },
    ]);
    expect(get("umat_hard")).toEqual([
      { label: "Model", value: "LinearElasticLargeStrain" },
      { label: "E", value: "10" },
      { label: "nu", value: "0.3" },
    ]);
    expect(get("section_soft")).toContainEqual({
      label: "Formulation",
      value: "Mixed (u, p, J)",
    });
    expect(get("left")).toEqual([
      { label: "Axis", value: "x" },
      { label: "Value", value: "0" },
    ]);
    expect(get("fixed")).toEqual([
      { label: "Point set", value: "left" },
      { label: "Constrained", value: "x, y, z" },
      { label: "Value", value: "0" },
    ]);
    expect(get("job_1")).toEqual([
      { label: "Steps", value: "step_1" },
      { label: "Curve boundary", value: "move" },
    ]);
  });

  it("shows defaults that are not stored", () => {
    expect(get("step_1")).toEqual([
      { label: "Sections", value: "all" },
      { label: "Ramped boundary", value: "move" },
      { label: "Start", value: "0" },
      { label: "End", value: "0.5" },
      { label: "Increments", value: "5" },
    ]);
  });

  it("shortens long lists of point ids", () => {
    const picked: Command = {
      command: "pointset.add",
      name: "picked",
      select: { ids: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10] },
    };
    expect(fields(picked)).toEqual([
      { label: "Point ids", value: "10 points: 1, 2, 3, 4, 5, 6, 7, 8, …" },
    ]);
  });
});
