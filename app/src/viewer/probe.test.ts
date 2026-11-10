import { describe, expect, it } from "vitest";
import type { ResultScene } from "../worker/protocol";
import { type Camera, rayAt, type Vec3 } from "./picking";
import { deformedPositions, probeAt, probeInfo, projectPoint } from "./probe";

// a unit square in the plane z = 0 of two triangles, and one in z = -1
const square = (z: number) => ({
  positions: new Float32Array([0, 0, z, 1, 0, z, 1, 1, z, 0, 1, z]),
  triangles: new Uint32Array([0, 1, 2, 0, 2, 3]),
});

const camera: Camera = {
  basis: [
    [1, 0, 0],
    [0, 1, 0],
    [0, 0, 1],
  ],
  target: [0.5, 0.5, 0],
  radius: 1,
  zoom: 1,
  parallel: false,
};

describe("probe", () => {
  it("moves the points by the scaled displacements", () => {
    expect([
      ...deformedPositions([0, 0, 0, 1, 0, 0], [0.5, 0, 0, 0.5, 1, 0], 2),
    ]).toEqual([1, 0, 0, 2, 2, 0]);
  });

  it("finds the first surface under a point of the view and the nearest point", () => {
    // looking along -z at the center of the view
    const ray = rayAt(camera, 50, 50, 100, 100);
    const front = square(0);
    const back = square(-1);
    expect(probeAt(ray, [back, front])).toMatchObject({
      surface: 1,
      triangle: 0,
    });
    // a ray near the corner (1, 1) of the square
    const corner = rayAt(
      camera,
      ...(projectPoint(camera, [0.9, 0.9, 0], 100, 100) as [number, number]),
      100,
      100,
    );
    expect(probeAt(corner, [front])).toEqual({
      surface: 0,
      triangle: 0,
      point: 2,
      position: [1, 1, 0],
    });
    expect(probeAt(rayAt(camera, 0, 0, 100, 100), [front])).toBeUndefined();
  });

  it("projects points into the view, the inverse of the rays", () => {
    for (const parallel of [false, true]) {
      const view = { ...camera, parallel, zoom: 1.5 };
      for (const [x, y] of [
        [10, 20],
        [60, 75],
        [99, 1],
      ]) {
        const ray = rayAt(view, x, y, 100, 80);
        const point = [0, 1, 2].map(
          (k) => ray.origin[k] + 3 * ray.direction[k],
        ) as Vec3;
        const [px, py] = projectPoint(view, point, 100, 80)!;
        expect(px).toBeCloseTo(x, 6);
        expect(py).toBeCloseTo(y, 6);
      }
    }
    // behind the camera
    expect(projectPoint(camera, [0.5, 0.5, 100], 100, 100)).toBeUndefined();
  });

  it("tells the value of a cell or of a point", () => {
    const surface = {
      name: "block",
      ...square(0),
      displacement: new Float32Array([
        0, 0, 0, 0.1, 0, 0, 0.2, 0.1, 0, 0, 0, 0,
      ]),
      edges: new Uint32Array(),
      owners: new Uint32Array([7, 8]),
      nodes: new Int32Array([10, 11, 12, -1]),
    };
    const cells: ResultScene = {
      label: "Von Mises equivalent Cauchy stress",
      at: "cell",
      range: [0, 3],
      surfaces: [{ ...surface, values: new Float32Array([1.5, NaN]) }],
    };
    const probe = { surface: 0, triangle: 0, point: 2, position: [1, 1, 0] };
    expect(probeInfo(cells, probe as never)).toEqual({
      label: "Von Mises equivalent Cauchy stress",
      value: 1.5,
      where: "Cell 7 of block",
      atPoint: false,
    });
    expect(
      probeInfo(cells, { ...probe, triangle: 1 } as never).value,
    ).toBeNull();

    const points: ResultScene = {
      ...cells,
      label: "Displacement",
      at: "point",
      surfaces: [{ ...surface, values: new Float32Array([0, 0.1, 0.25, 0]) }],
    };
    const info = probeInfo(points, probe as never);
    expect(info).toMatchObject({
      value: 0.25,
      where: "Node 12 of block",
      atPoint: true,
    });
    expect(info.displacement?.map((c) => Number(c.toFixed(3)))).toEqual([
      0.2, 0.1, 0,
    ]);
    expect(probeInfo(points, { ...probe, point: 3 } as never).where).toBe(
      "A point of a face of block",
    );
  });
});
