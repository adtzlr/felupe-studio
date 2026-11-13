// Point loads in the viewport (#100): an arrow at every point of the load, in the
// direction of its force.
import type { Command, LoadAdd } from "../core/commands";
import { thinned } from "./boundaries";
import { FORCE_COLOR } from "./palette";
import { selectedPoints } from "./pointsets";
import { arrowSegments, type Lines } from "./scene";

/**
 * The points of a point set or of a control point (#94), or the reference point of
 * a rigid surface (#219).
 */
function pointsOf(
  name: string,
  commands: readonly Command[],
  nodes: readonly Float64Array[],
): Float64Array {
  const c = commands.find((c) => c.name === name);
  if (c?.command === "point.add" || c?.command === "rigid.add")
    return Float64Array.from(c.coordinates);
  if (c?.command === "pointset.add") return selectedPoints(c.select, nodes);
  return new Float64Array();
}

/**
 * The arrows of the point loads: at every point (thinned out for many points), in
 * the direction of the force, with a length relative to the size of the model; the
 * selected load is highlighted.
 */
export function loadLines(
  commands: readonly Command[],
  nodes: readonly Float64Array[],
  {
    size,
    hidden = new Set<string>(),
    selected,
    highlight,
  }: {
    size: number;
    hidden?: ReadonlySet<string>;
    selected?: string;
    highlight: string;
  },
): Lines[] {
  const lines: Lines[] = [];
  for (const load of commands.filter(
    (c): c is LoadAdd => c.command === "load.add",
  )) {
    if (hidden.has(load.name)) continue;
    const length = Math.hypot(...load.force);
    if (!(length > 0)) continue;
    const origins = thinned(pointsOf(load.points, commands, nodes));
    const d = load.force.map((f) => (f / length) * 0.12 * size);
    const directions = new Float32Array(origins.length);
    for (let p = 0; p < origins.length; p += 3) directions.set(d, p);
    const chosen = load.name === selected;
    lines.push({
      positions: arrowSegments({ origins, directions }),
      color: chosen ? highlight : FORCE_COLOR,
      width: chosen ? 3 : 2,
    });
  }
  return lines;
}
