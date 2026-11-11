// Multi-point constraints in the viewport (#99): lines from the center point to the
// connected points, in the model and displaced in the results, and the points of a
// constraint that a boundary of the same components prescribes as well.
import type { Command, MpcAdd } from "../core/commands";
import type { ResultScene } from "../worker/protocol";
import { type BoundarySymbol, thinned } from "./boundaries";
import { CONTROL_COLOR } from "./palette";
import { AXES, selectedPoints } from "./pointsets";
import type { Lines } from "./scene";

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
 * one is highlighted. `place` moves a point, e.g. by the displacement of a result.
 */
export function constraintLines(
  shapes: readonly ConstraintShape[],
  {
    hidden = new Set<string>(),
    selected,
    highlight,
    place = (p: Point3) => p,
  }: {
    hidden?: ReadonlySet<string>;
    selected?: string;
    highlight: string;
    place?: (point: Point3) => Point3;
  },
): Lines[] {
  const lines: Lines[] = [];
  for (const shape of shapes) {
    if (hidden.has(shape.name)) continue;
    const points = thinned(shape.points);
    const center = place(shape.center);
    const positions = new Float32Array(2 * points.length);
    for (let p = 0, s = 0; p < points.length; p += 3, s += 6) {
      positions.set(center, s);
      positions.set(place([points[p], points[p + 1], points[p + 2]]), s + 3);
    }
    const chosen = shape.name === selected;
    lines.push({
      positions,
      color: chosen ? highlight : CONTROL_COLOR,
      width: chosen ? 2 : 1,
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
 * control points move with their own displacement.
 */
export function resultPlacement(
  scene: ResultScene,
  scale: number,
): { nodes: Float64Array[]; place: (point: Point3) => Point3 } {
  const nodes: Float64Array[] = [];
  const moves: Float64Array[] = [];
  for (const s of scene.surfaces) {
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
