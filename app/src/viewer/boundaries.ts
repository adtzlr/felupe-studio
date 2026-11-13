// Boundaries and load cases in the viewport (#82): the points and the constrained
// components of every boundary of the script, with its final prescribed value, and
// the lines that draw them. The boundaries of the load cases follow `fem.dof`
// (`symmetry`, `uniaxial`, `biaxial`, `shear`) on the nodes of the drawn meshes; a
// test compares them with FElupe (`boundaries.fixture.json`).
import { analysisOf, is2d } from "../core/analysis";
import type { Command } from "../core/commands";
import { type Loadcase, LOADCASE_DEFAULTS } from "../core/loadcases";
import { type Symmetry, symmetryPlanes } from "../core/symmetry";
import { MARKER_COLOR } from "./palette";
import { AXES, selectedPoints } from "./pointsets";
import { arrowSegments, type Lines } from "./scene";

/** A boundary of the script: the points of the nodes and its components. */
export interface BoundarySymbol {
  /** The command: a boundary, a load case or a symmetry (#186). */
  owner: string;
  /** The name of the boundary in the script, e.g. `move` or `shear/bottom`. */
  name: string;
  /** Three coordinates per point. */
  points: Float64Array;
  /** The constrained components (0, 1, 2). */
  components: number[];
  /** The prescribed value at the end of the last step that ramps it (else static). */
  value: number;
}

const RTOL = 1e-5;
const ATOL = 1e-8;
const isClose = (a: number, b: number) =>
  Math.abs(a - b) <= ATOL + RTOL * Math.abs(b);

/** The nodes (without duplicates) on a plane `x_k = value`, like `np.isclose`. */
function plane(nodes: readonly Float64Array[], k: number, value: number) {
  const seen = new Set<string>();
  const result: number[] = [];
  for (const array of nodes) {
    for (let p = 0; p < array.length; p += 3) {
      if (!isClose(array[p + k], value)) continue;
      const key = `${array[p]} ${array[p + 1]} ${array[p + 2]}`;
      if (seen.has(key)) continue;
      seen.add(key);
      result.push(array[p], array[p + 1], array[p + 2]);
    }
  }
  return Float64Array.from(result);
}

function bounds(nodes: readonly Float64Array[], k: number): [number, number] {
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

const others = (k: number) => [0, 1, 2].filter((j) => j !== k);

/** A boundary of a load case: a plane, its constrained components and its value. */
interface Part {
  key: string;
  axis: number;
  at: number;
  components: number[];
  value?: number;
}

const option = <K extends keyof typeof LOADCASE_DEFAULTS>(
  loadcase: Loadcase,
  key: K,
) =>
  ((loadcase as unknown as Record<string, unknown>)[key] ??
    LOADCASE_DEFAULTS[key]) as (typeof LOADCASE_DEFAULTS)[K];

/** The boundaries of a load case, like `fem.dof` with `move=0` (see codegen). */
export function loadcaseParts(
  loadcase: Loadcase,
  nodes: readonly Float64Array[],
): Part[] {
  const axisOf = (key: "axis" | "second" | "normal") =>
    AXES.indexOf(option(loadcase, key) as (typeof AXES)[number]);
  const sym = option(loadcase, "symmetry");
  const clamped = option(loadcase, "clamped");
  const min = (k: number) => bounds(nodes, k)[0];
  const max = (k: number) => bounds(nodes, k)[1];
  // fem.dof.symmetry: planes through the origin, normal displacement fixed
  const symmetry = (axes: boolean[]): Part[] =>
    axes.flatMap((on, k) =>
      on ? [{ key: `sym${AXES[k]}`, axis: k, at: 0, components: [k] }] : [],
    );

  if (loadcase.type === "uniaxial") {
    const a = axisOf("axis");
    const parts = symmetry([sym, sym, sym]);
    if (!sym)
      parts.push({ key: "left-x", axis: a, at: min(a), components: [a] });
    if (clamped) {
      parts.push({ key: "right", axis: a, at: max(a), components: others(a) });
      if (!sym) {
        parts.push({
          key: "left-yz",
          axis: a,
          at: min(a),
          components: others(a),
        });
      }
    }
    parts.push({ key: "move", axis: a, at: max(a), components: [a] });
    return parts;
  }

  if (loadcase.type === "biaxial" || loadcase.type === "planar") {
    const axes = [axisOf("axis"), axisOf("second")];
    const parts = symmetry([sym, sym, sym]);
    if (!sym) {
      for (const a of axes) {
        parts.push({
          key: `move-left-${a}`,
          axis: a,
          at: min(a),
          components: [a],
        });
      }
    }
    for (const a of axes) {
      if (clamped) {
        parts.push({
          key: `right-${a}`,
          axis: a,
          at: max(a),
          components: others(a),
        });
        if (!sym) {
          parts.push({
            key: `left-${a}`,
            axis: a,
            at: min(a),
            components: others(a),
          });
        }
      }
      parts.push({
        key: `move-right-${a}`,
        axis: a,
        at: max(a),
        components: [a],
      });
    }
    return parts;
  }

  // shear: the first axis is the direction of the shear, the second the normal
  const [a0, a1] = [axisOf("axis"), axisOf("normal")];
  const parts = sym ? symmetry([0, 1, 2].map((k) => k !== a0 && k !== a1)) : [];
  const third = [0, 1, 2].find((k) => k !== a0 && k !== a1)!;
  const compression = Number(
    (loadcase as unknown as { compression?: number }).compression ?? 0,
  );
  parts.push(
    { key: "bottom", axis: a1, at: min(a1), components: others(a1) },
    { key: "top", axis: a1, at: max(a1), components: [third] },
    { key: "compression_bottom", axis: a1, at: min(a1), components: [a1] },
    {
      key: "compression_top",
      axis: a1,
      at: max(a1),
      components: [a1],
      value: compression,
    },
    { key: "move", axis: a1, at: max(a1), components: [a0] },
  );
  return parts;
}

/** The boundaries of a load case that a step ramps, with the sign (see Python). */
export function moving(loadcase: Loadcase): [string, number][] {
  if (loadcase.type === "uniaxial" || loadcase.type === "shear") {
    return [["move", 1]];
  }
  const axes = [AXES.indexOf(option(loadcase, "axis") as "x")];
  if (loadcase.type === "biaxial") {
    axes.push(AXES.indexOf(option(loadcase, "second") as "x"));
  }
  const keys: [string, number][] = axes.map((a) => [`move-right-${a}`, 1]);
  if (!option(loadcase, "symmetry")) {
    keys.push(...axes.map((a): [string, number] => [`move-left-${a}`, -1]));
  }
  return keys;
}

/** The final values of the ramped boundaries: of the last step that ramps them. */
function rampedValues(commands: readonly Command[]): Map<string, number> {
  const loadcases = new Map(
    commands.flatMap((c) =>
      c.command === "loadcase.add" ? [[c.name, c] as const] : [],
    ),
  );
  const values = new Map<string, number>();
  for (const c of commands) {
    if (c.command !== "step.add" || !c.ramp) continue;
    for (const { target: name, end } of c.ramp.items) {
      const loadcase = loadcases.get(name);
      if (!loadcase) {
        values.set(name, end);
        continue;
      }
      for (const [key, sign] of moving(loadcase)) {
        values.set(`${name}/${key}`, sign * end);
      }
    }
  }
  return values;
}

/** The boundaries of the script with their points on the nodes of the meshes. */
export function boundarySymbols(
  commands: readonly Command[],
  nodes: readonly Float64Array[],
): BoundarySymbol[] {
  if (!nodes.length) return [];
  // the points of the point sets; a control point is a point set of one point (#94)
  const points = new Map<string, Float64Array>();
  for (const c of commands) {
    if (c.command === "pointset.add")
      points.set(c.name, selectedPoints(c.select, nodes));
    else if (c.command === "point.add")
      points.set(c.name, Float64Array.from(c.coordinates));
  }
  const ramped = rampedValues(commands);
  const symbols: BoundarySymbol[] = [];
  for (const c of commands) {
    if (c.command === "boundary.add") {
      const at = points.get(c.pointset);
      if (!at) continue;
      symbols.push({
        owner: c.name,
        name: c.name,
        points: at,
        components: c.constrained.map((a) => AXES.indexOf(a)),
        value:
          ramped.get(c.name) ?? (c as unknown as { value?: number }).value ?? 0,
      });
    } else if (c.command === "symmetry.add") {
      // fem.dof.symmetry: the normal component on every plane (#186)
      for (const { axis, value } of symmetryPlanes(c)) {
        const k = AXES.indexOf(axis);
        symbols.push({
          owner: c.name,
          name: `${c.name}/sym${axis}`,
          points: plane(nodes, k, value),
          components: [k],
          value: 0,
        });
      }
    } else if (c.command === "loadcase.add") {
      for (const part of loadcaseParts(c, nodes)) {
        const name = `${c.name}/${part.key}`;
        symbols.push({
          owner: c.name,
          name,
          points: plane(nodes, part.axis, part.at),
          components: part.components,
          value: ramped.get(name) ?? part.value ?? 0,
        });
      }
    }
  }
  // a 2D model has no displacements in z (#175), except the rotation about z of a
  // rotation point
  const dim = is2d(analysisOf(commands)) ? 2 : 3;
  const rotations = new Set(
    commands.flatMap((c) =>
      c.command === "mpc.add" && c.rotation !== undefined ? [c.rotation] : [],
    ),
  );
  const pointsets = new Map(
    commands.flatMap((c) =>
      c.command === "boundary.add" ? [[c.name, c.pointset] as const] : [],
    ),
  );
  return symbols
    .map((s) => {
      const rotation = rotations.has(pointsets.get(s.owner) ?? "");
      const kept = s.components.filter((k) => k < dim || rotation);
      return { ...s, components: kept };
    })
    .filter((s) => s.points.length > 0 && s.components.length > 0);
}

/** The planes of a symmetry without a node of the drawn meshes, e.g. `y = 5` (#186). */
export function emptyPlanes(
  symmetry: Symmetry,
  nodes: readonly Float64Array[],
): string[] {
  if (!nodes.length) return [];
  return symmetryPlanes(symmetry)
    .filter((p) => plane(nodes, AXES.indexOf(p.axis), p.value).length === 0)
    .map((p) => `${p.axis} = ${p.value}`);
}

/** The size of the model: the length of the diagonal of its bounds. */
export function modelSize(nodes: readonly Float64Array[]): number {
  let size = 0;
  for (const k of [0, 1, 2]) {
    const [min, max] = bounds(nodes, k);
    if (Number.isFinite(min)) size = Math.hypot(size, max - min);
  }
  return size || 1;
}

/** At most `limit` points of a symbol, evenly thinned out. */
export function thinned(points: Float64Array, limit = 300): Float64Array {
  const count = points.length / 3;
  if (count <= limit) return points;
  const step = count / limit;
  const result = new Float64Array(3 * limit);
  for (let i = 0; i < limit; i++) {
    const p = 3 * Math.floor(i * step);
    result.set(points.subarray(p, p + 3), 3 * i);
  }
  return result;
}

/**
 * The line segments of the fixed components of a symbol: a short stroke through
 * every point along every constrained axis.
 */
export function strokes(
  symbol: BoundarySymbol,
  component: number,
  length: number,
): Float32Array {
  const points = thinned(symbol.points);
  const segments = new Float32Array(2 * points.length);
  for (let p = 0; p < points.length; p += 3) {
    for (let k = 0; k < 3; k++) {
      const offset = k === component ? length / 2 : 0;
      segments[2 * p + k] = points[p + k] - offset;
      segments[2 * p + 3 + k] = points[p + k] + offset;
    }
  }
  return segments;
}

/** The direction of a moved boundary: its components with the sign of the value. */
export function direction(symbol: BoundarySymbol): [number, number, number] {
  const d: [number, number, number] = [0, 0, 0];
  for (const k of symbol.components) d[k] = Math.sign(symbol.value);
  const length = Math.hypot(...d) || 1;
  return d.map((x) => x / length) as [number, number, number];
}

/** The colors of the axes, like the axis triad of the viewer. */
export const AXIS_COLORS = ["#d62728", "#2ca02c", "#1f77b4"];

/**
 * The lines of the symbols of the boundaries: strokes along the fixed components
 * (in the colors of the axes) and arrows of the moved boundaries. Hidden owners are
 * left out, a selected owner is drawn in the highlight color.
 */
export function boundaryLines(
  symbols: readonly BoundarySymbol[],
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
  const groups = new Map<
    string,
    { color: string; width: number; parts: Float32Array[] }
  >();
  const add = (color: string, width: number, part: Float32Array) => {
    const key = `${color} ${width}`;
    const group = groups.get(key) ?? { color, width, parts: [] };
    group.parts.push(part);
    groups.set(key, group);
  };
  for (const symbol of symbols) {
    if (hidden.has(symbol.owner)) continue;
    const chosen = symbol.owner === selected;
    if (symbol.value !== 0) {
      const origins = thinned(symbol.points);
      const d = direction(symbol).map((x) => x * 0.1 * size);
      const directions = new Float32Array(origins.length);
      for (let p = 0; p < origins.length; p += 3) directions.set(d, p);
      add(
        chosen ? highlight : MARKER_COLOR,
        chosen ? 3 : 2,
        arrowSegments({ origins, directions }),
      );
    } else {
      for (const k of symbol.components) {
        add(
          chosen ? highlight : AXIS_COLORS[k],
          chosen ? 3 : 2,
          strokes(symbol, k, 0.04 * size),
        );
      }
    }
  }
  return [...groups.values()].map(({ color, width, parts }) => {
    const positions = new Float32Array(parts.reduce((n, p) => n + p.length, 0));
    let offset = 0;
    for (const part of parts) {
      positions.set(part, offset);
      offset += part.length;
    }
    return { positions, color, width };
  });
}
