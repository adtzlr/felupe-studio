import { describe, expect, it } from "vitest";
import { deriveTree } from "./tree";
import { draftErrors, fieldSpecs, initialDraft, setValue } from "./form";
import {
  MESH_TOOLS,
  dimensions,
  hiddenObjects,
  inputProblems,
  modelMesh,
  toolProblems,
} from "./meshtools";
import type { Command } from "./resolved";

type MeshGenerate = Extract<Command, { command: "mesh.generate" }>;

const made = (
  tool: string,
  parameters: Record<string, unknown>,
  name = "mesh",
): MeshGenerate =>
  ({ command: "mesh.generate", name, tool, parameters }) as MeshGenerate;

describe("the mesh tools (ADR 0019)", () => {
  it("are the registry of the schema", () => {
    expect(MESH_TOOLS.map((t) => [t.name, t.group, t.felupe])).toEqual([
      ["Point", "Primitives", "fem.mesh.Point"],
      ["Line", "Primitives", "fem.mesh.Line"],
      ["Rectangle", "Primitives", "fem.Rectangle"],
      ["Cube", "Primitives", "fem.Cube"],
      ["expand", "Operations", ".expand"],
      ["revolve", "Operations", ".revolve"],
      ["embed", "Operations", "embed"],
      ["translate", "Operations", ".translate"],
      ["rotate", "Operations", ".rotate"],
      ["mirror", "Operations", ".mirror"],
      ["fill_between", "Operations", "fem.mesh.fill_between"],
      ["add_runouts", "Operations", ".add_runouts"],
    ]);
  });

  it("know the dimensions of their meshes from the commands, like Python", () => {
    const meshes = dimensions([
      made("Point", { a: 0 }, "p"),
      made("Line", { a: 0, b: 1, n: 3 }, "l"),
      made("Rectangle", { a: [0, 0], b: [1, 1], n: [2, 2] }, "r"),
      made("Cube", { a: [0, 0, 0], b: [1, 1, 1], n: [2, 2, 2] }, "c"),
      { command: "mesh.import", name: "file" },
    ]);
    expect(Object.fromEntries(meshes)).toEqual({
      p: { points: 1, cells: 0, cell_type: "vertex" },
      l: { points: 1, cells: 1, cell_type: "line" },
      r: { points: 2, cells: 2, cell_type: "quad" },
      c: { points: 3, cells: 3, cell_type: "hexahedron" },
    });
    expect(modelMesh(meshes.get("c")!, 3)).toBe(true);
    expect(modelMesh(meshes.get("r")!, 3)).toBe(false);
    expect(modelMesh(meshes.get("r")!, 2)).toBe(true);
  });

  it("need b larger than a, like Python", () => {
    expect(toolProblems(made("Cube", { a: [0, 0, 0], b: [1, 1, 1] }))).toEqual(
      [],
    );
    expect(toolProblems(made("Cube", { a: [0, 2, 0], b: [1, 1, 0] }))).toEqual([
      "b must be larger than a in y and z.",
    ]);
    expect(toolProblems(made("Line", { a: 1, b: 0 }))).toEqual([
      "b must be larger than a.",
    ]);
    expect(toolProblems(made("Point", { a: 1 }))).toEqual([]);
  });

  it("have a form from the schema, a vector per corner and points per axis", () => {
    const context = { commands: [] };
    const draft = initialDraft("mesh.generate", context);
    expect(draft).toMatchObject({
      tool: "Cube",
      parameters: { a: [0, 0, 0], b: [1, 1, 1], n: [2, 2, 2] },
    });
    const specs = fieldSpecs("mesh.generate", draft);
    expect(specs.map((s) => [s.key, s.label])).toEqual([
      ["name", "Name"],
      ["tool", "Tool"],
      ["parameters.a", "a"],
      ["parameters.b", "b"],
      ["parameters.n", "n"],
      ["color", "Color"],
    ]);
    const n = specs.find((s) => s.key === "parameters.n")!;
    expect(n.input).toMatchObject({
      type: "numbers",
      minItems: 3,
      maxItems: 3,
      integer: true,
      min: 2,
      expressions: true,
    });
    // a rectangle: two components each
    const rectangle = setValue(
      "mesh.generate",
      draft,
      ["tool"],
      "Rectangle",
      context,
    );
    expect(rectangle.parameters).toEqual({ a: [0, 0], b: [1, 1], n: [2, 2] });
    // whole numbers of at least 2 points per axis
    const errors = (n: unknown[]) =>
      draftErrors(
        "mesh.generate",
        {
          ...draft,
          name: "block",
          parameters: { ...(draft.parameters as object), n },
        },
        context,
      )["parameters.n"];
    expect(errors([3, 3, 3])).toBeUndefined();
    expect(errors([3, 2.5, 3])).toBe("Enter whole numbers.");
    expect(errors([3, 1, 3])).toBe("Enter numbers of at least 2.");
  });

  it("are described in the browser", () => {
    const tree = deriveTree([
      made("Cube", { a: [0, 0, 0], b: [1, 1, 1], n: [3, 3, 2] }, "block"),
      made("Point", { a: 0 }, "corner"),
    ]);
    const meshes = tree.find((g) => g.id === "group:mesh")!.children;
    expect(meshes.map((m) => [m.label, m.detail])).toEqual([
      ["block", "Cube · n = 3 × 3 × 2"],
      // a point is a construction mesh of a 3D model
      ["corner", "Point · construction"],
    ]);
  });
});

describe("the operations of the mesh tools (ADR 0019)", () => {
  const face = made("Rectangle", { a: [0, 0], b: [1, 1], n: [3, 2] }, "face");
  const block = {
    ...made("expand", { n: 3, z: 1 }, "block"),
    inputs: ["face"],
  } as MeshGenerate;

  it("know the dimensions of their meshes from their inputs, like Python", () => {
    const meshes = dimensions([face, block]);
    expect(meshes.get("block")).toEqual({
      points: 3,
      cells: 3,
      cell_type: "hexahedron",
    });
    const twice = {
      ...block,
      name: "twice",
      inputs: ["block"],
    } as MeshGenerate;
    expect(dimensions([face, block, twice]).has("twice")).toBe(false);
    expect(inputProblems(twice, meshes)).toEqual([
      "expand needs a mesh of vertex, line or quad cells; 'block' has hexahedron cells.",
    ]);
  });

  it("are shown below the mesh that uses them, hidden by default", () => {
    const tree = deriveTree([face, block]);
    const [mesh] = tree.find((g) => g.id === "group:mesh")!.children;
    expect([mesh.label, mesh.detail]).toEqual(["block", "expand face · n = 3"]);
    expect(mesh.children.map((c) => [c.label, c.detail])).toEqual([
      ["face", "Rectangle · n = 3 × 2 · construction"],
    ]);
    expect([...hiddenObjects([face, block], new Set())]).toEqual(["face"]);
    // shown by the user, and another object hidden
    expect([
      ...hiddenObjects([face, block], new Set(["face", "block"])),
    ]).toEqual(["block"]);
  });
});
