// The force-displacement curve of a job with a curve boundary (#29): the quantities of
// its axes (#197), the scales and ticks of the chart and the values as CSV.
import type { JobResult } from "../worker/protocol";
import type { Command } from "./commands";
import { type Finished, largestAxis, stepOf } from "./results";
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

/**
 * A quantity of an axis of the curve (#197): a component of the displacement (or of
 * the rotation) or of the reaction force (or of the moment) of the curve boundary,
 * or the substep.
 */
export type Series = "ux" | "uy" | "uz" | "Fx" | "Fy" | "Fz" | "substep";

export const SERIES: readonly Series[] = [
  "ux",
  "uy",
  "uz",
  "Fx",
  "Fy",
  "Fz",
  "substep",
];

/**
 * The series of the curve of a job: the components of its displacements and
 * forces (two in a 2D model, #175) and the substep.
 */
export function seriesOf(result: JobResult | undefined): Series[] {
  const count = result?.x?.[0]?.length ?? 3;
  return SERIES.filter(
    (s) =>
      s === "substep" || AXES.indexOf(s[1] as (typeof AXES)[number]) < count,
  );
}

/** The label of a series: its quantity, its symbol, its component and its unit. */
export interface SeriesLabel {
  /** e.g. Displacement, Force, Rotation, Moment or Substep. */
  quantity: string;
  /** e.g. u, F, φ or M; empty for the substep. */
  symbol: string;
  /** x, y or z; empty for the substep. */
  component: string;
  unit?: string;
}

/** The label of a series of the curve of a job (the moment of a rotation point). */
export function seriesLabel(series: Series, q: CurveQuantities): SeriesLabel {
  if (series === "substep") {
    return { quantity: "Substep", symbol: "", component: "" };
  }
  const component = series[1];
  return series[0] === "u"
    ? { quantity: q.x, symbol: q.u, component, unit: q.uUnit }
    : { quantity: q.y, symbol: q.f, component, unit: q.fUnit };
}

/** The short name of a series, e.g. ux, Fz, φx or Substep. */
export function seriesName(series: Series, q: CurveQuantities): string {
  const label = seriesLabel(series, q);
  return label.symbol ? `${label.symbol}${label.component}` : label.quantity;
}

/** The value of a series at a substep (counted from 0), null if not finite. */
export function seriesValue(
  result: JobResult,
  series: Series,
  index: number,
): number | null {
  if (series === "substep") return index + 1;
  const row = series[0] === "u" ? result.x?.[index] : result.y?.[index];
  const value = row?.[AXES.indexOf(series[1] as (typeof AXES)[number])];
  return value === null || value === undefined || !Number.isFinite(value)
    ? null
    : value;
}

/**
 * The quantities of the axes by default: the force over the displacement of the
 * component with the largest displacement of the last substep.
 */
export function defaultSeries(result: JobResult): [Series, Series] {
  const axis = AXES[largestAxis(result)] ?? "x";
  return [`u${axis}`, `F${axis}`];
}

/**
 * The values of the quantities of the axes of the curve at a substep (counted from
 * 1), without the substep itself, e.g. ux and Fx for the results panel.
 */
export function seriesValues(
  result: JobResult | undefined,
  substep: number,
  series: readonly Series[],
  q: CurveQuantities,
): { label: SeriesLabel; value: number }[] {
  if (!result || !hasCurve(result)) return [];
  return series
    .filter((s, i) => s !== "substep" && series.indexOf(s) === i)
    .flatMap((s) => {
      const value = seriesValue(result, s, substep - 1);
      return value === null ? [] : [{ label: seriesLabel(s, q), value }];
    });
}

/** A point of the curve per substep (null for a non-finite value). */
export interface CurvePoint {
  substep: number;
  /** The value of the horizontal axis. */
  u: number | null;
  /** The value of the vertical axis. */
  f: number | null;
}

/** The points of the curve of a job with the quantities of its axes. */
export function curveOf(result: JobResult, x: Series, y: Series): CurvePoint[] {
  return (result.x ?? []).map((_, i) => ({
    substep: i + 1,
    u: seriesValue(result, x, i),
    f: seriesValue(result, y, i),
  }));
}

/** The options of an axis of the curve (#197). */
export interface CurveAxis {
  scale: "linear" | "log";
  /** Plot the negative values, e.g. a compression as positive values. */
  negate: boolean;
  /** A fixed range (both limits), else the range of the values. */
  min?: number;
  max?: number;
}

export interface CurveSettings {
  x: CurveAxis;
  y: CurveAxis;
}

export const DEFAULT_CURVE_AXIS: CurveAxis = { scale: "linear", negate: false };

export const DEFAULT_CURVE: CurveSettings = {
  x: DEFAULT_CURVE_AXIS,
  y: DEFAULT_CURVE_AXIS,
};

/** The fixed range of an axis, if it is valid (min < max, positive on a log scale). */
export function fixedRange(axis: CurveAxis): [number, number] | undefined {
  const { min, max } = axis;
  if (min === undefined || max === undefined || !(min < max)) return undefined;
  if (axis.scale === "log" && !(min > 0)) return undefined;
  return [min, max];
}

/**
 * A value as it is plotted on an axis: negated, and on a log scale the logarithm of
 * its absolute value (none for zero).
 */
export function plotted(value: number | null, axis: CurveAxis): number | null {
  if (value === null) return null;
  const v = axis.negate ? -value : value;
  if (axis.scale === "linear") return v;
  return v === 0 ? null : Math.log10(Math.abs(v));
}

/** The points of a curve as they are plotted on its axes. */
export function plottedPoints(
  points: readonly CurvePoint[],
  settings: CurveSettings,
): CurvePoint[] {
  return points.map((p) => ({
    substep: p.substep,
    u: plotted(p.u, settings.x),
    f: plotted(p.f, settings.y),
  }));
}

/**
 * The ticks of a log axis: exponents of ten that cover a range of exponents, at
 * most about seven of them.
 */
export function logTicks(min: number, max: number): number[] {
  if (!Number.isFinite(min) || !Number.isFinite(max)) return [0, 1];
  const low = Math.floor(min + 1e-9);
  let high = Math.ceil(max - 1e-9);
  if (high <= low) high = low + 1;
  const step = Math.max(1, Math.ceil((high - low) / 6));
  const ticks: number[] = [];
  for (let t = low; t < high + step; t += step) ticks.push(t);
  return ticks;
}

/**
 * The domain and the ticks of an axis of plotted values: round ticks that cover the
 * values (with zero on a linear scale) or the fixed range; on a log scale the
 * exponents of ten.
 */
export function axisTicks(
  values: readonly number[],
  axis: CurveAxis,
): { domain: [number, number]; ticks: number[] } {
  const range = fixedRange(axis);
  const within = (ticks: number[], [low, high]: [number, number]) =>
    ticks.filter((t) => t >= low - 1e-9 && t <= high + 1e-9);
  if (axis.scale === "log") {
    if (range) {
      const domain: [number, number] = [
        Math.log10(range[0]),
        Math.log10(range[1]),
      ];
      return { domain, ticks: within(logTicks(...domain), domain) };
    }
    const ticks = logTicks(Math.min(...values), Math.max(...values));
    return { domain: [ticks[0], ticks[ticks.length - 1]], ticks };
  }
  if (range)
    return { domain: range, ticks: within(niceTicks(...range), range) };
  const ticks = niceTicks(Math.min(0, ...values), Math.max(0, ...values));
  return { domain: [ticks[0], ticks[ticks.length - 1]], ticks };
}

const KEY = "felupe-studio.curve";

/** An axis of settings kept in the browser, checked. */
function axisOf(value: unknown): CurveAxis {
  const v = (value ?? {}) as Partial<CurveAxis>;
  const axis: CurveAxis = {
    scale: v.scale === "log" ? "log" : "linear",
    negate: v.negate === true,
  };
  if (typeof v.min === "number" && typeof v.max === "number") {
    axis.min = v.min;
    axis.max = v.max;
  }
  return axis;
}

/** The options of the axes kept in the browser, or the defaults. */
export function loadCurve(storage?: Storage): CurveSettings {
  try {
    const text = (storage ?? localStorage).getItem(KEY);
    if (!text) return DEFAULT_CURVE;
    const value = JSON.parse(text) as Partial<CurveSettings>;
    return { x: axisOf(value.x), y: axisOf(value.y) };
  } catch {
    return DEFAULT_CURVE;
  }
}

/** Keep the options of the axes in the browser (where it can). */
export function saveCurve(settings: CurveSettings, storage?: Storage) {
  try {
    (storage ?? localStorage).setItem(KEY, JSON.stringify(settings));
  } catch {
    // e.g. storage disabled: the settings last for the session
  }
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

/** Whether the finite values of the horizontal axis only grow or only shrink. */
export function monotonic(points: readonly CurvePoint[]): boolean {
  const values = finitePoints(points).map((p) => p.u);
  const rising = values.every((v, i) => i === 0 || v >= values[i - 1]);
  const falling = values.every((v, i) => i === 0 || v <= values[i - 1]);
  return rising || falling;
}

/**
 * The index of the point nearest to a position in pixels of the chart: by the
 * horizontal axis if its values are monotonic, else by the distance in the plane
 * (e.g. a curve of uy over ux).
 */
export function nearest(
  points: readonly CurvePoint[],
  px: number,
  x: (u: number) => number,
  py?: number,
  y?: (f: number) => number,
): number | undefined {
  const plane = py !== undefined && y !== undefined && !monotonic(points);
  let best: number | undefined;
  let distance = Infinity;
  points.forEach((point, i) => {
    if (!finite(point)) return;
    const d = plane
      ? Math.hypot(x(point.u) - px, y(point.f) - py)
      : Math.abs(x(point.u) - px);
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
  // two components in a 2D model (#175)
  const axes = AXES.slice(0, result?.x?.[0]?.length ?? 3);
  const header = [
    "substep",
    "step",
    ...axes.map((a) => withUnit(`${u}_${a}`, q.uUnit)),
    ...axes.map((a) => withUnit(`${f}_${a}`, q.fUnit)),
  ];
  const rows = (result?.x ?? []).map((x, i) => {
    const y = result?.y?.[i] ?? [];
    const cell = (value: number | null | undefined) =>
      value === null || value === undefined ? "" : String(value);
    return [
      String(i + 1),
      stepOf(run, job, i + 1).name,
      ...axes.map((_, a) => cell(x[a])),
      ...axes.map((_, a) => cell(y[a])),
    ].join(",");
  });
  return [header.join(","), ...rows].join("\n") + "\n";
}
