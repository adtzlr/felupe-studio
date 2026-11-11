import { contourLook, DEFAULT_CONTOUR } from "../core/contour";
import { describe, expect, it } from "vitest";
import type { SurfaceObject } from "../vendor/felupe-viewer/viewer.js";
import type { MeshSurface, ResultScene } from "../worker/protocol";
import { categorical, CATEGORICAL, OTHER } from "./palette";
import {
  arrowSegments,
  buildScene,
  GHOST_COLOR,
  meshNodes,
  meshObjects,
  nodeObject,
  resultNodes,
  resultObjects,
} from "./scene";

/** Two cells (two triangles each) of a unit square in the xy-plane. */
function square(faces = true): MeshSurface {
  return {
    positions: new Float32Array([0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0]),
    triangles: new Uint32Array([0, 1, 2, 0, 2, 3, 0, 1, 3, 1, 2, 3]),
    ...(faces ? { faces: new Uint32Array([0, 0, 1, 1]) } : {}),
    edges: new Uint32Array([0, 1, 1, 2, 2, 3, 3, 0]),
    owners: new Uint32Array([0, 0, 1, 1]),
    cells: 2,
  };
}

const values = (array: { data: unknown }) =>
  Array.from(array.data as ArrayLike<number>);

describe("scene of the viewer", () => {
  it("draws a mesh like mesh.plot() of FElupe", () => {
    const surface = square();
    const [object, ...rest] = meshObjects({
      name: "bar",
      surface,
      color: "#3987e5",
    });
    expect(rest).toEqual([]);
    expect(object).toMatchObject({
      type: "surface",
      color: "#3987e5",
      edgeColor: "#000000",
      smooth: false,
      sharp: true,
    });
    // the arrays of the surface are used without copies
    expect(object.positions.data).toBe(surface.positions);
    expect(object.triangles!.data).toBe(surface.triangles);
    expect(object.faceIds!.data).toBe(surface.faces);
    expect(object.edges!.size).toBe(8);
  });

  it("leaves out the face ids of curved faces", () => {
    const [object] = meshObjects({
      name: "bar",
      surface: square(false),
      color: "#3987e5",
    });
    expect(object.faceIds).toBeUndefined();
  });

  it("colors groups of cells", () => {
    const objects = meshObjects({
      name: "bar",
      surface: square(),
      color: "#3987e5",
      groups: [{ color: "#d95926", cells: [1] }],
    });
    expect(objects.map((o) => o.color)).toEqual(["#3987e5", "#d95926"]);
    expect(values(objects[0].triangles!)).toEqual([0, 1, 2, 0, 2, 3]);
    expect(values(objects[1].triangles!)).toEqual([0, 1, 3, 1, 2, 3]);
    expect(values(objects[1].faceIds!)).toEqual([1, 1]);
    // the edges are drawn once
    expect(objects.filter((o) => o.edges)).toHaveLength(1);
  });

  it("drops colors without cells and keeps the edges", () => {
    const objects = meshObjects({
      name: "bar",
      surface: square(),
      color: "#3987e5",
      groups: [{ color: "#d95926", cells: [0, 1, 7] }],
    });
    expect(objects.map((o) => o.color)).toEqual(["#d95926"]);
    expect(objects[0].edges).toBeDefined();

    const empty = meshObjects({
      name: "empty",
      surface: {
        ...square(),
        triangles: new Uint32Array(),
        owners: new Uint32Array(),
      },
      color: "#3987e5",
    });
    expect(empty).toHaveLength(1);
    expect(empty[0].edges!.size).toBe(8);
  });

  it("names the meshes in a legend if there is more than one", () => {
    const one = buildScene({
      meshes: [{ name: "a", surface: square(), color: categorical(0) }],
    });
    expect(one).toMatchObject({ legend: null, view: "default", axes: true });

    const two = buildScene({
      meshes: [
        { name: "a", surface: square(), color: categorical(0) },
        { name: "b", surface: square(), color: categorical(1) },
      ],
    });
    expect(two.legend).toEqual([
      { label: "a", color: CATEGORICAL[0] },
      { label: "b", color: CATEGORICAL[1] },
    ]);
    expect(
      buildScene({ meshes: [], legend: [{ label: "x", color: "#fff" }] })
        .legend,
    ).toEqual([{ label: "x", color: "#fff" }]);
  });

  it("adds markers and arrows", () => {
    const scene = buildScene({
      meshes: [],
      markers: [{ positions: [0, 0, 0, 1, 0, 0] }],
      arrows: [{ origins: [0, 0, 0], directions: [0, 0, 2] }],
    });
    expect(scene.objects.map((o) => o.type)).toEqual(["points", "lines"]);
    expect(scene.objects[0]).toMatchObject({ size: 8 });
    expect((scene.objects[0] as SurfaceObject).positions.size).toBe(6);
  });

  it("does not generate colors beyond the palette", () => {
    expect(categorical(7)).toBe(CATEGORICAL[7]);
    expect(categorical(8)).toBe(OTHER);
  });
});

describe("arrows", () => {
  it("draws a shaft and a head at the tip", () => {
    const segments = arrowSegments({
      origins: [1, 0, 0],
      directions: [0, 0, 2],
    });
    // shaft and four strokes of the head, two points each
    expect(segments).toHaveLength(5 * 6);
    expect([...segments.subarray(0, 6)]).toEqual([1, 0, 0, 1, 0, 2]);
    for (let s = 1; s < 5; s++) {
      const stroke = [...segments.subarray(6 * s, 6 * s + 6)];
      expect(stroke.slice(0, 3)).toEqual([1, 0, 2]);
      // a quarter of the length back from the tip, a tenth to the side
      expect(stroke[5]).toBeCloseTo(1.5);
      const side = Math.hypot(stroke[3] - 1, stroke[4]);
      expect(side).toBeCloseTo(0.2);
    }
  });

  it("skips arrows of zero length", () => {
    expect(
      arrowSegments({ origins: [0, 0, 0], directions: [0, 0, 0] }),
    ).toHaveLength(0);
  });
});

describe("nodes", () => {
  it("are the points of the drawn faces that are nodes of the mesh", () => {
    const layer = { name: "bar", surface: square(), color: "#3987e5" };
    expect(Array.from(meshNodes(layer).positions)).toEqual([
      0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0,
    ]);
    // hidden cells hide their nodes: a second cell with a point of its own
    const two = {
      ...layer,
      surface: {
        ...square(),
        positions: new Float32Array([
          0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0, 2, 0, 0,
        ]),
        triangles: new Uint32Array([0, 1, 2, 0, 2, 3, 1, 4, 2]),
        faces: undefined,
        owners: new Uint32Array([0, 0, 1]),
      },
    };
    expect(meshNodes(two).positions).toHaveLength(15);
    expect(meshNodes({ ...two, hidden: [0, 1] }).positions).toHaveLength(12);
    expect(meshNodes({ ...two, hidden: [1, 1] }).positions).toHaveLength(0);
    // a point inside a subdivided face is not a node
    const surface = { ...square(), isNode: new Uint8Array([1, 1, 0, 1]) };
    expect(meshNodes({ ...layer, surface }).positions).toHaveLength(9);
  });

  it("of a result are displaced like its surfaces", () => {
    const surface = square();
    const scene: ResultScene = {
      label: "Displacement",
      at: "point",
      range: [0, 1],
      surfaces: [
        {
          name: "bar",
          positions: surface.positions,
          displacement: new Float32Array([0, 0, 0, 1, 0, 0, 2, 0, 0, 3, 0, 0]),
          triangles: surface.triangles,
          edges: surface.edges,
          values: new Float32Array(4),
          owners: new Uint32Array([0, 0, 1, 1]),
          nodes: new Int32Array([0, 1, -1, 3]),
        },
      ],
    };
    const [nodes] = resultNodes({ scene, scale: 2, undeformed: false });
    expect(Array.from(nodes.positions)).toEqual([0, 0, 0, 1, 0, 0, 0, 1, 0]);
    expect(Array.from(nodes.displacement!)).toEqual([
      0, 0, 0, 1, 0, 0, 3, 0, 0,
    ]);
    expect(nodeObject(nodes)).toMatchObject({
      type: "points",
      color: "#000000",
      factor: 2,
    });
    // empty nodes are left out of a scene, the others are drawn after the meshes
    const built = buildScene({
      meshes: [{ name: "bar", surface, color: "#3987e5" }],
      nodes: [nodes, { positions: new Float32Array() }],
    });
    expect(built.objects.map((o) => o.type)).toEqual(["surface", "points"]);
  });
});

describe("results", () => {
  const surface = square();
  const scene: ResultScene = {
    label: "Displacement",
    at: "point",
    range: [0, 0.5],
    surfaces: ["left", "right"].map((name) => ({
      name,
      positions: surface.positions,
      displacement: new Float32Array(12).fill(0.1),
      triangles: surface.triangles,
      faces: surface.faces,
      edges: surface.edges,
      values: new Float32Array([0, 0.1, 0.2, 0.5]),
      owners: new Uint32Array([0, 0]),
      nodes: new Int32Array([0, 1, 2, 3]),
    })),
  };

  it("draws the deformed sections with a common contour and ghosts", () => {
    const objects = resultObjects({ scene, scale: 2, undeformed: true });
    expect(objects).toHaveLength(4);
    const [ghost, , deformed] = objects;
    expect(ghost).toMatchObject({ color: GHOST_COLOR, opacity: 0.2 });
    expect(ghost.displacement).toBeUndefined();
    expect(deformed).toMatchObject({
      factor: 2,
      valuesAt: "point",
      range: [0, 0.5],
      label: "Displacement",
      edgeColor: "#000000",
    });
    expect(deformed.displacement!.data).toBe(scene.surfaces[0].displacement);
    expect(deformed.values!.data).toBe(scene.surfaces[0].values);
    expect(values(deformed.faceIds!)).toEqual([0, 0, 1, 1]);

    const plain = resultObjects({ scene, scale: 1, undeformed: false });
    expect(plain).toHaveLength(2);
    // without finite values, the range is a placeholder
    const empty = resultObjects({
      scene: { ...scene, range: null },
      scale: 1,
      undeformed: false,
    });
    expect(empty[0].range).toEqual([0, 1]);

    // the look of the contour (#139): its lookup table, bands and range, and the
    // scalar bar of the app instead of the one of the viewer
    const manual = { ...DEFAULT_CONTOUR, range: "manual" as const, bands: 6 };
    const look = contourLook(manual, [0, 6], [0, 9]);
    const [styled] = resultObjects({
      scene,
      scale: 1,
      undeformed: false,
      look,
    });
    expect(styled).toMatchObject({
      range: [-1, 7],
      bands: 8,
      scalarBar: false,
      lut: { dtype: "u1", size: 768 },
    });
    expect(styled.lut!.data).toBe(look.lut);
  });

  it("is a part of the scene without a legend", () => {
    const built = buildScene({
      meshes: [],
      result: { scene, scale: 1, undeformed: false },
    });
    expect(built.objects).toHaveLength(2);
    expect(built.legend).toBeNull();
  });
});
