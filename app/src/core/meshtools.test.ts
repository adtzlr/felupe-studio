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
      ["Circle", "Primitives", "fem.Circle"],
      ["Triangle", "Primitives", "fem.mesh.Triangle"],
      ["expand", "Operations", ".expand"],
      ["revolve", "Operations", ".revolve"],
      ["embed", "Operations", "embed"],
      ["translate", "Operations", ".translate"],
      ["rotate", "Operations", ".rotate"],
      ["mirror", "Operations", ".mirror"],
      ["fill_between", "Operations", "fem.mesh.fill_between"],
      ["add_runouts", "Operations", ".add_runouts"],
      ["stack", "Operations", "fem.MeshContainer"],
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

  it("need the corners of a triangle counterclockwise, like Python (#394)", () => {
    const triangle = (b: number[], c: number[]) =>
      toolProblems(made("Triangle", { a: [0, 0], b, c, n: 2 }));
    expect(triangle([1, 0], [0, 1])).toEqual([]);
    expect(triangle([0, 1], [1, 0])).toEqual([
      "a, b and c go around clockwise; swap b and c.",
    ]);
    expect(triangle([1, 1], [2, 2])).toEqual(["a, b and c lie on a line."]);
    expect(triangle([0, 0], [0, 0])).toEqual(["a, b and c lie on a line."]);
  });

  it("need quarters of a circle that do not overlap, like Python (#394)", () => {
    const circle = (sections: number[]) =>
      toolProblems(
        made("Circle", { radius: 1, centerpoint: [0, 0], sections }),
      );
    expect(circle([0])).toEqual([]);
    expect(circle([0, 90, 180, 270])).toEqual([]);
    // a turn further is the same quarter
    expect(circle([-90, 0, 90, 180])).toEqual([]);
    expect(circle([90, 450])).toEqual([
      "sections 90 and 450 overlap: the quarters need 90 degrees between them.",
    ]);
    expect(circle([0, 270, 300.5])).toEqual([
      "sections 0 and 300.5 overlap: the quarters need 90 degrees between them.",
    ]);
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
    // a tool of one value of n: its defaults, not the lists of the cube
    const line = setValue("mesh.generate", draft, ["tool"], "Line", context);
    expect(line.parameters).toEqual({ a: 0, b: 1, n: 2 });
    const expand = setValue(
      "mesh.generate",
      draft,
      ["tool"],
      "expand",
      context,
    );
    expect(expand.parameters).toEqual({ n: 11, z: 1 });
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

  it("have a form of a circle and a triangle (#394)", () => {
    const context = { commands: [] };
    const draft = initialDraft("mesh.generate", context);
    const circle = setValue(
      "mesh.generate",
      draft,
      ["tool"],
      "Circle",
      context,
    );
    // the defaults of FElupe: a full circle
    expect(circle.parameters).toEqual({
      radius: 1,
      centerpoint: [0, 0],
      n: 2,
      sections: [0, 90, 180, 270],
    });
    const specs = fieldSpecs("mesh.generate", circle);
    expect(specs.map((s) => s.key)).toEqual([
      "name",
      "tool",
      "parameters.radius",
      "parameters.centerpoint",
      "parameters.n",
      "parameters.sections",
      "color",
    ]);
    // one to four start angles, which may be expressions
    expect(
      specs.find((s) => s.key === "parameters.sections")!.input,
    ).toMatchObject({
      type: "numbers",
      minItems: 1,
      maxItems: 4,
      expressions: true,
    });
    const errors = (sections: unknown[]) =>
      draftErrors(
        "mesh.generate",
        {
          ...circle,
          name: "disc",
          parameters: { ...(circle.parameters as object), sections },
        },
        context,
      )["parameters.sections"];
    expect(errors([0])).toBeUndefined();
    expect(errors([0, 90, 180, 270, 360])).toBeDefined();
    const triangle = setValue(
      "mesh.generate",
      draft,
      ["tool"],
      "Triangle",
      context,
    );
    expect(triangle.parameters).toEqual({
      a: [0, 0],
      b: [1, 0],
      c: [0, 1],
      n: 2,
    });
  });

  it("are described in the browser", () => {
    const tree = deriveTree([
      made("Cube", { a: [0, 0, 0], b: [1, 1, 1], n: [3, 3, 2] }, "block"),
      made("Point", { a: 0 }, "corner"),
      made(
        "Circle",
        { radius: 1, centerpoint: [0, 0], n: 4, sections: [0] },
        "disc",
      ),
    ]);
    const meshes = tree.find((g) => g.id === "group:mesh")!.children;
    expect(meshes.map((m) => [m.label, m.detail])).toEqual([
      ["block", "Cube · n = 3 × 3 × 2"],
      // a point is a construction mesh of a 3D model
      ["corner", "Point · construction"],
      // a circle too, with its 2D points (#394)
      ["disc", "Circle · n = 4 · construction"],
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

describe("a stack of meshes (#394)", () => {
  const rectangle = (name: string, x: number) =>
    made("Rectangle", { a: [x, 1], b: [x + 1, 2], n: [3, 3] }, name);
  const pieces = [
    rectangle("left", 0),
    rectangle("middle", 1),
    rectangle("right", 2),
  ];
  const stack = (inputs: string[], name = "profile") =>
    ({ ...made("stack", { decimals: 10 }, name), inputs }) as MeshGenerate;
  const revolved = {
    ...made("revolve", { n: 5, phi: 90, axis: "x" }, "body"),
    inputs: ["profile"],
  } as MeshGenerate;

  it("has the dimensions of its meshes, which have the same cells and points", () => {
    const profile = stack(["left", "middle", "right"]);
    const known = dimensions([...pieces, profile, revolved]);
    expect(known.get("profile")).toEqual({
      points: 2,
      cells: 2,
      cell_type: "quad",
    });
    expect(known.get("body")?.cell_type).toBe("hexahedron");
    expect(inputProblems(profile, known)).toEqual([]);
    const block = made(
      "Cube",
      { a: [0, 0, 0], b: [1, 1, 1], n: [2, 2, 2] },
      "block",
    );
    const mixed = stack(["left", "block"]);
    const all = dimensions([...pieces, block, mixed]);
    expect(all.has("profile")).toBe(false);
    expect(inputProblems(mixed, all)).toEqual([
      "stack needs meshes of the same cells and points: 'left' quad cells with 2D points, 'block' hexahedron cells with 3D points.",
    ]);
  });

  it("has a form of checkboxes, its meshes those that no other tool takes", () => {
    const used = {
      ...made("expand", { n: 2, z: 1 }, "slab"),
      inputs: ["left"],
    };
    const context = { commands: [...pieces, used] as Command[] };
    const draft = initialDraft("mesh.generate", context);
    const form = setValue("mesh.generate", draft, ["tool"], "stack", context);
    expect(form.inputs).toEqual(["middle", "right", "slab"]);
    expect(form.parameters).toEqual({ decimals: 10 });
    const specs = fieldSpecs("mesh.generate", form);
    expect(specs.map((s) => s.key)).toEqual([
      "name",
      "tool",
      "inputs",
      "parameters.decimals",
      "color",
    ]);
    // two or more meshes, each once: a checkbox per mesh
    const inputs = specs.find((s) => s.key === "inputs")!.input;
    expect(inputs).toEqual({
      type: "reference",
      kind: "mesh",
      multiple: true,
      minItems: 2,
    });
    const errors = (meshes: string[]) =>
      draftErrors(
        "mesh.generate",
        { ...form, name: "profile", inputs: meshes },
        context,
      ).inputs;
    expect(errors(["left", "middle"])).toBeUndefined();
    expect(errors(["left"])).toBe("Select at least two.");
    expect(errors(["left", "left"])).toBe("Each object may appear only once.");
  });

  it("is taken by the next operation, as the latest mesh that no tool takes", () => {
    // an operation of one mesh takes one, not all meshes made before
    const commands = [...pieces, stack(["left", "middle", "right"])];
    const context = { commands: commands as Command[] };
    const draft = initialDraft("mesh.generate", context);
    const form = setValue("mesh.generate", draft, ["tool"], "revolve", context);
    expect(form.inputs).toEqual(["profile"]);
    const between = setValue("mesh.generate", draft, ["tool"], "fill_between", {
      commands: pieces as Command[],
    });
    expect(between.inputs).toEqual(["middle", "right"]);
    expect(
      draftErrors(
        "mesh.generate",
        { ...form, name: "body", inputs: ["left", "middle"] },
        context,
      ).inputs,
    ).toBe("Select at most one.");
  });

  it("shows its meshes below it in the browser", () => {
    const tree = deriveTree([...pieces, stack(["left", "middle", "right"])]);
    const [mesh] = tree.find((g) => g.id === "group:mesh")!.children;
    expect([mesh.label, mesh.detail]).toEqual([
      "profile",
      "stack left, middle, right · construction",
    ]);
    expect(mesh.children.map((c) => c.label)).toEqual([
      "left",
      "middle",
      "right",
    ]);
  });
});
