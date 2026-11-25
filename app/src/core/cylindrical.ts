// The axes of the cylindrical constraints (#422), like felupe_studio.cylindrical: a
// cylindrical constraint holds or moves its points radially (r), around (theta) and
// along (z) an axis through a center. The directions are those of each point about
// the axis; FElupe evaluates them in the deformed configuration. In a 2D model, the
// axis is z.
import { type Analysis, is2d } from "./analysis";
import { norm, unit } from "./cartesian";
import type { Command as ResolvedCommand } from "./resolved";

/** A cylindrical constraint with the values of its expressions (#242). */
export type Cylindrical = Extract<
  ResolvedCommand,
  { command: "cylindrical.add" }
>;

/** The axis by default, and the only axis of a 2D model. */
export const AXIS = [0, 0, 1] as const;

/** The center by default. */
export const CENTER = [0, 0, 0] as const;

/** The radius below which a point is on the axis, like np.isclose() of FElupe. */
export const ON_AXIS = 1e-8;

/** The axis as written, with its default. */
export const axisOf = (c: Pick<Cylindrical, "axis">): number[] =>
  [...(c.axis ?? AXIS)].map(Number);

/** Whether the axis of a cylindrical constraint has a length. */
export const hasAxis = (c: Pick<Cylindrical, "axis">) => norm(axisOf(c)) !== 0;

/**
 * The center and the normalized axis of a cylindrical constraint in 3D: of a 2D
 * model the axis z through the center in the xy-plane. Undefined for an axis of
 * zero length.
 */
export function cylinderOf(
  c: Pick<Cylindrical, "axis" | "center">,
  analysis: Analysis,
): { center: number[]; axis: number[] } | undefined {
  const center = [...(c.center ?? CENTER)].map(Number);
  if (is2d(analysis))
    return { center: [center[0], center[1], 0], axis: [0, 0, 1] };
  const axis = unit(axisOf(c));
  return axis && { center, axis };
}

/**
 * The directions e_r, e_θ and e_z of a point about an axis, like the base vectors
 * of fem.CylindricalConstraint (in the undeformed configuration); e_r and e_θ are
 * zero on the axis.
 */
export function frameAt(
  cylinder: { center: readonly number[]; axis: readonly number[] },
  point: ArrayLike<number>,
): number[][] {
  const { center, axis } = cylinder;
  const d = [0, 1, 2].map((k) => point[k] - center[k]);
  const along = d[0] * axis[0] + d[1] * axis[1] + d[2] * axis[2];
  const radial = d.map((x, k) => x - along * axis[k]);
  const radius = norm(radial);
  const e_r = radius > ON_AXIS ? radial.map((x) => x / radius) : [0, 0, 0];
  const e_t = [
    axis[1] * e_r[2] - axis[2] * e_r[1],
    axis[2] * e_r[0] - axis[0] * e_r[2],
    axis[0] * e_r[1] - axis[1] * e_r[0],
  ];
  return [e_r, e_t, [...axis]];
}

/** The distance of a point from an axis. */
export function radiusAt(
  cylinder: { center: readonly number[]; axis: readonly number[] },
  point: ArrayLike<number>,
): number {
  const { center, axis } = cylinder;
  const d = [0, 1, 2].map((k) => point[k] - center[k]);
  const along = d[0] * axis[0] + d[1] * axis[1] + d[2] * axis[2];
  return norm(d.map((x, k) => x - along * axis[k]));
}
