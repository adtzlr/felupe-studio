import { describe, expect, it } from "vitest";
import type { Command } from "../core/resolved";
import { MeshFiles } from "../core/meshfiles";
import type { MeshSurface } from "../worker/protocol";
import {
  automaticColor,
  cellMask,
  defaultColorBy,
  scaledSurface,
  viewportContent,
} from "./layers";
import { CATEGORICAL, OTHER, UNASSIGNED } from "./palette";
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

describe("scale of a mesh (#135)", () => {
  it("multiplies the positions and the nodes, once per scale", () => {
    const withNodes = { ...surface, nodes: new Float64Array([1, 2, 3]) };
    expect(scaledSurface(withNodes, undefined)).toBe(withNodes);
    expect(scaledSurface(withNodes, 1)).toBe(withNodes);
    const scaled = scaledSurface(withNodes, 1000);
    expect([...scaled.positions.slice(3, 6)]).toEqual([1000, 0, 0]);
    expect([...scaled.nodes!]).toEqual([1000, 2000, 3000]);
    expect(scaled.triangles).toBe(withNodes.triangles);
    // the original is unchanged, the scaled surface is the same object again
    expect([...withNodes.positions.slice(3, 6)]).toEqual([1, 0, 0]);
    expect(scaledSurface(withNodes, 1000)).toBe(scaled);
    expect(scaledSurface(withNodes, 0.001)).not.toBe(scaled);
  });

  it("is applied to the meshes of the viewport", async () => {
    const files = await loaded();
    const scaled = [{ ...model[0], scale: 10 } as Command, ...model.slice(1)];
    const content = viewportContent(scaled, files, new Set());
    expect([...content.meshes[0].surface.positions.slice(3, 6)]).toEqual([
      10, 0, 0,
    ]);
  });
});

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

  // an own color of a cell set or a section (#376), like that of a mesh (#336)
  const colored = (colors: Record<string, string>) =>
    model.map((c) =>
      c.name in colors ? ({ ...c, color: colors[c.name] } as Command) : c,
    );

  it("colors a section in its own color", async () => {
    const files = await loaded();
    const own = colored({ body: "#2b2d42" });
    const content = viewportContent(own, files, new Set(), "section");
    expect(content.meshes[0].groups).toEqual([
      { color: "#2b2d42", cells: [1, 2] },
    ]);
    // the legend, and so the pictures of the view, take it
    expect(content.legend).toEqual([
      { label: "body", color: "#2b2d42" },
      { label: "No section", color: UNASSIGNED },
    ]);
    // the own color of the cell set of the section is not that of the section
    const set = viewportContent(
      colored({ right: "#7f8c8d" }),
      files,
      new Set(),
      "section",
    );
    expect(set.legend![0]).toEqual({ label: "body", color: CATEGORICAL[0] });
  });

  it("colors a cell set in its own color, the others by their position", async () => {
    const files = await loaded();
    const own = colored({ right: "#7f8c8d", everything: "#2B2D42" });
    const content = viewportContent(own, files, new Set(), "cellset");
    expect(content.meshes[0].groups!.map((g) => g.color)).toEqual([
      CATEGORICAL[0],
      "#7f8c8d",
      "#2B2D42",
    ]);
    // a hidden cell set keeps the colors of the others
    const hidden = viewportContent(own, files, new Set(["left"]), "cellset");
    expect(hidden.legend).toEqual([
      { label: "right", color: "#7f8c8d" },
      { label: "everything", color: "#2B2D42" },
    ]);
    const shown = viewportContent(
      colored({ left: "#7f8c8d" }),
      files,
      new Set(["right"]),
      "cellset",
    );
    expect(shown.legend).toEqual([
      { label: "left", color: "#7f8c8d" },
      { label: "everything", color: CATEGORICAL[2] },
    ]);
    // the meshes are colored by meshes, without the colors of the cell sets
    const meshes = viewportContent(own, files, new Set(), "mesh");
    expect(meshes.meshes[0]).toMatchObject({ color: CATEGORICAL[0] });
  });

  it("names the automatic color of each kind by its position", () => {
    expect(automaticColor(model, "mesh.import", "bar")).toBe(CATEGORICAL[0]);
    // the two kinds of cell sets are one list
    expect(automaticColor(model, "cellset.from_tag", "right")).toBe(
      CATEGORICAL[1],
    );
    expect(automaticColor(model, "cellset.from_file", "everything")).toBe(
      CATEGORICAL[2],
    );
    expect(automaticColor(model, "section.add", "body")).toBe(CATEGORICAL[0]);
    // a new one is the last one; the ninth and further are gray
    expect(automaticColor(model, "cellset.from_file")).toBe(CATEGORICAL[3]);
    expect(automaticColor(model, "section.add")).toBe(CATEGORICAL[1]);
    const many = Array.from({ length: 8 }, (_, i) => ({
      command: "section.add",
      name: `s${i}`,
    }));
    expect(automaticColor(many, "section.add")).toBe(OTHER);
    // other commands have none
    expect(automaticColor(model, "material.add", "rubber")).toBeUndefined();
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
