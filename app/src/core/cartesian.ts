// The coordinate systems of the Cartesian constraints (#421), like
// felupe_studio.cartesian: the base vectors e1, e2 and e3 = e1 × e2, normalized and
// fixed in space. In a 2D model, e2 is e1 turned by 90° about z.
import { type Analysis, is2d } from "./analysis";
import type { Command as ResolvedCommand } from "./resolved";

/** A Cartesian constraint with the values of its expressions (#242). */
export type Cartesian = Extract<ResolvedCommand, { command: "cartesian.add" }>;

/** The directions of a Cartesian constraint, the indices of its base vectors. */
export const DIRECTIONS = ["1", "2", "3"] as const;

/** The second base vector of a 3D model by default. */
export const E2 = [0, 1, 0] as const;

/** The tolerance of orthogonal base vectors, like np.allclose() of FElupe. */
export const TOLERANCE = 1e-8;

/** The length of a vector. */
export const norm = (v: readonly number[]) => Math.hypot(...v);

/** A vector of length one (undefined for a vector of zero length). */
export function unit(v: readonly number[]): number[] | undefined {
  const length = norm(v);
  return length === 0 ? undefined : v.map((x) => x / length);
}

const cross = (a: readonly number[], b: readonly number[]) => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];

/** The base vectors e1 and e2 as written, with the default of e2 (in 3D). */
export function vectors(c: Pick<Cartesian, "e1" | "e2">): [number[], number[]] {
  return [[...c.e1].map(Number), [...(c.e2 ?? E2)].map(Number)];
}

/** Whether two base vectors (of non-zero length) are orthogonal. */
export function orthogonal(e1: readonly number[], e2: readonly number[]) {
  const a = unit(e1) ?? [0, 0, 0];
  const b = unit(e2) ?? [0, 0, 0];
  return Math.abs(a[0] * b[0] + a[1] * b[1] + a[2] * b[2]) <= TOLERANCE;
}

/**
 * The normalized base vectors of a Cartesian constraint as rows: e1, e2 and e3 of a
 * 3D model, e1 and e1 turned by 90° about z of a 2D model (two components each).
 * Undefined if a base vector has zero length.
 */
export function baseVectors(
  c: Pick<Cartesian, "e1" | "e2">,
  dim = 3,
): number[][] | undefined {
  const [e1, e2] = vectors(c);
  if (dim === 2) {
    const u = unit(e1.slice(0, 2));
    return u && [u, [-u[1], u[0]]];
  }
  const a = unit(e1);
  const b = unit(e2);
  if (!a || !b) return undefined;
  return [a, b, unit(cross(a, b)) ?? [0, 0, 0]];
}

/**
 * The base vectors of a Cartesian constraint in 3D, padded with z of a 2D model,
 * e.g. for the symbols of the viewport. Undefined for a vector of zero length.
 */
export function directions3d(
  c: Pick<Cartesian, "e1" | "e2">,
  analysis: Analysis,
): number[][] | undefined {
  if (!is2d(analysis)) return baseVectors(c, 3);
  const rows = baseVectors(c, 2);
  return rows && [...rows.map((r) => [r[0], r[1], 0]), [0, 0, 1]];
}
