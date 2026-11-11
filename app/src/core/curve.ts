// The force-displacement curve of a job with a curve boundary (#29): the series of a
// component, the scales and ticks of the chart and the values as CSV.
import type { JobResult } from "../worker/protocol";
import type { Command } from "./commands";
import { type Finished, stepOf } from "./results";
import { rotationPoints, unitOf, unitsOf, withUnit } from "./units";

export { largestAxis } from "./results";
export { rotationPoints } from "./units";

export const AXES = ["x", "y", "z"] as const;

/** What a curve shows, with the symbols and the units of its axes. */
export interface CurveQuantities {
  title: string;
  /** The moment over the rotation of a rotation point (#98). */
  moment: boolean;
  /** The quantity and the symbol of the horizontal axis, e.g. Displacement u. */
  x: string;
  u: string;
  /** The quantity and the symbol of the vertical axis, e.g. Force F. */
  y: string;
  f: string;
  /** The units of the axes, if the model has units (#132); rotations are in rad. */
  uUnit?: string;
  fUnit?: string;
}

const FORCE = {
  title: "Force–displacement",
  moment: false,
  x: "Displacement",
  u: "u",
  y: "Force",
  f: "F",
} as const;

const MOMENT = {
  title: "Moment–rotation",
  moment: true,
  x: "Rotation",
  u: "φ",
  y: "Moment",
  f: "M",
} as const;

/**
 * What the curve of a job shows: the force over the displacement, or the moment
 * over the rotation for a boundary of a rotation point of a constraint (#98), with
 * the units of the model (#132).
 */
export function curveQuantities(
  commands: readonly Command[],
  job: string,
): CurveQuantities {
  const curve = commands.find((c) => c.command === "job.add" && c.name === job);
  const name = curve?.command === "job.add" ? curve.curve : undefined;
  const boundary = commands.find(
    (c) => c.command === "boundary.add" && c.name === name,
  );
  const moment =
    boundary?.command === "boundary.add" &&
    rotationPoints(commands).has(boundary.pointset);
  const units = unitsOf(commands);
  return moment
    ? {
        ...MOMENT,
        uUnit: unitOf("rotation", units),
        fUnit: unitOf("moment", units),
      }
    : {
        ...FORCE,
        uUnit: unitOf("displacement", units),
        fUnit: unitOf("force", units),
      };
}

/** The curve of a job, if it has one. */
export const hasCurve = (result: JobResult | undefined): boolean =>
  !!result?.x?.length && !!result.y?.length;

/** A point of the curve per substep (null for a non-finite value). */
export interface CurvePoint {
  substep: number;
  u: number | null;
  f: number | null;
}

export function curveOf(result: JobResult, axis: number): CurvePoint[] {
  const x = result.x ?? [];
  const y = result.y ?? [];
  return x.map((value, i) => ({
    substep: i + 1,
    u: value[axis] ?? null,
    f: y[i]?.[axis] ?? null,
  }));
}

const finite = (
  point: CurvePoint,
): point is CurvePoint & {
  u: number;
  f: number;
} => point.u !== null && point.f !== null;

/** The finite points of a curve. */
export const finitePoints = (points: readonly CurvePoint[]) =>
  points.filter(finite);

/**
 * Round ticks (1, 2 or 5 times a power of ten) that cover a range, about `count` of
 * them. A range of zero width is widened around its value.
 */
export function niceTicks(min: number, max: number, count = 5): number[] {
  if (!Number.isFinite(min) || !Number.isFinite(max)) return [0, 1];
  if (min === max) {
    const pad = Math.abs(min) || 1;
    [min, max] = [min - pad, max + pad];
  }
  // the step nearest to the raw step (like the ticks of d3)
  const raw = (max - min) / Math.max(count - 1, 1);
  const power = 10 ** Math.floor(Math.log10(raw));
  const error = raw / power;
  const step =
    power *
    (error >= Math.sqrt(50)
      ? 10
      : error >= Math.sqrt(10)
        ? 5
        : error >= Math.sqrt(2)
          ? 2
          : 1);
  const first = Math.floor(min / step + 1e-9) * step;
  const ticks: number[] = [];
  for (let t = first; t <= max + step * (1 - 1e-9); t += step) {
    // avoid -0 and floating noise like 0.30000000000000004
    ticks.push(Number((Math.abs(t) < step * 1e-9 ? 0 : t).toPrecision(12)));
  }
  return ticks;
}

/** A linear scale from a domain to a range of pixels. */
export function scale(
  [d0, d1]: [number, number],
  [r0, r1]: [number, number],
): (value: number) => number {
  const k = d1 === d0 ? 0 : (r1 - r0) / (d1 - d0);
  return (value) => r0 + (value - d0) * k;
}

/** The SVG path of a curve; a non-finite value breaks the line. */
export function linePath(
  points: readonly CurvePoint[],
  x: (u: number) => number,
  y: (f: number) => number,
): string {
  let path = "";
  let pen = false;
  for (const point of points) {
    if (!finite(point)) {
      pen = false;
      continue;
    }
    path += `${pen ? "L" : "M"}${x(point.u).toFixed(1)},${y(point.f).toFixed(1)}`;
    pen = true;
  }
  return path;
}

/** The index of the point nearest to a displacement, in pixels of the chart. */
export function nearest(
  points: readonly CurvePoint[],
  px: number,
  x: (u: number) => number,
): number | undefined {
  let best: number | undefined;
  let distance = Infinity;
  points.forEach((point, i) => {
    if (!finite(point)) return;
    const d = Math.abs(x(point.u) - px);
    if (d < distance) [best, distance] = [i, d];
  });
  return best;
}

/**
 * The curve of a job as CSV: substep, step and all components (empty if non-finite),
 * with the units of the model in the header (#132).
 */
export function curveCsv(run: Finished, job: string): string {
  const result = run.results[job];
  const q = curveQuantities(run.commands, job);
  const [u, f] = q.moment ? ["phi", "M"] : ["u", "F"];
  const header = [
    "substep",
    "step",
    ...AXES.map((a) => withUnit(`${u}_${a}`, q.uUnit)),
    ...AXES.map((a) => withUnit(`${f}_${a}`, q.fUnit)),
  ];
  const rows = (result?.x ?? []).map((x, i) => {
    const y = result?.y?.[i] ?? [];
    const cell = (value: number | null | undefined) =>
      value === null || value === undefined ? "" : String(value);
    return [
      String(i + 1),
      stepOf(run, job, i + 1).name,
      ...AXES.map((_, a) => cell(x[a])),
      ...AXES.map((_, a) => cell(y[a])),
    ].join(",");
  });
  return [header.join(","), ...rows].join("\n") + "\n";
}
