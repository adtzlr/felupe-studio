import { describe, expect, it } from "vitest";
import { MeshFiles } from "../core/meshfiles";
import type { MeshSurface } from "../worker/protocol";
import {
  clipSegments,
  clipSurface,
  cutHighlights,
  cutLayers,
  cutLines,
  cutMarkers,
  failedCuts,
  isVisible,
  meshCuts,
  planeOf,
  uncutPick,
  visiblePart,
  visiblePoints,
} from "./cut";
import type { ViewportContent } from "./layers";
import type { MeshLayer } from "./scene";

/** The area of triangles. */
function area(positions: ArrayLike<number>, triangles: ArrayLike<number>) {
  let sum = 0;
  for (let t = 0; t < triangles.length; t += 3) {
    const [a, b, c] = [0, 1, 2].map((k) =>
      [0, 1, 2].map((i) => positions[3 * triangles[t + k] + i]),
    );
    const u = [0, 1, 2].map((i) => b[i] - a[i]);
    const v = [0, 1, 2].map((i) => c[i] - a[i]);
    sum +=
      Math.hypot(
        u[1] * v[2] - u[2] * v[1],
        u[2] * v[0] - u[0] * v[2],
        u[0] * v[1] - u[1] * v[0],
      ) / 2;
  }
  return sum;
}

// the unit square in the plane z = 0, of two triangles
const square = {
  positions: new Float32Array([0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0]),
  triangles: new Uint32Array([0, 1, 2, 0, 2, 3]),
};

describe("the plane of a cut (#395)", () => {
  it("hides the half beyond or before it, not the points on it", () => {
    const plane = planeOf({ axis: "y", value: 0.5, half: "+" }, 2);
    expect(plane).toMatchObject({ axis: 1, value: 0.5, sign: 1 });
    // a point closer to the plane than the tolerance is on it
    const points = [0, 0, 0, 0, 0.5 + 1e-7, 0, 0, 1, 0, 0, 0.5 + 1e-3, 0];
    expect([...visiblePoints(plane, points)]).toEqual([
      0,
      0,
      0,
      0,
      0.5 + 1e-7,
      0,
    ]);
    const before = planeOf({ axis: "y", value: 0.5, half: "-" }, 2);
    expect(visiblePoints(before, points)).toHaveLength(9);
    // markers without points are left out
    const markers = cutMarkers(plane, [
      { positions: [0, 1, 0], color: "red" },
      { positions: [0, 0, 0], color: "blue", size: 9 },
    ]);
    expect(markers).toEqual([
      { positions: Float64Array.from([0, 0, 0]), color: "blue", size: 9 },
    ]);
  });
});

describe("clipping at the plane (#395)", () => {
  const plane = planeOf({ axis: "x", value: 0.25, half: "+" }, 1);

  it("clips segments", () => {
    const segments = new Float32Array([
      // kept, clipped from both sides, hidden, and hidden but a point on the plane
      0,
      0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0, 1, 0, 0, 1, 1, 0, 0.25,
      0, 0, 1, 0, 0,
    ]);
    expect([...clipSegments(plane, segments)]).toEqual([
      0, 0, 0, 0, 1, 0, 0, 0, 0, 0.25, 0, 0, 0.25, 1, 0, 0, 1, 0,
    ]);
    const lines = cutLines(plane, [
      { positions: segments, color: "red", width: 2 },
      { positions: segments.slice(18), color: "blue" },
    ]);
    expect(lines.map((l) => [l.color, l.positions.length])).toEqual([
      ["red", 18],
    ]);
  });

  it("clips the triangles of faces", () => {
    const [half] = cutHighlights(plane, [{ ...square, color: "red" }]);
    expect(half.color).toBe("red");
    expect(area(half.positions, half.triangles)).toBeCloseTo(0.25);
    for (const p of half.triangles)
      expect(half.positions[3 * p]).toBeLessThanOrEqual(0.25);
    // the other half, and nothing beyond the square
    const other = planeOf({ axis: "x", value: 0.25, half: "-" }, 1);
    const [rest] = cutHighlights(other, [{ ...square, color: "red" }]);
    expect(area(rest.positions, rest.triangles)).toBeCloseTo(0.75);
    const outside = planeOf({ axis: "x", value: -1, half: "+" }, 1);
    expect(cutHighlights(outside, [{ ...square, color: "red" }])).toEqual([]);
    // a plane through a point: no triangles of no area
    const corner = planeOf({ axis: "x", value: 0, half: "+" }, 1);
    expect(cutHighlights(corner, [{ ...square, color: "red" }])).toEqual([]);
    const side = planeOf({ axis: "x", value: 1, half: "+" }, 1);
    const [whole] = cutHighlights(side, [{ ...square, color: "red" }]);
    expect(whole.triangles).toHaveLength(6);
    expect(area(whole.positions, whole.triangles)).toBeCloseTo(1);
  });

  it("clips the surface of a construction mesh", () => {
    const surface: MeshSurface = {
      ...square,
      faces: new Uint32Array([0, 1]),
      edges: new Uint32Array([0, 1, 1, 2, 2, 3, 3, 0]),
      owners: new Uint32Array([0, 1]),
      isNode: new Uint8Array([1, 1, 1, 1]),
      cells: 2,
    };
    const clipped = clipSurface(plane, surface);
    expect(area(clipped.positions, clipped.triangles)).toBeCloseTo(0.25);
    const count = clipped.triangles.length / 3;
    expect(clipped.owners).toHaveLength(count);
    expect(clipped.faces).toEqual(clipped.owners);
    // the new points on the edges are shared and no nodes
    const points = clipped.positions.length / 3;
    expect(points).toBe(7);
    expect([...clipped.isNode!]).toEqual([1, 1, 1, 1, 0, 0, 0]);
    // the outline: the bottom and the top clipped, the left side kept
    expect(clipped.edges).toHaveLength(6);
  });
});

describe("the cut meshes (#395)", () => {
  const surface: MeshSurface = {
    ...square,
    edges: new Uint32Array(),
    owners: new Uint32Array([0, 0]),
    cells: 1,
  };
  const layer: MeshLayer = { name: "a", surface, color: "red" };
  const source = { type: "inspect-mesh" as const, name: "a.vtu" };
  const content = {
    meshes: [layer, { ...layer, name: "b" }],
    origins: new Map([["a", { source, cellType: "quad", scale: 2 }]]),
  } as unknown as ViewportContent;

  it("are cut in the coordinates of their files", () => {
    const cut = { axis: "x" as const, value: 1, half: "+" as const };
    expect(meshCuts(content, undefined)).toEqual([]);
    expect(meshCuts(content, cut)).toEqual([
      { name: "a", source, cut: { ...cut, value: 0.5 } },
    ]);
  });

  it("are drawn with their latest cut, scaled, else whole", async () => {
    const cut = { axis: "x" as const, value: 1, half: "+" as const };
    const cuts = meshCuts(content, cut);
    const half = {
      ...surface,
      triangles: new Uint32Array([0, 1, 2]),
      sources: new Int32Array([0]),
    };
    let arrive: () => void = () => {};
    const files = new MeshFiles(undefined, {
      cut: () =>
        new Promise((resolve) => (arrive = () => resolve({ quad: half }))),
    });
    expect(cutLayers(content, [], files)).toBe(content.meshes);
    files.cutMeshes(cuts);
    expect(cutLayers(content, cuts, files)).toEqual(content.meshes);
    arrive();
    await Promise.resolve();
    const [a, b] = cutLayers(content, cuts, files);
    expect(a.surface.triangles).toBe(half.triangles);
    expect(a.surface.positions).toEqual(half.positions.map((x) => 2 * x));
    expect(b).toBe(content.meshes[1]);
  });

  it("tell the meshes whose cut failed, by the exception (#442)", async () => {
    const cut = { axis: "x" as const, value: 1, half: "+" as const };
    const of = (name: string) => ({ name, source: { ...source, name }, cut });
    const cuts = [of("a"), of("b"), of("c"), of("d")];
    const files = new MeshFiles(undefined, {
      cut: async (request) => {
        const { name } = request as typeof source;
        if (name === "d") return { quad: surface };
        throw new Error(
          name === "c"
            ? "Traceback (most recent call last):\nnumpy._core._exceptions._ArrayMemoryError: Unable to allocate"
            : "Traceback (most recent call last):\nValueError: negative axis 1 index: -26780\n",
        );
      },
    });
    expect(failedCuts(cuts, files)).toEqual([]);
    files.cutMeshes(cuts);
    await new Promise((resolve) => setTimeout(resolve));
    expect(failedCuts(cuts, files)).toEqual([
      { names: ["a", "b"], error: "ValueError: negative axis 1 index: -26780" },
      { names: ["c"], error: "_ArrayMemoryError: Unable to allocate" },
    ]);
  });

  it("pick the triangles of the outer surface, not the cut face", () => {
    const cut = {
      ...surface,
      triangles: new Uint32Array([0, 1, 2, 0, 2, 3]),
      sources: new Int32Array([7, -1]),
    };
    const layers = [{ ...layer, surface: cut }];
    const pick = {
      mesh: "a",
      point: [0, 0, 0] as [number, number, number],
      normal: [0, 0, 1] as [number, number, number],
      triangle: 0,
    };
    expect(uncutPick(pick, layers)).toEqual({ ...pick, triangle: 7 });
    expect(uncutPick({ ...pick, triangle: 1 }, layers)).toBeUndefined();
    expect(uncutPick(pick, [layer])).toBe(pick);
    expect(uncutPick(undefined, layers)).toBeUndefined();
  });
});

describe("the visible part of a line of the undeformed model (#395)", () => {
  const plane = planeOf({ axis: "y", value: 1, half: "-" }, 2);

  it("is the part beyond the plane of a hidden half y < 1", () => {
    expect(isVisible(plane, [0, 2, 0])).toBe(true);
    expect(isVisible(plane, [0, 1, 0])).toBe(true);
    expect(isVisible(plane, [0, 0.5, 0])).toBe(false);
    expect(visiblePart(plane, [0, 2, 0], [5, 3, 0])).toEqual([0, 1]);
    expect(visiblePart(plane, [0, 0, 0], [0, 4, 0])).toEqual([0.25, 1]);
    expect(visiblePart(plane, [0, 3, 0], [0, -1, 0])).toEqual([0, 0.5]);
    // hidden, or a point on the plane only
    expect(visiblePart(plane, [0, 0, 0], [0, 0.5, 0])).toBeUndefined();
    expect(visiblePart(plane, [0, 0, 0], [0, 1, 0])).toBeUndefined();
    // on the plane
    expect(visiblePart(plane, [0, 1, 0], [3, 1, 0])).toEqual([0, 1]);
  });
});
