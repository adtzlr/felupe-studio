import { describe, expect, it } from "vitest";
import type { SurfaceObject } from "../vendor/felupe-viewer/viewer.js";
import type { MeshSurface } from "../worker/protocol";
import { categorical, CATEGORICAL, OTHER } from "./palette";
import { arrowSegments, buildScene, meshObjects } from "./scene";

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
