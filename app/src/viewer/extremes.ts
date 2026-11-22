// The minimum and the maximum of a contour in the view (#140): a node gets a dot; a
// cell at the surface gets the outlines of its outer faces (a dot at its center
// would be inside the section), and its label takes the center of the outer face
// nearest to the camera; a cell inside keeps a dot at its center. With a cut of the
// view (#395), a cell on the cut face gets the outline of its cut, too, and an
// extreme in the hidden half is not drawn.
import type { ResultExtreme, ResultScene } from "../worker/protocol";
import { isVisible, type Plane } from "./cut";
import type { Vec3 } from "./picking";

export interface ExtremeShape {
  /** The points where the label may be, the nearest one to the camera is taken. */
  anchors: Vec3[];
  /** A dot (of a node, or of a cell inside). */
  dot?: Vec3;
  /** Line segments (two points each) of the outlines of the outer faces. */
  outline?: Float32Array;
}

const deformed = (
  positions: ArrayLike<number>,
  displacement: ArrayLike<number>,
  point: number,
  scale: number,
): Vec3 =>
  [0, 1, 2].map(
    (k) => positions[3 * point + k] + scale * displacement[3 * point + k],
  ) as Vec3;

/**
 * The drawn shape of an extreme of a scene, displaced by the scale; none in the
 * hidden half of a cut of the scene (#395): of a node there, or of a cell with no
 * drawn faces and its center there.
 */
export function extremeShape(
  scene: ResultScene,
  extreme: ResultExtreme,
  scale: number,
  plane?: Plane,
): ExtremeShape | undefined {
  const center = extreme.position.map(
    (x, k) => x + scale * extreme.displacement[k],
  ) as Vec3;
  const dot = () =>
    plane && !isVisible(plane, extreme.position)
      ? undefined
      : { anchors: [center], dot: center };
  const surface = scene.surfaces.find((s) => s.name === extreme.section);
  // a cell inside may be on the cut face
  if (extreme.at === "point" || !surface || (!extreme.surface && !plane)) {
    return dot();
  }
  // the triangles of the cell, grouped by their faces (of linear cells), those of
  // the cut face of a curved cell together
  const groups = new Map<number | "cut", number[]>();
  surface.owners.forEach((owner, t) => {
    if (owner !== extreme.index) return;
    const face = surface.faces
      ? surface.faces[t]
      : surface.outer !== undefined && t >= surface.outer
        ? "cut"
        : t;
    groups.set(face, [...(groups.get(face) ?? []), t]);
  });
  if (!groups.size) return dot();

  const anchors: Vec3[] = [];
  const segments: number[] = [];
  for (const triangles of groups.values()) {
    // the edges of a face that belong to one triangle only: its outline
    const count = new Map<string, [number, number]>();
    const seen = new Map<string, number>();
    const points = new Set<number>();
    for (const t of triangles) {
      const corners = [0, 1, 2].map((k) => surface.triangles[3 * t + k]);
      corners.forEach((p) => points.add(p));
      for (let k = 0; k < 3; k++) {
        const a = corners[k];
        const b = corners[(k + 1) % 3];
        const key = a < b ? `${a}-${b}` : `${b}-${a}`;
        count.set(key, [a, b]);
        seen.set(key, (seen.get(key) ?? 0) + 1);
      }
    }
    for (const [key, [a, b]] of count) {
      if (seen.get(key) !== 1) continue;
      for (const p of [a, b]) {
        segments.push(
          ...deformed(surface.positions, surface.displacement, p, scale),
        );
      }
    }
    const centers = [...points].map((p) =>
      deformed(surface.positions, surface.displacement, p, scale),
    );
    anchors.push(
      [0, 1, 2].map(
        (k) => centers.reduce((sum, c) => sum + c[k], 0) / centers.length,
      ) as Vec3,
    );
  }
  return { anchors, outline: Float32Array.from(segments) };
}
