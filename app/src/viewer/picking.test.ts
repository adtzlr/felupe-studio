import { describe, expect, it } from "vitest";
import {
  axisOf,
  type Camera,
  firstHit,
  hitTriangle,
  rayAt,
  trianglesInPlane,
  type Vec3,
} from "./picking";

// looking at the xy-plane from +z, onto the target (1, 2, 3)
const front = (parallel: boolean): Camera => ({
  basis: [
    [1, 0, 0],
    [0, 1, 0],
    [0, 0, 1],
  ],
  target: [1, 2, 3],
  radius: 2,
  zoom: 1,
  parallel,
});

describe("rays", () => {
  it("go through the target at the center of the view", () => {
    for (const parallel of [false, true]) {
      const ray = rayAt(front(parallel), 50, 40, 100, 80);
      expect(ray.direction[0]).toBeCloseTo(0);
      expect(ray.direction[1]).toBeCloseTo(0);
      expect(ray.direction[2]).toBeCloseTo(-1);
      expect(ray.origin[0]).toBeCloseTo(1);
      expect(ray.origin[1]).toBeCloseTo(2);
      expect(ray.origin[2]).toBeGreaterThan(3);
    }
  });

  it("reach the border of the fitted view at the edge (parallel)", () => {
    // the height of the view is 1.1 * radius / zoom to both sides
    const ray = rayAt(front(true), 50, 0, 100, 100);
    expect(ray.origin[1]).toBeCloseTo(2 + 1.1 * 2);
    const zoomed = rayAt({ ...front(true), zoom: 2 }, 100, 50, 100, 100);
    expect(zoomed.origin[0]).toBeCloseTo(1 + 1.1);
  });

  it("spread with the field of view (perspective)", () => {
    const right = rayAt(front(false), 100, 50, 100, 100);
    // the edge of the view is at 15° / 1.1 of the field of view
    const angle = Math.atan2(right.direction[0], -right.direction[2]);
    expect(Math.tan(angle)).toBeCloseTo(Math.tan((15 * Math.PI) / 180) * 1.1);
  });
});

describe("hits", () => {
  const positions = [
    ...[0, 0, 0, 1, 0, 0, 0, 1, 0],
    ...[0, 0, 1, 1, 0, 1, 0, 1, 1],
  ];
  const triangles = [0, 1, 2, 3, 4, 5];
  const down = { origin: [0.2, 0.2, 5] as Vec3, direction: [0, 0, -1] as Vec3 };

  it("finds the distance to a triangle", () => {
    expect(hitTriangle(down, [0, 0, 0], [1, 0, 0], [0, 1, 0])).toBeCloseTo(5);
    expect(
      hitTriangle(
        { ...down, origin: [0.9, 0.9, 5] },
        [0, 0, 0],
        [1, 0, 0],
        [0, 1, 0],
      ),
    ).toBeUndefined();
    // behind the origin
    expect(
      hitTriangle(
        { ...down, direction: [0, 0, 1] },
        [0, 0, 0],
        [1, 0, 0],
        [0, 1, 0],
      ),
    ).toBeUndefined();
  });

  it("takes the first triangle along the ray", () => {
    const hit = firstHit(down, positions, triangles)!;
    expect(hit.triangle).toBe(1);
    expect(hit.distance).toBeCloseTo(4);
    expect(hit.normal).toEqual([0, 0, 1]);
    expect(hit.point[2]).toBeCloseTo(1);
    expect(
      firstHit({ ...down, origin: [5, 5, 5] }, positions, triangles),
    ).toBeUndefined();
  });

  it("finds the axis of a normal and the triangles of a plane", () => {
    expect(axisOf([0, 0, -1])).toBe(2);
    expect(axisOf([0.6, 0.8, 0])).toBeUndefined();
    expect([
      ...trianglesInPlane(positions, triangles, [5, 5, 1], [0, 0, 1], 1e-9),
    ]).toEqual([3, 4, 5]);
  });
});
