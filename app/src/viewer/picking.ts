// Picking in the viewer: the ray through a point of the view, its first hit on the
// drawn triangles and the plane of the hit face. The camera follows `matrices()` of
// the vendored FElupe viewer (a field of view of 30° and a margin of 10 %).

export type Vec3 = [number, number, number];

/** The camera of the viewer: rotation (right, up, back), target, size and zoom. */
export interface Camera {
  basis: number[][];
  target: number[];
  radius: number;
  zoom: number;
  parallel: boolean;
}

export interface Ray {
  origin: Vec3;
  direction: Vec3;
}

const FOV = (30 * Math.PI) / 180;

const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const scale = (a: number[], s: number): Vec3 => [a[0] * s, a[1] * s, a[2] * s];
const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: Vec3, b: Vec3): Vec3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
const unit = (a: Vec3): Vec3 => scale(a, 1 / (Math.hypot(...a) || 1));

/**
 * The ray through a point of the view, given in pixels from the top left corner of a
 * view of the given size.
 */
export function rayAt(
  camera: Camera,
  x: number,
  y: number,
  width: number,
  height: number,
): Ray {
  const [right, up, back] = camera.basis as [Vec3, Vec3, Vec3];
  const aspect = width / Math.max(height, 1);
  const ndcX = (2 * x) / width - 1;
  const ndcY = 1 - (2 * y) / height;
  const distance = camera.radius / Math.sin(FOV / 2);
  const eye = add(camera.target as Vec3, scale(back, distance));

  if (camera.parallel) {
    const h = (1.1 * camera.radius) / camera.zoom;
    const w = h * aspect;
    const origin = add(eye, add(scale(right, ndcX * w), scale(up, ndcY * h)));
    return { origin, direction: scale(back, -1) };
  }
  const f = (1 / Math.tan(FOV / 2) / 1.1) * camera.zoom;
  const direction = unit(
    add(
      add(scale(right, (ndcX * aspect) / f), scale(up, ndcY / f)),
      scale(back, -1),
    ),
  );
  return { origin: eye, direction };
}

/** The distance along the ray to a triangle (Möller–Trumbore), or undefined. */
export function hitTriangle(ray: Ray, a: Vec3, b: Vec3, c: Vec3) {
  const e1 = sub(b, a);
  const e2 = sub(c, a);
  const p = cross(ray.direction, e2);
  const det = dot(e1, p);
  if (Math.abs(det) < 1e-20) return undefined;
  const inv = 1 / det;
  const s = sub(ray.origin, a);
  const u = dot(s, p) * inv;
  if (u < -1e-9 || u > 1 + 1e-9) return undefined;
  const q = cross(s, e1);
  const v = dot(ray.direction, q) * inv;
  if (v < -1e-9 || u + v > 1 + 1e-9) return undefined;
  const t = dot(e2, q) * inv;
  return t > 0 ? t : undefined;
}

export const vertex = (positions: ArrayLike<number>, point: number): Vec3 => [
  positions[3 * point],
  positions[3 * point + 1],
  positions[3 * point + 2],
];

/** The first hit of a ray on triangles, with the triangle and its unit normal. */
export function firstHit(
  ray: Ray,
  positions: ArrayLike<number>,
  triangles: ArrayLike<number>,
):
  | { distance: number; triangle: number; normal: Vec3; point: Vec3 }
  | undefined {
  let best: { distance: number; triangle: number } | undefined;
  for (let t = 0; t < triangles.length / 3; t++) {
    const a = vertex(positions, triangles[3 * t]);
    const b = vertex(positions, triangles[3 * t + 1]);
    const c = vertex(positions, triangles[3 * t + 2]);
    const distance = hitTriangle(ray, a, b, c);
    if (distance !== undefined && (!best || distance < best.distance)) {
      best = { distance, triangle: t };
    }
  }
  if (!best) return undefined;
  const [a, b, c] = [0, 1, 2].map((k) =>
    vertex(positions, triangles[3 * best!.triangle + k]),
  );
  return {
    ...best,
    normal: unit(cross(sub(b, a), sub(c, a))),
    point: add(ray.origin, scale(ray.direction, best.distance)),
  };
}

/** The axis (0, 1 or 2) of a unit normal along x, y or z, else undefined. */
export function axisOf(normal: Vec3, tolerance = 1e-6): 0 | 1 | 2 | undefined {
  const index = normal.findIndex((n) => Math.abs(Math.abs(n) - 1) < tolerance);
  return index < 0 ? undefined : (index as 0 | 1 | 2);
}

/** The triangles (point triples) whose points all lie in a plane. */
export function trianglesInPlane(
  positions: ArrayLike<number>,
  triangles: ArrayLike<number>,
  point: Vec3,
  normal: Vec3,
  tolerance: number,
): Uint32Array {
  const kept: number[] = [];
  for (let t = 0; t < triangles.length / 3; t++) {
    let inside = true;
    for (let k = 0; k < 3 && inside; k++) {
      const p = vertex(positions, triangles[3 * t + k]);
      inside = Math.abs(dot(sub(p, point), normal)) <= tolerance;
    }
    if (inside) {
      kept.push(triangles[3 * t], triangles[3 * t + 1], triangles[3 * t + 2]);
    }
  }
  return Uint32Array.from(kept);
}
