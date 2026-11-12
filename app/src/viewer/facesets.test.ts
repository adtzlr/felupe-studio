import { describe, expect, it } from "vitest";
import type { Command } from "../core/commands";
import { MeshFiles } from "../core/meshfiles";
import type { MeshSurface } from "../worker/protocol";
import {
  faceSetName,
  faceTriangles,
  missingCenters,
  sectionFaces,
  selectedFaces,
} from "./facesets";
import { scaledSurface } from "./layers";
import { FORCE_COLOR } from "./palette";
import { pressureLines } from "./pressures";

// the faces of a unit cube as quads of its corners (outward)
const QUADS = [
  [0, 3, 2, 1], // z = 0
  [4, 5, 6, 7], // z = 1
  [0, 1, 5, 4], // y = 0
  [2, 3, 7, 6], // y = 1
  [0, 4, 7, 3], // x = 0
  [1, 2, 6, 5], // x = 1
];

/**
 * The surface of two unit cubes side by side in x (cells 0 and 1, tags 1 and 2),
 * triangulated region by region like `felupe_studio.scene.surface()`: the
 * interface is a face of both regions.
 */
function surface(): MeshSurface {
  const positions: number[] = [];
  const triangles: number[] = [];
  const faces: number[] = [];
  const owners: number[] = [];
  for (const cell of [0, 1]) {
    const first = positions.length / 3;
    for (const z of [0, 1])
      for (const [x, y] of [
        [0, 0],
        [1, 0],
        [1, 1],
        [0, 1],
      ])
        positions.push(x + cell, y, z);
    QUADS.forEach(([a, b, c, d], f) => {
      triangles.push(first + a, first + b, first + c);
      triangles.push(first + a, first + c, first + d);
      faces.push(6 * cell + f, 6 * cell + f);
      owners.push(cell, cell);
    });
  }
  const nodes: number[] = [];
  for (const z of [0, 1])
    for (const y of [0, 1]) for (const x of [0, 1, 2]) nodes.push(x, y, z);
  return {
    positions: Float32Array.from(positions),
    triangles: Uint32Array.from(triangles),
    faces: Uint32Array.from(faces),
    edges: new Uint32Array(),
    owners: Uint32Array.from(owners),
    tags: { material: Int32Array.from([1, 2]) },
    nodes: Float64Array.from(nodes),
    cells: 2,
  };
}

async function model(scale?: number) {
  const files = new MeshFiles(async (name) => ({
    info: {
      file: name,
      points: 12,
      solids: [
        {
          cell_type: "hexahedron",
          cells: 2,
          bounds: [
            [0, 0, 0],
            [2, 1, 1],
          ],
          tags: [],
        },
      ],
    },
    surfaces: { hexahedron: surface() },
  }));
  await files.add("block.vtu", new Uint8Array([1]));
  const commands = [
    {
      command: "mesh.import",
      name: "block",
      file: "block.vtu",
      tag: "material",
      ...(scale ? { scale } : {}),
    },
    { command: "cellset.from_file", name: "all", mesh: "block" },
    { command: "cellset.from_tag", name: "left", mesh: "block", value: 1 },
    { command: "material.add", name: "rubber", model: "NeoHooke" },
    {
      command: "section.add",
      name: "body",
      cellset: "all",
      material: "rubber",
      formulation: "u",
    },
    {
      command: "section.add",
      name: "half",
      cellset: "left",
      material: "rubber",
      formulation: "u",
    },
  ] as unknown as Command[];
  return { commands, files };
}

describe("the faces of the sections (#142)", () => {
  it("are the faces of one cell of the section, with their centers", async () => {
    const { commands, files } = await model();
    const all = sectionFaces(commands, files, scaledSurface);
    // the interface of the tags is inside the section of all cells
    const body = all.get("body")!;
    expect(body.mesh).toBe("block");
    expect(body.faces).toHaveLength(10);
    expect(body.faces.map((f) => f.center)).toContainEqual([2, 0.5, 0.5]);
    expect(body.faces.map((f) => f.center)).not.toContainEqual([1, 0.5, 0.5]);
    // ... but on the boundary of the section of one tag
    const half = all.get("half")!;
    expect(half.faces).toHaveLength(6);
    expect(half.faces.map((f) => f.center)).toContainEqual([1, 0.5, 0.5]);
    expect(half.size).toBeCloseTo(Math.sqrt(3));
    // the triangles know their face
    expect([...half.ofTriangle].filter((f) => f >= 0)).toHaveLength(12);
    // computed once per surface
    expect(sectionFaces(commands, files, scaledSurface).get("body")).toBe(body);
  });

  it("are selected by a plane or by their centers, like the script", async () => {
    const { commands, files } = await model();
    const body = sectionFaces(commands, files, scaledSurface).get("body")!;
    const on = (select: Parameters<typeof selectedFaces>[0]) =>
      selectedFaces(select, body).map((i) => body.faces[i].center);
    expect(on({ axis: "x", value: 2 })).toEqual([[2, 0.5, 0.5]]);
    expect(on({ axis: "z", value: 1 })).toEqual([
      [0.5, 0.5, 1],
      [1.5, 0.5, 1],
    ]);
    // the nearest face of a center, within the tolerance
    expect(on({ centers: [[1.5, 0.5, 1]] })).toEqual([[1.5, 0.5, 1]]);
    expect(on({ centers: [[1.4, 0.5, 1]] })).toEqual([]);
    expect(on({ centers: [[1.4, 0.5, 1]], atol: 0.2 })).toEqual([
      [1.5, 0.5, 1],
    ]);
    expect(missingCenters({ centers: [[1.4, 0.5, 1]] }, body)).toEqual([
      [1.4, 0.5, 1],
    ]);
    expect(missingCenters({ axis: "x", value: 0 }, body)).toEqual([]);
    // two triangles per face
    expect(
      faceTriangles(body, selectedFaces({ axis: "z", value: 1 }, body)),
    ).toHaveLength(12);
    // names
    expect(faceSetName({ axis: "x", value: 2 }, body, commands)).toBe(
      "faces_x_max",
    );
    expect(faceSetName({ axis: "x", value: 0.5 }, body, commands)).toBe(
      "faces_x_0_5",
    );
    expect(faceSetName({ centers: [[2, 0.5, 0.5]] }, body, commands)).toBe(
      "faces",
    );
  });

  it("are scaled like the mesh", async () => {
    const { commands, files } = await model(10);
    const body = sectionFaces(commands, files, scaledSurface).get("body")!;
    expect(body.faces.map((f) => f.center)).toContainEqual([20, 5, 5]);
    expect(selectedFaces({ axis: "x", value: 20 }, body)).toHaveLength(1);
    // the triangles index the drawn (scaled) surface
    expect(body.surface.positions[3]).toBe(10);
  });

  it("have outward normals, for the arrows of pressures (#105)", async () => {
    const { commands, files } = await model();
    const sections = sectionFaces(commands, files, scaledSurface);
    const body = sections.get("body")!;
    const end = body.faces.find((f) => f.center[0] === 2)!;
    expect(end.normal).toEqual([1, 0, 0]);
    const bottom = body.faces.find((f) => f.center[2] === 0)!;
    expect(bottom.normal).toEqual([0, 0, -1]);

    const model2 = (pressure: number) =>
      [
        ...commands,
        {
          command: "faceset.add",
          name: "end",
          section: "body",
          select: { axis: "x", value: 2 },
        },
        { command: "pressure.add", name: "push", faces: "end", pressure },
      ] as Command[];
    const options = { size: 10, highlight: "#ffff00" };
    // onto the face: an arrow from outside to its center (shaft and two heads)
    const [onto] = pressureLines(model2(0.1), sections, options);
    expect(onto.color).toBe(FORCE_COLOR);
    expect(Array.from(onto.positions.slice(0, 6))).toEqual(
      [2.8, 0.5, 0.5, 2, 0.5, 0.5].map(Math.fround),
    );
    // a pull: from the center outwards; selected and hidden
    const [pull] = pressureLines(model2(-0.1), sections, {
      ...options,
      selected: "push",
    });
    expect(Array.from(pull.positions.slice(0, 6))).toEqual(
      [2, 0.5, 0.5, 2.8, 0.5, 0.5].map(Math.fround),
    );
    expect([pull.color, pull.width]).toEqual(["#ffff00", 3]);
    expect(
      pressureLines(model2(0.1), sections, {
        ...options,
        hidden: new Set(["push"]),
      }),
    ).toEqual([]);
    expect(pressureLines(model2(0), sections, options)).toEqual([]);
  });
});
