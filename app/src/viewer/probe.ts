// The value under the pointer in the results (#85): the hit on the drawn (deformed
// and scaled) surfaces, the point of the surface nearest to the hit, the position of
// a point in the view, and the text of the value of a cell or of a point.
import type { ResultScene } from "../worker/protocol";
import { type Camera, firstHit, type Ray, type Vec3, vertex } from "./picking";

/** The drawn positions of a surface: the points moved by the scaled displacements. */
export function deformedPositions(
  positions: ArrayLike<number>,
  displacement: ArrayLike<number>,
  scale: number,
): Float32Array {
  const result = new Float32Array(positions.length);
  for (let i = 0; i < positions.length; i++) {
    result[i] = positions[i] + scale * (displacement[i] ?? 0);
  }
  return result;
}

export interface Probe {
  /** The index of the surface (section) in the scene. */
  surface: number;
  triangle: number;
  /** The point of the surface nearest to the hit: a corner of the triangle. */
  point: number;
  /** The drawn position of that point. */
  position: Vec3;
}

/** The first hit of a ray on the drawn surfaces. */
export function probeAt(
  ray: Ray,
  surfaces: readonly {
    positions: ArrayLike<number>;
    triangles: ArrayLike<number>;
  }[],
): Probe | undefined {
  let best:
    | { surface: number; distance: number; triangle: number; point: Vec3 }
    | undefined;
  surfaces.forEach((s, surface) => {
    const hit = firstHit(ray, s.positions, s.triangles);
    if (hit && (!best || hit.distance < best.distance)) {
      best = { surface, ...hit };
    }
  });
  if (!best) return undefined;
  const { surface, triangle, point: hit } = best;
  const { positions, triangles } = surfaces[surface];
  let point = triangles[3 * triangle];
  let nearest = Infinity;
  for (let k = 0; k < 3; k++) {
    const corner = triangles[3 * triangle + k];
    const p = vertex(positions, corner);
    const d = Math.hypot(p[0] - hit[0], p[1] - hit[1], p[2] - hit[2]);
    if (d < nearest) [point, nearest] = [corner, d];
  }
  return { surface, triangle, point, position: vertex(positions, point) };
}

/**
 * The position of a point in a view of the given size, in pixels from its top left
 * corner (the inverse of `rayAt`), or undefined for a point behind the camera.
 */
export function projectPoint(
  camera: Camera,
  point: Vec3,
  width: number,
  height: number,
): [number, number] | undefined {
  const [right, up, back] = camera.basis as [Vec3, Vec3, Vec3];
  const fov = (30 * Math.PI) / 180;
  const aspect = width / Math.max(height, 1);
  const distance = camera.radius / Math.sin(fov / 2);
  const eye = [0, 1, 2].map((k) => camera.target[k] + back[k] * distance);
  const v = [0, 1, 2].map((k) => point[k] - eye[k]) as Vec3;
  const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  let ndcX: number;
  let ndcY: number;
  if (camera.parallel) {
    const h = (1.1 * camera.radius) / camera.zoom;
    ndcX = dot(v, right) / (h * aspect);
    ndcY = dot(v, up) / h;
  } else {
    const depth = -dot(v, back);
    if (depth <= 0) return undefined;
    const f = (1 / Math.tan(fov / 2) / 1.1) * camera.zoom;
    ndcX = ((dot(v, right) / depth) * f) / aspect;
    ndcY = (dot(v, up) / depth) * f;
  }
  return [((ndcX + 1) / 2) * width, ((1 - ndcY) / 2) * height];
}

export interface ProbeInfo {
  /** The quantity of the contour. */
  label: string;
  /** The value, or null if it is not finite. */
  value: number | null;
  /** Where the value comes from: a cell or a node of a section. */
  where: string;
  /** The displacement of the point (for values at the points). */
  displacement?: Vec3;
  /** The value belongs to a point (marked in the view), not to a cell. */
  atPoint: boolean;
}

/** The value of a probe: of the cell of the hit triangle or of the nearest point. */
export function probeInfo(scene: ResultScene, probe: Probe): ProbeInfo {
  const surface = scene.surfaces[probe.surface];
  const finite = (value: number | undefined) =>
    value !== undefined && Number.isFinite(value) ? value : null;
  if (scene.at === "cell") {
    return {
      label: scene.label,
      value: finite(surface.values[probe.triangle]),
      where: `Cell ${surface.owners[probe.triangle]} of ${surface.name}`,
      atPoint: false,
    };
  }
  const node = surface.nodes[probe.point];
  return {
    label: scene.label,
    value: finite(surface.values[probe.point]),
    where:
      node >= 0
        ? `Node ${node} of ${surface.name}`
        : `A point of a face of ${surface.name}`,
    displacement: vertex(surface.displacement, probe.point),
    atPoint: true,
  };
}

/**
 * The drawn node nearest to a point of the view (pixels from its top left corner),
 * within a radius in pixels (#93). With a hit of the ray on the drawn faces, nodes
 * that are further away along the ray than the hit (by more than `depth`) are behind
 * the faces and are left out.
 */
export function nearestNode(
  camera: Camera,
  ray: Ray,
  x: number,
  y: number,
  width: number,
  height: number,
  nodes: readonly ArrayLike<number>[],
  radius: number,
  hit?: { distance: number; depth: number },
): Vec3 | undefined {
  let best: { node: Vec3; distance: number } | undefined;
  for (const positions of nodes) {
    for (let p = 0; p < positions.length / 3; p++) {
      const node = vertex(positions, p);
      const at = projectPoint(camera, node, width, height);
      if (!at) continue;
      const distance = Math.hypot(at[0] - x, at[1] - y);
      if (distance > radius || (best && distance >= best.distance)) continue;
      if (hit) {
        const along = [0, 1, 2].reduce(
          (sum, k) => sum + (node[k] - ray.origin[k]) * ray.direction[k],
          0,
        );
        if (along > hit.distance + hit.depth) continue;
      }
      best = { node, distance };
    }
  }
  return best?.node;
}
