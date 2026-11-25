// Multi-point constraints in the viewport (#99): lines from the center point to the
// connected points, in the model and displaced in the results, and the points of a
// constraint that a boundary of the same components prescribes as well.
import { TOLERANCE } from "../core/cartesian";
import type { Command, MpcAdd } from "../core/resolved";
import type { ResultScene } from "../worker/protocol";
import { type BoundarySymbol, thinned } from "./boundaries";
import { AXIS_COLORS, FADED, type ViewColors } from "./palette";
import { AXES, selectedPoints } from "./pointsets";
import { arrowSegments, type Lines } from "./scene";

export type Point3 = [number, number, number];

/** A constraint: its center point and its connected points (three coordinates each). */
export interface ConstraintShape {
  name: string;
  center: Point3;
  points: Float64Array;
}

const isConstraint = (c: Command): c is MpcAdd => c.command === "mpc.add";

/** The points of a point set or of a control point (#94). */
function pointsOf(
  name: string,
  commands: readonly Command[],
  nodes: readonly Float64Array[],
): Float64Array {
  const c = commands.find((c) => c.name === name);
  if (c?.command === "point.add") return Float64Array.from(c.coordinates);
  if (c?.command === "pointset.add") return selectedPoints(c.select, nodes);
  return new Float64Array();
}

/**
 * The constraints of a command list with their points: the center point must be one
 * point (a control point or a point set of one node).
 */
export function constraintShapes(
  commands: readonly Command[],
  nodes: readonly Float64Array[],
): ConstraintShape[] {
  return commands.filter(isConstraint).flatMap((c) => {
    const center = pointsOf(c.center, commands, nodes);
    if (center.length !== 3) return [];
    return [
      {
        name: c.name,
        center: [center[0], center[1], center[2]] as Point3,
        points: pointsOf(c.points, commands, nodes),
      },
    ];
  });
}

/**
 * The lines of the constraints: from the center point to every connected point
 * (thinned out for many points, like the symbols of the boundaries); the selected
 * one is highlighted, and those that are off in a selected step are faded (#393).
 * `place` moves a point, e.g. by the displacement of a result, and `clip` gives the
 * visible part of a line of the undeformed model (#395), from 0 at the center
 * point to 1 at the connected point, none if it is hidden.
 */
export function constraintLines(
  shapes: readonly ConstraintShape[],
  {
    hidden = new Set<string>(),
    selected,
    colors,
    place = (p: Point3) => p,
    clip,
    faded = new Set<string>(),
  }: {
    hidden?: ReadonlySet<string>;
    selected?: string;
    /** The colors of the view in its theme (#375). */
    colors: ViewColors;
    /** What is off in a selected step, drawn faded (#393). */
    faded?: ReadonlySet<string>;
    place?: (point: Point3) => Point3;
    clip?: (a: Point3, b: Point3) => readonly [number, number] | undefined;
  },
): Lines[] {
  const lines: Lines[] = [];
  for (const shape of shapes) {
    if (hidden.has(shape.name)) continue;
    const points = thinned(shape.points);
    const center = place(shape.center);
    const segments: number[] = [];
    for (let p = 0; p < points.length; p += 3) {
      const point: Point3 = [points[p], points[p + 1], points[p + 2]];
      const part = clip ? clip(shape.center, point) : [0, 1];
      if (!part) continue;
      const end = place(point);
      const at = (t: number) =>
        t === 0
          ? center
          : t === 1
            ? end
            : center.map((x, k) => x + t * (end[k] - x));
      segments.push(...at(part[0]), ...at(part[1]));
    }
    // all of it hidden
    if (clip && !segments.length) continue;
    const positions = Float32Array.from(segments);
    const chosen = shape.name === selected;
    lines.push({
      positions,
      color: chosen ? colors.highlight : colors.control,
      width: chosen ? 2 : 1,
      ...(faded.has(shape.name) ? { opacity: FADED } : {}),
    });
  }
  return lines;
}

/**
 * The points of a constraint that a boundary prescribes in a connected component
 * as well (over-constrained): per boundary, the number of points and the shared
 * components.
 */
export function overConstrained(
  constraint: MpcAdd,
  shape: ConstraintShape | undefined,
  symbols: readonly BoundarySymbol[],
): { boundary: string; points: number; components: string[] }[] {
  if (!shape) return [];
  const key = (a: ArrayLike<number>, p: number) =>
    `${a[p]} ${a[p + 1]} ${a[p + 2]}`;
  const connected = new Set<string>();
  for (let p = 0; p < shape.points.length; p += 3)
    connected.add(key(shape.points, p));
  const result: { boundary: string; points: number; components: string[] }[] =
    [];
  for (const symbol of symbols) {
    // the components of a Cartesian constraint are its directions (#421)
    if (symbol.axes) continue;
    const components = symbol.components
      .map((k) => AXES[k])
      .filter((a) => constraint.constrained.includes(a));
    if (!components.length) continue;
    let points = 0;
    for (let p = 0; p < symbol.points.length; p += 3)
      if (connected.has(key(symbol.points, p))) points++;
    if (points) result.push({ boundary: symbol.owner, points, components });
  }
  return result;
}

/**
 * The nodes of the surfaces of a result (exact enough to select point sets) and a
 * function that moves a point by the scaled displacement of the nearest node; the
 * control points move with their own displacement. Of a cut scene, the nodes of the
 * whole outer surfaces (#395).
 */
export function resultPlacement(
  scene: ResultScene,
  scale: number,
): { nodes: Float64Array[]; place: (point: Point3) => Point3 } {
  const nodes: Float64Array[] = [];
  const moves: Float64Array[] = [];
  for (const s of scene.surfaces) {
    if (s.uncut) {
      nodes.push(Float64Array.from(s.uncut.positions));
      moves.push(Float64Array.from(s.uncut.displacement));
      continue;
    }
    const kept: number[] = [];
    for (let p = 0; p < s.nodes.length; p++) if (s.nodes[p] >= 0) kept.push(p);
    const at = new Float64Array(3 * kept.length);
    const move = new Float64Array(3 * kept.length);
    kept.forEach((p, i) => {
      for (let k = 0; k < 3; k++) {
        at[3 * i + k] = s.positions[3 * p + k];
        move[3 * i + k] = s.displacement[3 * p + k];
      }
    });
    nodes.push(at);
    moves.push(move);
  }
  const controls = scene.points ?? [];
  const place = (point: Point3): Point3 => {
    const control = controls.find((c) =>
      c.position.every(
        (x, k) => Math.abs(x - point[k]) <= 1e-9 * (1 + Math.abs(x)),
      ),
    );
    if (control)
      return point.map((x, k) => x + scale * control.displacement[k]) as Point3;
    let best = Infinity;
    let move: Point3 = [0, 0, 0];
    nodes.forEach((at, a) => {
      for (let p = 0; p < at.length; p += 3) {
        const d =
          (at[p] - point[0]) ** 2 +
          (at[p + 1] - point[1]) ** 2 +
          (at[p + 2] - point[2]) ** 2;
        if (d < best) {
          best = d;
          move = [moves[a][p], moves[a][p + 1], moves[a][p + 2]];
        }
      }
    });
    return point.map((x, k) => x + scale * move[k]) as Point3;
  };
  return { nodes, place };
}

/**
 * The coordinate system of the selected Cartesian constraint (#421): arrows of its
 * base vectors e1, e2 and e3 from the center of its points, in the colors of the
 * axes x, y and z (of a 2D model e1 and e2). None for another object.
 */
export function frameLines(
  symbols: readonly BoundarySymbol[],
  selected: string | undefined,
  size: number,
  dim = 3,
): Lines[] {
  const symbol = symbols.find((s) => s.owner === selected && s.axes);
  if (!symbol?.axes || !symbol.points.length) return [];
  const center: Point3 = [0, 0, 0];
  const count = symbol.points.length / 3;
  for (let p = 0; p < symbol.points.length; p += 3)
    for (let k = 0; k < 3; k++) center[k] += symbol.points[p + k] / count;
  return symbol.axes.slice(0, dim).map((axis, k) => ({
    positions: arrowSegments({
      origins: Float32Array.from(center),
      directions: Float32Array.from(axis.map((x) => 0.15 * size * x)),
    }),
    color: AXIS_COLORS[k],
    width: 3,
  }));
}

/**
 * The points of a Cartesian constraint (#421) that a boundary, a load case or a
 * symmetry plane prescribes in a component that is not normal to the constrained
 * directions (over-constrained): per boundary, the number of points and the
 * components, like `overConstrained()` of a multi-point constraint.
 */
export function cartesianOverlaps(
  constraint: string,
  symbols: readonly BoundarySymbol[],
): { boundary: string; points: number; components: string[] }[] {
  const own = symbols.find((s) => s.owner === constraint && s.axes);
  if (!own?.axes) return [];
  const directions = own.components.map((k) => own.axes![k]);
  const key = (a: ArrayLike<number>, p: number) =>
    `${a[p]} ${a[p + 1]} ${a[p + 2]}`;
  const held = new Set<string>();
  for (let p = 0; p < own.points.length; p += 3) held.add(key(own.points, p));
  const result: { boundary: string; points: number; components: string[] }[] =
    [];
  for (const symbol of symbols) {
    if (symbol.axes) continue;
    const components = symbol.components
      .filter((k) => directions.some((d) => Math.abs(d[k]) > TOLERANCE))
      .map((k) => AXES[k]);
    if (!components.length) continue;
    let points = 0;
    for (let p = 0; p < symbol.points.length; p += 3)
      if (held.has(key(symbol.points, p))) points++;
    if (points) result.push({ boundary: symbol.owner, points, components });
  }
  return result;
}
