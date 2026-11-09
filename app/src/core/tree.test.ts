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
    expect(find(tree, "left")!.detail).toBe("x == 0");
    expect(find(tree, "fixed")!.detail).toBe("left · x, y, z");
    expect(find(tree, "move")!.detail).toBe("right · x");
    expect(find(tree, "step_1")!.detail).toBe("move: 0 → 0.5 (5)");
    expect(find(tree, "job_1")!.detail).toBe("step_1 · curve move");
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
