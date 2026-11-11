import { describe, expect, it } from "vitest";
import fixture from "../../../tests/data/two_sections.json";
import type { CheckReport } from "./checks";
import type { Command, CommandList } from "./commands";
import { deriveTree, type TreeNode } from "./tree";
import { validate } from "./validate";

const commands = (fixture as CommandList).commands;

const summary = (nodes: TreeNode[]) =>
  nodes.map((n) => [n.label, n.count, n.children.map((c) => c.label)]);

const find = (nodes: TreeNode[], id: string): TreeNode | undefined => {
  for (const node of nodes) {
    if (node.id === id) return node;
    const child = find(node.children, id);
    if (child) return child;
  }
  return undefined;
};

describe("deriveTree", () => {
  it("groups the objects", () => {
    expect(summary(deriveTree(commands))).toEqual([
      ["Meshes", 1, ["specimen"]],
      ["Point Sets", 2, ["left", "right"]],
      ["Materials", 2, ["umat_hard", "umat_soft"]],
      ["Sections", 2, ["section_hard", "section_soft"]],
      ["Boundaries", 2, ["fixed", "move"]],
      ["Steps", 1, ["step_1"]],
      ["Jobs", 1, ["job_1"]],
    ]);
  });

  it("puts cell sets below their mesh and describes the objects", () => {
    const tree = deriveTree(commands);
    const mesh = find(tree, "specimen")!;
    expect(mesh.detail).toBe("specimen.vtu · tag material");
    expect(mesh.children.map((c) => [c.label, c.detail])).toEqual([
      ["hard", "tag = 1"],
      ["soft", "tag = 2"],
    ]);
    expect(find(tree, "section_soft")!.detail).toBe("umat_soft · u-p-J");
    const log = commands.map((c) =>
      c.name === "section_soft" ? { ...c, volumetric: "log" } : c,
    ) as Command[];
    expect(find(deriveTree(log), "section_soft")!.detail).toBe(
      "umat_soft · u-p-J · log",
    );
    // the label of the material model of the registry
    expect(find(tree, "umat_soft")!.detail).toBe("Neo-Hooke");
    expect(find(tree, "left")!.detail).toBe("x == 0");
    expect(find(tree, "fixed")!.detail).toBe("left · x, y, z");
    expect(find(tree, "move")!.detail).toBe("right · x");
    expect(find(tree, "step_1")!.detail).toBe("move: 0 → 0.5 (5)");
    expect(find(tree, "job_1")!.detail).toBe("step_1 · curve move");
    const jobs = commands.map((c) =>
      c.command === "job.add"
        ? { ...c, curve: undefined, cutback: {}, tol: 0.05, maxiter: 30 }
        : c,
    );
    expect(find(deriveTree(jobs), "job_1")!.detail).toBe(
      "step_1 · cutback · tol 0.05 · maxiter 30",
    );
    // control points
    const control: Command = {
      command: "point.add",
      name: "control",
      coordinates: [4, 0.5, 0.5],
    };
    expect(find(deriveTree([...commands, control]), "control")!.detail).toBe(
      "control (4, 0.5, 0.5)",
    );
    // point sets by nodes
    const nodes = (points: number[][]) =>
      find(
        deriveTree(
          commands.map((c) =>
            c.name === "left" ? ({ ...c, select: { points } } as Command) : c,
          ),
        ),
        "left",
      )!.detail;
    expect(nodes([[0, 1, 2.5]])).toBe("node (0, 1, 2.5)");
    expect(
      nodes([
        [0, 0, 0],
        [1, 0, 0],
      ]),
    ).toBe("2 nodes");
  });

  it("shows the settings and the values with the units of the model (#132)", () => {
    const settings = {
      command: "model.settings",
      name: "settings",
      units: { length: "mm", force: "N" },
    } as Command;
    const tree = deriveTree([settings, ...commands]);
    expect(tree[0]).toMatchObject({ label: "Settings", count: 1 });
    expect(find(tree, "settings")!.detail).toBe("mm · N · MPa");
    expect(find(tree, "left")!.detail).toBe("x == 0 mm");
    expect(find(tree, "step_1")!.detail).toBe("move: 0 → 0.5 mm (5)");
    expect(find(tree, "fixed")!.detail).toBe("left · x, y, z");
    const load = {
      command: "load.add",
      name: "pull",
      points: "right",
      force: [1, 0, 0],
    } as Command;
    expect(find(deriveTree([settings, load]), "pull")!.detail).toBe(
      "right · (1, 0, 0) N",
    );
    // without units
    const plain = deriveTree([{ command: "model.settings", name: "s" }]);
    expect(find(plain, "s")!.detail).toBe("no units");
  });

  it("shows the merge group only with a merge command", () => {
    const merge: Command = {
      command: "mesh.merge",
      name: "merge",
      decimals: 6,
    };
    const tree = deriveTree([commands[0], merge, ...commands.slice(1)]);
    expect(find(tree, "group:merge")!.children[0].detail).toBe("decimals = 6");
  });

  it("lists the control points in a group of their own", () => {
    expect(find(deriveTree(commands), "group:point")).toBeUndefined();
    const control: Command = {
      command: "point.add",
      name: "control",
      coordinates: [4, 0.5, 0.5],
    };
    const tree = deriveTree([...commands, control]);
    const group = find(tree, "group:point")!;
    expect(group.label).toBe("Points");
    expect(group.children.map((c) => [c.label, c.kind, c.icon])).toEqual([
      ["control", "pointset", "point"],
    ]);
    // after the point sets
    const ids = tree.map((g) => g.id);
    expect(ids.indexOf("group:point")).toBe(ids.indexOf("group:pointset") + 1);
  });

  it("lists the constraints in a group of their own", () => {
    const control: Command = {
      command: "point.add",
      name: "plate",
      coordinates: [4, 0.5, 0.5],
    };
    const mpc: Command = {
      command: "mpc.add",
      name: "glue",
      points: "right",
      center: "plate",
      constrained: ["y", "x"],
      rotation: "turn",
    };
    const tree = deriveTree([...commands, control, mpc]);
    expect(find(tree, "group:constraint")!.label).toBe("Constraints");
    expect(find(tree, "glue")!.detail).toBe(
      "right → plate · x, y · rotation turn",
    );
    expect(
      find(
        deriveTree([
          ...commands,
          control,
          {
            ...mpc,
            constrained: ["x", "y", "z"],
            rotation: undefined,
          } as Command,
        ]),
        "glue",
      )!.detail,
    ).toBe("right → plate");
    expect(find(deriveTree(commands), "group:constraint")).toBeUndefined();
  });

  it("lists the point loads in a group of their own", () => {
    const load: Command = {
      command: "load.add",
      name: "pull",
      points: "right",
      force: [0, 0, -10],
    };
    const tree = deriveTree([...commands, load]);
    expect(find(tree, "group:load")!.label).toBe("Loads");
    expect(find(tree, "pull")!.detail).toBe("right · (0, 0, -10)");
  });

  it("attaches validation issues", () => {
    const broken = commands.map((c) =>
      c.name === "section_hard" ? { ...c, material: "missing" } : c,
    ) as Command[];
    const tree = deriveTree(broken, validate(broken));
    expect(find(tree, "section_hard")!.issues).toEqual([
      "commands/5: section.add 'section_hard' references unknown material 'missing' in 'material'.",
    ]);
    expect(find(tree, "section_soft")!.issues).toEqual([]);
  });

  it("attaches the check report", () => {
    const report: CheckReport = {
      ok: false,
      messages: [],
      cells: {
        total: 192,
        unassigned: [{ mesh: "specimen", cells: 4 }],
        multiple: [{ mesh: "specimen", cells: 2, sections: ["section_hard"] }],
      },
      interfaces: [
        { sections: ["section_hard", "section_soft"], shared: 25, hanging: 3 },
      ],
    };
    const tree = deriveTree(commands, [], report);
    expect(find(tree, "specimen")!.issues).toEqual([
      "4 cells are not assigned to a section.",
    ]);
    expect(find(tree, "section_hard")!.issues).toEqual([
      "2 cells of mesh 'specimen' are in more than one section.",
      "3 hanging points at the interface to 'section_soft'.",
    ]);
    expect(find(tree, "section_soft")!.issues).toEqual([
      "3 hanging points at the interface to 'section_hard'.",
    ]);
  });
});
