// The force-displacement curve of a job with a curve boundary (#29): the series of a
// component, the scales and ticks of the chart and the values as CSV.
import type { JobResult } from "../worker/protocol";
import { type Finished, stepOf } from "./results";

export { largestAxis } from "./results";

export const AXES = ["x", "y", "z"] as const;

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

/** The curve of a job as CSV: substep, step and all components (empty if non-finite). */
export function curveCsv(run: Finished, job: string): string {
  const result = run.results[job];
  const header = [
    "substep",
    "step",
    ...AXES.map((a) => `u_${a}`),
    ...AXES.map((a) => `F_${a}`),
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
