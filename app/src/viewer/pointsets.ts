// Point sets in the viewport: the points a point set selects by a coordinate, at a
// bound of the meshes, on a cylinder or by the coordinates of nodes (a preview on the
// nodes of the drawn meshes, like `np.isclose` in the generated script), and the
// point set of a picked face normal to x, y or z.
import type { Command, PointSetAdd } from "../core/commands";
import { toName } from "../core/importmesh";
import type { Vec3 } from "./picking";
import type { Markers } from "./scene";

export const AXES = ["x", "y", "z"] as const;
export type Axis = (typeof AXES)[number];

export interface CoordinateSelect {
  axis: Axis;
  value: number;
  atol?: number;
}

/** The points at the smallest or largest coordinate of the meshes (#181). */
export interface BoundSelect {
  bound: "min" | "max";
  axis: Axis;
  atol?: number;
}

/** The default tolerances of the generated script (`np.isclose`). */
export const ATOL = 1e-8;
const RTOL = 1e-5;

export const isClose = (a: number, b: number, atol: number) =>
  Math.abs(a - b) <= atol + RTOL * Math.abs(b);

/** Whether the node at index `p` of an array is at a point (like `np.isclose`). */
const atPoint = (
  array: Float64Array,
  p: number,
  point: readonly number[],
  atol: number,
) => [0, 1, 2].every((k) => isClose(array[p + k], point[k], atol));

/**
 * The points of a point set by nodes that have no node of the drawn meshes; the
 * script raises an error for them (`points_at`).
 */
export function missingPoints(
  select: PointSetAdd["select"],
  nodes: readonly Float64Array[],
): number[][] {
  if (!("points" in select)) return [];
  const atol = select.atol ?? ATOL;
  return select.points.filter(
    (point) =>
      !nodes.some((array) => {
        for (let p = 0; p < array.length; p += 3)
          if (atPoint(array, p, point, atol)) return true;
        return false;
      }),
  );
}

/**
 * The points of the nodes (three coordinates each, without duplicates) that a point
 * set selects. Point ids refer to the merged mesh of the script and are not shown.
 */
export function selectedPoints(
  select: PointSetAdd["select"],
  nodes: readonly Float64Array[],
): Float64Array {
  if ("ids" in select) return new Float64Array();
  const selects = selector(select, nodes);
  if (!selects) return new Float64Array();
  const seen = new Set<string>();
  const result: number[] = [];
  for (const array of nodes) {
    for (let p = 0; p < array.length; p += 3) {
      if (!selects(array, p)) continue;
      const key = `${array[p]} ${array[p + 1]} ${array[p + 2]}`;
      if (seen.has(key)) continue;
      seen.add(key);
      result.push(array[p], array[p + 1], array[p + 2]);
    }
  }
  return Float64Array.from(result);
}

/** Whether the node at index `p` of an array is selected, like the script. */
type Selector = (array: Float64Array, p: number) => boolean;

function selector(
  select: Exclude<PointSetAdd["select"], { ids: number[] }>,
  nodes: readonly Float64Array[],
): Selector | undefined {
  const atol = select.atol ?? ATOL;
  if ("points" in select)
    return (array, p) =>
      select.points.some((point) => atPoint(array, p, point, atol));
  const k = AXES.indexOf(select.axis);
  if ("value" in select)
    return (array, p) => isClose(array[p + k], select.value, atol);
  if ("bound" in select) {
    // the bounds of the drawn meshes, which are those of the sections (#181)
    const [min, max] = range(nodes, k);
    if (!Number.isFinite(min)) return undefined;
    const value = select.bound === "min" ? min : max;
    return (array, p) => isClose(array[p + k], value, atol);
  }
  // on a cylinder: the distance to its axis in the plane normal to it (#181)
  const [i, j] = [0, 1, 2].filter((n) => n !== k);
  const center = select.center ?? [0, 0, 0];
  return (array, p) =>
    isClose(
      Math.hypot(array[p + i] - center[i], array[p + j] - center[j]),
      select.radius,
      atol,
    );
}

/**
 * A point set that selects nothing of the drawn meshes, by a plane, at a bound or on
 * a cylinder: probably a wrong coordinate or radius (points by nodes have their own
 * warning, see `missingPoints`).
 */
export const selectsNothing = (
  select: PointSetAdd["select"],
  nodes: readonly Float64Array[],
) =>
  nodes.length > 0 &&
  !("ids" in select) &&
  !("points" in select) &&
  selectedPoints(select, nodes).length === 0;

/**
 * The selection of a picked plane at the bound of the meshes, e.g. `z == max`
 * instead of `z == 25`, so that it follows a mesh whose size changes (#181); other
 * planes as they are.
 */
export function boundOf(
  select: CoordinateSelect,
  nodes: readonly Float64Array[],
): CoordinateSelect | BoundSelect {
  const [min, max] = range(nodes, AXES.indexOf(select.axis));
  const atol = select.atol ?? ATOL;
  const bound = isClose(min, select.value, atol)
    ? "min"
    : isClose(max, select.value, atol)
      ? "max"
      : undefined;
  if (!bound) return select;
  return {
    bound,
    axis: select.axis,
    ...(select.atol !== undefined ? { atol: select.atol } : {}),
  };
}

/**
 * The distance of a hit (on float32 coordinates) to the nodes in its plane: relative
 * to the size of the model and to the magnitude of its coordinates.
 */
export function tolerance(nodes: readonly Float64Array[]): number {
  let size = 0;
  let magnitude = 0;
  for (const k of [0, 1, 2]) {
    const [min, max] = range(nodes, k);
    if (!Number.isFinite(min)) continue;
    size = Math.hypot(size, max - min);
    magnitude = Math.max(magnitude, Math.abs(min), Math.abs(max));
  }
  return 1e-6 * size + 1e-6 * magnitude || 1e-9;
}

/** The bounds of the nodes along an axis. */
function range(nodes: readonly Float64Array[], k: number): [number, number] {
  let min = Infinity;
  let max = -Infinity;
  for (const array of nodes) {
    for (let p = k; p < array.length; p += 3) {
      min = Math.min(min, array[p]);
      max = Math.max(max, array[p]);
    }
  }
  return [min, max];
}

/**
 * The selection of the plane of a picked face normal to an axis. The coordinate is
 * taken from the nodes in the plane (exact, not the coordinate of the hit), with a
 * tolerance that covers their spread.
 */
export function planeSelect(
  k: 0 | 1 | 2,
  point: Vec3,
  nodes: readonly Float64Array[],
): CoordinateSelect {
  const near = tolerance(nodes);
  const counts = new Map<number, number>();
  for (const array of nodes) {
    for (let p = k; p < array.length; p += 3) {
      if (Math.abs(array[p] - point[k]) <= near) {
        counts.set(array[p], (counts.get(array[p]) ?? 0) + 1);
      }
    }
  }
  const axis = AXES[k];
  if (counts.size === 0) {
    return { axis, value: Number(point[k].toPrecision(7)) };
  }
  // the most frequent coordinate, and the largest deviation of the others
  const value = [...counts].sort((a, b) => b[1] - a[1])[0][0];
  const spread = Math.max(
    ...[...counts.keys()].map((v) => Math.abs(v - value)),
  );
  if (spread === 0 || isClose(value + spread, value, ATOL))
    return { axis, value };
  const atol = 10 ** Math.ceil(Math.log10(2 * spread));
  return { axis, value, atol };
}

/** A name for the point set of a plane, e.g. `x_min`, `x_max` or `y_0_5`. */
export function planeName(
  select: CoordinateSelect,
  nodes: readonly Float64Array[],
  commands: readonly Command[],
): string {
  const k = AXES.indexOf(select.axis);
  const [min, max] = range(nodes, k);
  const atol = select.atol ?? ATOL;
  const text = isClose(min, select.value, atol)
    ? `${select.axis}_min`
    : isClose(max, select.value, atol)
      ? `${select.axis}_max`
      : `${select.axis}_${select.value}`;
  return toName(text, new Set(commands.map((c) => c.name)), "points");
}

/** Markers with a dark outline, visible on every color of the meshes. */
export function outlined(
  points: Float64Array,
  color: string,
  size = 7,
): Markers[] {
  if (points.length === 0) return [];
  const positions = Float32Array.from(points);
  return [
    { positions, color: "#11151c", size: size + 4 },
    { positions, color, size },
  ];
}

/**
 * The exact coordinates (of the nodes of the meshes) of a picked node: the drawn
 * nodes have float32 coordinates (#93).
 */
export function exactNode(
  point: readonly number[],
  nodes: readonly Float64Array[],
): [number, number, number] {
  let best: [number, number, number] = [point[0], point[1], point[2]];
  let distance = Infinity;
  for (const array of nodes) {
    for (let p = 0; p < array.length; p += 3) {
      const d = Math.hypot(
        array[p] - point[0],
        array[p + 1] - point[1],
        array[p + 2] - point[2],
      );
      if (d < distance) {
        distance = d;
        best = [array[p], array[p + 1], array[p + 2]];
      }
    }
  }
  return best;
}

/** A name for a point set of picked nodes, e.g. `node` or `nodes_2`. */
export function nodesName(count: number, commands: readonly Command[]): string {
  const names = new Set(commands.map((c) => c.name));
  return toName(count === 1 ? "node" : "nodes", names, "points");
}

/** The center of the bounding box of points (three coordinates each), #96. */
export function centerOf(points: ArrayLike<number>): [number, number, number] {
  const center: [number, number, number] = [0, 0, 0];
  for (const k of [0, 1, 2]) {
    let min = Infinity;
    let max = -Infinity;
    for (let p = k; p < points.length; p += 3) {
      min = Math.min(min, points[p]);
      max = Math.max(max, points[p]);
    }
    // without float noise of the mean, e.g. 0.5 instead of 0.49999999999999994
    center[k] = min <= max ? +((min + max) / 2).toPrecision(12) : 0;
  }
  return center;
}

/** A name for a control point at the center of something, e.g. `control_right`. */
export function controlName(
  of: string | undefined,
  commands: readonly Command[],
): string {
  const names = new Set(commands.map((c) => c.name));
  return toName(of ? `control_${of}` : "control", names, "control");
}
