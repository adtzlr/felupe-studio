import { describe, expect, it } from "vitest";
import type { Command } from "../core/commands";
import { MeshFiles } from "../core/meshfiles";
import type { MeshSurface } from "../worker/protocol";
import { cellMask, defaultColorBy, viewportContent } from "./layers";
import { CATEGORICAL, UNASSIGNED } from "./palette";
import { meshObjects } from "./scene";

/** Three cells in two regions of the tag material, each region with own points. */
const surface: MeshSurface = {
  positions: new Float32Array([
    ...[0, 0, 0, 1, 0, 0, 0, 1, 0],
    ...[1, 0, 0, 2, 0, 0, 1, 1, 0],
  ]),
  triangles: new Uint32Array([0, 1, 2, 3, 4, 5, 3, 5, 4]),
  edges: new Uint32Array([0, 1, 1, 2, 3, 4, 4, 5]),
  owners: new Uint32Array([0, 1, 2]),
  tags: { material: new Int32Array([1, 2, 2]) },
  cells: 3,
};

async function loaded() {
  const files = new MeshFiles(async (name) => ({
    info: {
      file: name,
      solids: [
        {
          cell_type: "tetra",
          cells: 3,
          bounds: [
            [0, 0, 0],
            [2, 1, 0],
          ],
          tags: [],
        },
      ],
    },
    surfaces: { tetra: surface },
  }));
  await files.add("bar.vtu", new Uint8Array());
  return files;
}

const model: Command[] = [
  { command: "mesh.import", name: "bar", file: "bar.vtu", tag: "material" },
  { command: "cellset.from_tag", name: "left", mesh: "bar", value: 1 },
  { command: "cellset.from_tag", name: "right", mesh: "bar", value: 2 },
  { command: "cellset.from_file", name: "everything", mesh: "bar" },
  {
    command: "material.add",
    name: "rubber",
    model: "NeoHookeCompressible",
    parameters: { mu: 1, lmbda: 2 },
  },
  {
    command: "section.add",
    name: "body",
    cellset: "right",
    material: "rubber",
    formulation: "u",
  },
];

describe("color by", () => {
  it("defaults to sections, cell sets or meshes", () => {
    expect(defaultColorBy(model)).toBe("section");
    expect(defaultColorBy(model.slice(0, 2))).toBe("cellset");
    expect(defaultColorBy(model.slice(0, 1))).toBe("mesh");
  });

  it("takes the cells of a cell set from the tag values", () => {
    const mesh = model[0] as Extract<Command, { command: "mesh.import" }>;
    const left = model[1] as Extract<Command, { command: "cellset.from_tag" }>;
    const all = model[3] as Extract<Command, { command: "cellset.from_file" }>;
    expect([...cellMask(left, mesh, surface)!]).toEqual([1, 0, 0]);
    expect([...cellMask(all, mesh, surface)!]).toEqual([1, 1, 1]);
    // without the tag values, the cells are unknown
    expect(cellMask(left, mesh, { ...surface, tags: {} })).toBeUndefined();
  });

  it("colors the sections and names the cells without a section", async () => {
    const files = await loaded();
    const content = viewportContent(model, files, new Set(), "section");
    const [layer] = content.meshes;
    expect(layer.color).toBe(UNASSIGNED);
    expect(layer.groups).toEqual([{ color: CATEGORICAL[0], cells: [1, 2] }]);
    expect(content.legend).toEqual([
      { label: "body", color: CATEGORICAL[0] },
      { label: "No section", color: UNASSIGNED },
    ]);
    const objects = meshObjects(layer);
    expect(objects.map((o) => [o.color, o.triangles!.size])).toEqual([
      [UNASSIGNED, 3],
      [CATEGORICAL[0], 6],
    ]);
  });

  it("colors the cell sets by their position in the model", async () => {
    const files = await loaded();
    const content = viewportContent(model, files, new Set(), "cellset");
    // later cell sets win: everything covers left and right
    expect(content.meshes[0].groups!.map((g) => g.color)).toEqual(
      CATEGORICAL.slice(0, 3),
    );
    expect(content.legend!.map((e) => e.label)).toEqual([
      "left",
      "right",
      "everything",
    ]);
  });

  it("names the meshes by color with meshes", async () => {
    const files = await loaded();
    const content = viewportContent(model, files, new Set(), "mesh");
    expect(content.meshes[0]).toMatchObject({ color: CATEGORICAL[0] });
    expect(content.meshes[0].groups).toBeUndefined();
    expect(content.legend).toBeUndefined();
  });
});

describe("visibility", () => {
  it("hides the cells of hidden sections and cell sets", async () => {
    const files = await loaded();
    const content = viewportContent(model, files, new Set(["body"]), "section");
    const [layer] = content.meshes;
    expect(Array.from(layer.hidden!)).toEqual([0, 1, 1]);
    expect(content.legend).toEqual([
      { label: "No section", color: UNASSIGNED },
    ]);
    // the triangles and the edges of the hidden region are left out
    const [object] = meshObjects(layer);
    expect([...(object.triangles!.data as Uint32Array)]).toEqual([0, 1, 2]);
    expect([...(object.edges!.data as Uint32Array)]).toEqual([0, 1, 1, 2]);

    const left = viewportContent(model, files, new Set(["left"]), "cellset");
    expect(Array.from(left.meshes[0].hidden!)).toEqual([1, 0, 0]);
    expect(left.legend!.map((e) => e.label)).toEqual(["right", "everything"]);
  });

  it("draws nothing of a fully hidden mesh", async () => {
    const files = await loaded();
    const content = viewportContent(model, files, new Set(["everything"]));
    expect(meshObjects(content.meshes[0])).toEqual([]);
    expect(content.legend).toEqual([]);
  });
});
