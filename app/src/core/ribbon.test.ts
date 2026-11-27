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
        "Stack",
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
    // one button per formulation of the registry (ADR 0024), with its menu
    expect(
      ribbonGroups("sections")[0].map((i) => [i.id, i.preset, i.group]),
    ).toEqual([
      ["section.add:u", { formulation: "u" }, "Displacement"],
      ["section.add:u-p-J", { formulation: "u-p-J" }, "Nearly incompressible"],
      [
        "section.add:u-p-J-condensed",
        { formulation: "u-p-J-condensed" },
        "Nearly incompressible",
      ],
      [
        "section.add:u-p-J-mixed",
        { formulation: "u-p-J-mixed" },
        "Nearly incompressible",
      ],
      [
        "section.add:u-p-J-three-field",
        { formulation: "u-p-J-three-field" },
        "Nearly incompressible",
      ],
      [
        "section.add:u-isochoric",
        { formulation: "u-isochoric" },
        "Third medium",
      ],
    ]);
    // the ways of u-p-J in the menu Nearly incompressible (#420)
    expect(
      ribbonEntries(ribbonGroups("sections")[0]).map((e) =>
        e.kind === "menu" ? `${e.group} ▾` : e.item.label,
      ),
    ).toEqual([
      "Displacement (u)",
      "Nearly incompressible ▾",
      "Isochoric part only (third medium)",
    ]);
    expect(labels("sections")).toEqual([
      [
        "Displacement (u)",
        "Automatic",
        "Condensed per cell",
        "Mixed fields",
        "Three-field variation",
        "Isochoric part only (third medium)",
      ],
    ]);
    expect(labels("loads")).toEqual([
      ["Boundary"],
      ["Uniaxial", "Biaxial", "Planar", "Shear"],
      ["Symmetry"],
      ["Control point"],
      ["Rigid surface"],
      // three commands in the menu Constraints (#454)
      [
        "Multi-point constraint",
        "Cartesian constraint",
        "Cylindrical constraint",
      ],
      // the contacts with rigid surfaces and between bodies (#462)
      ["Rigid surface contact", "Contact between bodies"],
      ["Point load"],
      ["Pressure"],
    ]);
    // the menus Load case of the variants of x-group, and Constraints of the
    // commands of a menu of the registry (#454)
    const loads = ribbonGroups("loads");
    expect(loads[1].map((i) => [i.id, i.group])).toEqual([
      ["loadcase.add:uniaxial", "Load case"],
      ["loadcase.add:biaxial", "Load case"],
      ["loadcase.add:planar", "Load case"],
      ["loadcase.add:shear", "Load case"],
    ]);
    expect(loads[5].map((i) => [i.id, i.preset, i.group])).toEqual([
      ["mpc.add", {}, "Constraints"],
      ["cartesian.add", {}, "Constraints"],
      ["cylindrical.add", {}, "Constraints"],
    ]);
    expect(loads[6].map((i) => [i.id, i.group])).toEqual([
      ["contact.add", "Contact"],
      ["bodycontact.add", "Contact"],
    ]);
    expect(
      loads.flatMap((group) =>
        ribbonEntries(group).map((e) =>
          e.kind === "menu" ? `${e.group} ▾` : e.item.label,
        ),
      ),
    ).toEqual([
      "Boundary",
      "Load case ▾",
      "Symmetry",
      "Control point",
      "Rigid surface",
      "Constraints ▾",
      "Contact ▾",
      "Point load",
      "Pressure",
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
    // the commands of a menu of the registry are one group, e.g. the constraints
    const types = tabs.flatMap((tab) =>
      ribbonGroups(tab).flatMap((group) => [
        ...new Set(group.map((item) => item.type)),
      ]),
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

  it("offers no cylindrical constraint in an axisymmetric model (#422)", () => {
    const settings = (analysis: string) =>
      ({ command: "model.settings", name: "settings", analysis }) as Command;
    expect(
      unavailable("cylindrical.add", {
        commands: [settings("axisymmetric"), ...commands],
      }),
    ).toBe(
      "An axisymmetric model has no direction around its axis: a boundary holds or moves its points radially (y) or axially (x).",
    );
    expect(
      unavailable("cylindrical.add", {
        commands: [settings("plane-strain"), ...commands],
      }),
    ).toBeUndefined();
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
