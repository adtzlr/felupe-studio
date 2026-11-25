import { describe, expect, it } from "vitest";
import type { Command } from "./commands";
import type { Command as ResolvedCommand } from "./resolved";
import {
  fileNotes,
  generateChain,
  generateKey,
  generateSources,
  makeMeshes,
  MeshFiles,
  meshSource,
  meshStatus,
  sectionCellType,
} from "./meshfiles";
import { resolveCommands } from "./resolve";
import type { MeshInfo, SourceMesh } from "../worker/protocol";
import { viewportContent } from "../viewer/layers";

type MeshGenerate = Extract<Command, { command: "mesh.generate" }>;

const model = [
  { command: "parameter.add", name: "width", value: 2 },
  {
    command: "mesh.generate",
    name: "block",
    tool: "Cube",
    parameters: { a: [0, 0, 0], b: ["width", 1, 1], n: [3, 2, 2] },
  },
  {
    command: "mesh.generate",
    name: "edge",
    tool: "Line",
    parameters: { a: 0, b: "2 * width", n: 5 },
  },
  {
    command: "mesh.generate",
    name: "corner",
    tool: "Point",
    parameters: { a: 1 },
  },
  { command: "cellset.from_file", name: "all", mesh: "block" },
  {
    command: "material.add",
    name: "rubber",
    model: "NeoHooke",
    parameters: { mu: 1 },
  },
  {
    command: "section.add",
    name: "body",
    cellset: "all",
    material: "rubber",
    formulation: "u",
  },
] as Command[];

const surface = (points: number, triangles: number[], edges: number[]) => ({
  positions: new Float32Array(3 * points),
  triangles: new Uint32Array(triangles),
  edges: new Uint32Array(edges),
  owners: new Uint32Array(triangles.length / 3),
  cells: 1,
});

/** The worker: a summary like felupe_studio.meshes.generate, recording the calls. */
function tools(fail?: string) {
  const made: [unknown, string][] = [];
  const files = new MeshFiles(undefined, {
    generate: async (commands, name) => {
      made.push([commands, name]);
      const tool = (commands.at(-1) as MeshGenerate).tool;
      if (name === fail)
        return { info: { file: name, error: "ValueError: too few points" } };
      const dimensions: Record<string, MeshInfo["dimension"]> = {
        Cube: { points: 3, cells: 3, cell_type: "hexahedron" },
        Line: { points: 1, cells: 1, cell_type: "line" },
        Point: { points: 1, cells: 0, cell_type: "vertex" },
      };
      const dimension = dimensions[tool]!;
      const info: MeshInfo = { file: name, dimension, solids: [] };
      if (tool === "Cube")
        info.solids = [
          {
            cell_type: "hexahedron",
            cells: 1,
            bounds: [
              [0, 0, 0],
              [2, 1, 1],
            ],
            tags: [],
          },
        ];
      const surfaces = {
        [dimension.cell_type]:
          tool === "Cube"
            ? surface(3, [0, 1, 2], [0, 1])
            : surface(2, [], tool === "Line" ? [0, 1] : []),
      };
      return { info, surfaces };
    },
  });
  return { files, made };
}

const settle = async () => {
  for (let i = 0; i < 4; i++) await Promise.resolve();
};

describe("meshes made by tools (ADR 0019)", () => {
  it("are made once per chain with the values of their expressions", async () => {
    const { files, made } = tools();
    const edge = model[2] as MeshGenerate;
    expect(generateChain(edge, model)).toEqual([
      { ...edge, parameters: { a: 0, b: 4, n: 5 } },
    ]);
    // the same key with the commands and with their values
    const resolved = resolveCommands(model).commands as ResolvedCommand[];
    expect(generateKey(edge, resolved as Command[])).toBe(
      generateKey(edge, model),
    );
    makeMeshes(model, files);
    makeMeshes(model, files);
    expect(meshStatus(edge, model, files)).toEqual({ state: "reading" });
    await settle();
    expect(made.map(([, name]) => name)).toEqual(["block", "edge", "corner"]);
    expect(meshStatus(edge, model, files)?.state).toBe("ready");
    expect(sectionCellType(model, "body", files)).toBe("hexahedron");

    // a changed parameter makes the meshes that use it again
    const wider = model.map((c) =>
      c.name === "width" ? { ...c, value: 3 } : c,
    ) as Command[];
    makeMeshes(wider, files);
    await settle();
    expect(made.slice(3).map(([, name]) => name)).toEqual(["block", "edge"]);
  });

  it("take the meshes of their inputs, choices as they are", () => {
    const chain = [
      ...model,
      {
        command: "mesh.generate",
        name: "ring",
        tool: "revolve",
        inputs: ["edge"],
        parameters: { n: 5, phi: "45 * width", axis: "x" },
      },
    ] as Command[];
    const ring = chain.at(-1) as MeshGenerate;
    expect(generateChain(ring, chain).map((c) => c.parameters)).toEqual([
      { a: 0, b: 4, n: 5 },
      // the axis is a choice, not an expression
      { n: 5, phi: 90, axis: "x" },
    ]);
  });

  it("are drawn: the model meshes, and the construction meshes lighter", async () => {
    const { files } = tools();
    makeMeshes(model, files);
    await settle();
    const resolved = resolveCommands(model).commands as ResolvedCommand[];
    const content = viewportContent(resolved, files, new Set(), "mesh");
    expect(content.meshes.map((m) => m.name)).toEqual(["block"]);
    expect(content.construction.map((m) => [m.name, m.opacity])).toEqual([
      ["edge", 0.35],
    ]);
    expect(content.vertices).toHaveLength(1);
    expect(content.message).toBeUndefined();
    // hidden
    const hidden = viewportContent(resolved, files, new Set(["edge"]), "mesh");
    expect(hidden.construction).toEqual([]);
  });

  it("note an error of FElupe at the mesh", async () => {
    const { files } = tools("edge");
    makeMeshes(model, files);
    await settle();
    expect(fileNotes(model, files).get("edge")).toEqual([
      "Line: ValueError: too few points",
    ]);
    expect(fileNotes(model, files).has("block")).toBe(false);
  });
});

describe("meshes of files and scripts as inputs of the tools (#438)", () => {
  const half = [
    { command: "parameter.add", name: "factor", value: 2 },
    { command: "mesh.import", name: "half", file: "half.vtu", scale: "factor" },
    {
      command: "mesh.generate",
      name: "other",
      tool: "mirror",
      inputs: ["half"],
      parameters: { axis: "x", value: 3 },
    },
  ] as Command[];
  const other = half[2] as MeshGenerate;

  /** A file of solid cells of a type, and the worker of the tools. */
  function worker(cellType = "hexahedron") {
    const made: [string, readonly SourceMesh[]][] = [];
    const files = new MeshFiles(
      async (name) => ({
        info: {
          file: name,
          points: 8,
          solids: [
            {
              cell_type: cellType,
              cells: 1,
              bounds: [
                [0, 0, 0],
                [1.5, 1, 1],
              ],
              tags: [],
            },
          ],
        },
      }),
      {
        generate: async (_, name, sources) => {
          made.push([name, sources]);
          const dimension = { points: 3, cells: 3, cell_type: cellType };
          return { info: { file: name, dimension, solids: [] } };
        },
      },
    );
    return { files, made };
  }

  it("are made once the file is read, with the meshes it takes", async () => {
    const { files, made } = worker();
    expect(generateSources(other, half, files)).toBeUndefined();
    makeMeshes(half, files);
    expect(made).toEqual([]);
    expect(meshSource(other, half, files)).toBeUndefined();

    await files.add("half.vtu", new Uint8Array([1]));
    // the arguments of volume_cells() of the script, the scale of its expression
    const sources = [{ name: "half", file: "half.vtu", scale: 2, dim: 3 }];
    expect(generateSources(other, half, files)).toEqual(sources);
    expect(meshSource(other, half, files)).toEqual({
      type: "generate-mesh",
      commands: generateChain(other, half),
      name: "other",
      sources,
    });
    makeMeshes(half, files);
    await settle();
    expect(made).toEqual([["other", sources]]);
    expect(meshStatus(other, half, files)?.state).toBe("ready");

    // another scale is another mesh, and a new version of the file makes it again
    const scaled = half.map((c) =>
      c.name === "factor" ? { ...c, value: 3 } : c,
    ) as Command[];
    expect(generateKey(other, scaled)).not.toBe(generateKey(other, half));
    await files.add("half.vtu", new Uint8Array([2]));
    makeMeshes(half, files);
    await settle();
    expect(made.map(([name]) => name)).toEqual(["other", "other"]);
  });

  it("note an input whose read cells do not fit the tool, and make no mesh", async () => {
    const { files, made } = worker("tetra");
    const stack = [
      ...half,
      {
        command: "mesh.generate",
        name: "block",
        tool: "Cube",
        parameters: { a: [0, 0, 0], b: [1, 1, 1], n: [2, 2, 2] },
      },
      {
        command: "mesh.generate",
        name: "whole",
        tool: "stack",
        inputs: ["half", "block"],
        parameters: { decimals: 10 },
      },
    ] as Command[];
    await files.add("half.vtu", new Uint8Array([1]));
    makeMeshes(stack, files);
    await settle();
    expect(made.map(([name]) => name)).toEqual(["other", "block"]);
    expect(fileNotes(stack, files).get("whole")).toEqual([
      "stack needs meshes of the same cells and points: 'half' tetra cells with 3D points, 'block' hexahedron cells with 3D points.",
    ]);
  });

  it("are construction meshes of 2D cells in a 3D model, by their cell type", async () => {
    const made: string[] = [];
    const files = new MeshFiles(
      async (name) => ({
        info: {
          file: name,
          points: 3,
          solids: [
            {
              cell_type: "quad",
              cells: 1,
              bounds: [
                [0, 1, 0],
                [3, 2, 0],
              ],
              tags: [],
            },
          ],
        },
        surfaces: { quad: surface(3, [0, 1, 2], [0, 1]) },
      }),
      {
        generate: async (_, name) => {
          made.push(name);
          const dimension = { points: 3, cells: 3, cell_type: "hexahedron" };
          return { info: { file: name, dimension, solids: [] } };
        },
      },
    );
    const profile = {
      command: "mesh.import",
      name: "profile",
      file: "profile.vtu",
      cell_type: "quad",
    };
    const tube = {
      command: "mesh.generate",
      name: "tube",
      tool: "revolve",
      inputs: ["profile"],
      parameters: { n: 5, phi: 90, axis: "x" },
    };
    const commands = [profile, tube] as Command[];
    await files.add("profile.vtu", new Uint8Array([1]));
    expect(fileNotes(commands, files).size).toBe(0);
    expect(generateSources(tube as MeshGenerate, commands, files)).toEqual([
      { name: "profile", file: "profile.vtu", cell_type: "quad", dim: 3 },
    ]);
    makeMeshes(commands, files);
    await settle();
    expect(made).toEqual(["tube"]);
    // drawn like a construction mesh of the tools
    const content = viewportContent(
      commands as ResolvedCommand[],
      files,
      new Set(),
      "mesh",
    );
    expect(content.meshes).toEqual([]);
    expect(content.construction.map((m) => [m.name, m.opacity])).toEqual([
      ["profile", 0.35],
    ]);
    // without its cell type, a mesh of a 2D model
    const plain = [{ ...profile, cell_type: undefined }, tube] as Command[];
    expect(fileNotes(plain, files).get("profile")).toEqual([
      "The file 'profile.vtu' has quad cells, which are 2D cells: set the analysis of the settings to plane strain or axisymmetric, or take them as a construction mesh with the cell type quad, e.g. a profile to revolve.",
    ]);
    expect(generateSources(tube as MeshGenerate, plain, files)).toBeUndefined();
  });
});
