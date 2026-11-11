import { describe, expect, it } from "vitest";
import fixture from "../../../tests/data/two_sections.json";
import type { Command, CommandList } from "./commands";
import { REGISTRY, type Tab } from "./registry";
import { dialogTitle, ribbonGroups, unavailable } from "./ribbon";
import type { CommandType } from "./validate";

const commands = (fixture as CommandList).commands;
const labels = (tab: Tab) =>
  ribbonGroups(tab).map((group) => group.map((item) => item.label));

describe("ribbonGroups", () => {
  it("has the commands of every tab", () => {
    expect(labels("mesh")).toEqual([
      ["Import mesh"],
      ["Merge points"],
      ["Cell set from tag"],
      ["Cell set of a mesh"],
      ["Point set"],
      ["Model settings"],
    ]);
    expect(labels("sections")).toEqual([["Section"]]);
    expect(labels("loads")).toEqual([
      ["Boundary"],
      ["Uniaxial", "Biaxial", "Planar", "Shear"],
      ["Control point"],
      ["Multi-point constraint"],
      ["Point load"],
    ]);
    expect(labels("steps")).toEqual([["Step"], ["Job"]]);
  });

  it("has one button per material model, from the schema", () => {
    const [materials] = ribbonGroups("materials");
    expect(materials.map((item) => [item.label, item.preset])).toEqual([
      ["Neo-Hooke", { model: "NeoHooke" }],
      ["Neo-Hooke (compressible)", { model: "NeoHookeCompressible" }],
      ["Mooney-Rivlin", { model: "MooneyRivlin" }],
      ["Linear elastic (large strain)", { model: "LinearElasticLargeStrain" }],
    ]);
    expect(dialogTitle(materials[0])).toBe("New material");
  });

  it("covers every command exactly once", () => {
    const tabs: Tab[] = ["mesh", "materials", "sections", "loads", "steps"];
    const types = tabs.flatMap((tab) =>
      ribbonGroups(tab).map((group) => group[0].type),
    );
    expect(types.sort()).toEqual(
      (Object.keys(REGISTRY) as CommandType[]).sort(),
    );
  });
});

describe("unavailable", () => {
  const empty = { commands: [] as Command[] };

  it("names the objects that are missing", () => {
    expect(unavailable("mesh.import", empty)).toBeUndefined();
    expect(unavailable("material.add", empty)).toBeUndefined();
    expect(unavailable("step.add", empty)).toBeUndefined();
    expect(unavailable("cellset.from_file", empty)).toBe(
      "Create a mesh first.",
    );
    expect(unavailable("section.add", empty)).toBe(
      "Create a cell set and a material first.",
    );
    expect(unavailable("boundary.add", empty)).toBe(
      "Create a point set first.",
    );
    expect(unavailable("job.add", empty)).toBe("Create a step first.");
    for (const type of Object.keys(REGISTRY) as CommandType[]) {
      expect(unavailable(type, { commands }), type).toBeUndefined();
    }
  });

  it("allows one merge setting only", () => {
    const merge: Command = {
      command: "mesh.merge",
      name: "merge",
      decimals: 6,
    };
    expect(unavailable("mesh.merge", { commands: [...commands, merge] })).toBe(
      "The model has a merge setting already; edit it in the browser.",
    );
  });
});
