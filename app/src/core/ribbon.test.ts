import { describe, expect, it } from "vitest";
import fixture from "../../../tests/data/two_sections.json";
import type { Command, CommandList } from "./commands";
import { REGISTRY, type Tab } from "./registry";
import {
  dialogTitle,
  ribbonEntries,
  ribbonGroups,
  unavailable,
} from "./ribbon";
import type { CommandType } from "./validate";

const commands = (fixture as CommandList).commands;
const labels = (tab: Tab) =>
  ribbonGroups(tab).map((group) => group.map((item) => item.label));

describe("ribbonGroups", () => {
  it("has the commands of every tab", () => {
    expect(labels("mesh")).toEqual([
      ["Import mesh"],
      // the mesh tools of the registry of the schema (ADR 0019)
      // in one group with the menus Primitives and Operations
      [
        "Point",
        "Line",
        "Rectangle",
        "Cube",
        "Circle",
        "Triangle",
        "Expand",
        "Revolve",
        "Embed",
        "Translate",
        "Rotate",
        "Mirror",
        "Fill between",
        "Add runouts",
      ],
      ["Mesh script"],
      ["Merge points"],
      ["Cell set from tag"],
      ["Cell set of a mesh"],
      ["Point set"],
      ["Face set"],
      ["Model settings"],
      ["Parameter"],
    ]);
    expect(labels("sections")).toEqual([["Section"]]);
    expect(labels("loads")).toEqual([
      ["Boundary"],
      ["Uniaxial", "Biaxial", "Planar", "Shear"],
      ["Symmetry"],
      ["Control point"],
      ["Rigid surface"],
      ["Multi-point constraint"],
      ["Contact"],
      ["Point load"],
      ["Pressure"],
    ]);
    expect(labels("steps")).toEqual([["Step"], ["Job"]]);
  });

  it("has one button per material model, from the schema", () => {
    const [materials] = ribbonGroups("materials");
    expect(
      materials.map((item) => [item.label, item.preset, item.group]),
    ).toEqual([
      [
        "Linear elastic (small strain)",
        { model: "LinearElasticSmallStrain" },
        "Linear elasticity",
      ],
      [
        "Linear elastic (large strain)",
        { model: "LinearElasticLargeStrain" },
        "Linear elasticity",
      ],
      ["Neo-Hooke", { model: "NeoHooke" }, "Hyperelasticity"],
      [
        "Neo-Hooke (compressible)",
        { model: "NeoHookeCompressible" },
        "Hyperelasticity",
      ],
      ["Mooney-Rivlin", { model: "MooneyRivlin" }, "Hyperelasticity"],
      ["Yeoh", { model: "Yeoh" }, "Hyperelasticity"],
      [
        "Third-order deformation",
        { model: "ThirdOrderDeformation" },
        "Hyperelasticity",
      ],
      ["Ogden", { model: "Ogden" }, "Hyperelasticity"],
      ["Arruda-Boyce", { model: "ArrudaBoyce" }, "Hyperelasticity"],
      ["Extended tube", { model: "ExtendedTube" }, "Hyperelasticity"],
      ["Linear elastic", { model: "LinearElastic" }, "Strain-based elasticity"],
      [
        "Elastic-plastic, isotropic hardening",
        { model: "LinearElasticPlasticIsotropicHardening" },
        "Strain-based elasticity",
      ],
    ]);
    expect(dialogTitle(materials[0])).toBe("New material");
  });

  it("puts the items of a group into a menu (#136)", () => {
    const [materials] = ribbonGroups("materials");
    expect(
      ribbonEntries(materials).map((e) =>
        e.kind === "menu"
          ? `${e.group}: ${e.items.map((i) => i.label).join(", ")}`
          : e.item.label,
      ),
    ).toEqual([
      // three menus by the kind of material (#259)
      "Linear elasticity: Linear elastic (small strain), Linear elastic (large strain)",
      "Hyperelasticity: Neo-Hooke, Neo-Hooke (compressible), Mooney-Rivlin, Yeoh, " +
        "Third-order deformation, Ogden, Arruda-Boyce, Extended tube",
      "Strain-based elasticity: Linear elastic, Elastic-plastic, isotropic hardening",
    ]);
    // a group of one item is a button
    const [one] = ribbonEntries([{ ...materials[0], group: "Solo" }]);
    expect(one.kind).toBe("button");
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
    expect(unavailable("pressure.add", { commands })).toBe(
      "Create a face set first.",
    );
    const faces = {
      command: "faceset.add",
      name: "end",
      section: "section_soft",
      select: { axis: "x", value: 3 },
    } as Command;
    // a contact needs a rigid surface (#220)
    expect(unavailable("contact.add", { commands })).toBe(
      "Create a rigid surface first.",
    );
    const plate = {
      command: "rigid.add",
      name: "plate",
      coordinates: [4, 0.5, 0.5],
      shape: { normal: [-1, 0, 0] },
    } as Command;
    for (const type of Object.keys(REGISTRY) as CommandType[]) {
      expect(
        unavailable(type, { commands: [...commands, faces, plate] }),
        type,
      ).toBeUndefined();
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
