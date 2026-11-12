// Connected surfaces of picked faces (#189): the faces of the boundary of a section
// that are reached from a picked face over shared edges, as long as the normals of
// two neighbouring faces differ by at most a feature angle. A picked surface is
// described by the simplest selection that fits it: a plane normal to an axis, a
// cylinder about an axis parallel to x, y or z, or else its nodes and faces.
import type { PointSetAdd } from "../core/commands";
import { type Face, type SectionFaces, selectedFaces } from "./facesets";
import {
  ATOL,
  AXES,
  type Axis,
  type CoordinateSelect,
  isClose,
  planeSelect,
  selectedPoints,
} from "./pointsets";

/** The default feature angle in degrees, like VTK and ParaView. */
export const FEATURE_ANGLE = 30;

/** The feature angles offered in the viewport. */
export const FEATURE_ANGLES = [10, 20, 30, 45, 60, 90, 180] as const;

const key = (nodes: Float64Array, p: number) =>
  `${nodes[p]},${nodes[p + 1]},${nodes[p + 2]}`;

// the neighbours of the faces of a section, computed once per section
const NEIGHBOURS = new WeakMap<SectionFaces, number[][]>();

/**
 * The neighbours of every face: the faces that share an edge with it, i.e. at least
 * two nodes (three of a quadratic face). Faces that touch at a corner only are not
 * neighbours.
 */
export function neighbours(of: SectionFaces): number[][] {
  const cached = NEIGHBOURS.get(of);
  if (cached) return cached;
  const facesAt = new Map<string, number[]>();
  of.faces.forEach((face, i) => {
    for (let p = 0; p < face.nodes.length; p += 3) {
      const k = key(face.nodes, p);
      const list = facesAt.get(k);
      if (list) list.push(i);
      else facesAt.set(k, [i]);
    }
  });
  const result = of.faces.map((face, i) => {
    const shared = new Map<number, number>();
    for (let p = 0; p < face.nodes.length; p += 3) {
      for (const j of facesAt.get(key(face.nodes, p)) ?? []) {
        if (j !== i) shared.set(j, (shared.get(j) ?? 0) + 1);
      }
    }
    return [...shared].filter(([, n]) => n >= 2).map(([j]) => j);
  });
  NEIGHBOURS.set(of, result);
  return result;
}

const dot = (a: readonly number[], b: readonly number[]) =>
  a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

/**
 * The faces of the connected surface of a face: over shared edges, while the
 * normals of two neighbouring faces differ by at most the feature angle (in
 * degrees). Sorted.
 */
export function connectedFaces(
  of: SectionFaces,
  seed: number,
  angle: number,
): number[] {
  const near = neighbours(of);
  const limit = Math.cos((Math.min(Math.max(angle, 0), 180) * Math.PI) / 180);
  const reached = new Set([seed]);
  const queue = [seed];
  while (queue.length) {
    const i = queue.pop()!;
    for (const j of near[i]) {
      if (reached.has(j)) continue;
      if (dot(of.faces[i].normal, of.faces[j].normal) < limit - 1e-9) continue;
      reached.add(j);
      queue.push(j);
    }
  }
  return [...reached].sort((a, b) => a - b);
}

/** Picked faces of a section: indices of its faces. */
export interface SectionPick {
  of: SectionFaces;
  faces: readonly number[];
}

/**
 * The nodes of the faces of sections, without duplicates and without the nodes of
 * excluded faces (three coordinates each).
 */
export function surfaceNodes(
  picks: readonly SectionPick[],
  excluded: readonly SectionPick[] = [],
): Float64Array {
  const seen = new Set<string>();
  for (const { of, faces } of excluded) {
    for (const i of faces) {
      const { nodes } = of.faces[i];
      for (let p = 0; p < nodes.length; p += 3) seen.add(key(nodes, p));
    }
  }
  const result: number[] = [];
  for (const { of, faces } of picks) {
    for (const i of faces) {
      const { nodes } = of.faces[i];
      for (let p = 0; p < nodes.length; p += 3) {
        const k = key(nodes, p);
        if (seen.has(k)) continue;
        seen.add(k);
        result.push(nodes[p], nodes[p + 1], nodes[p + 2]);
      }
    }
  }
  return Float64Array.from(result);
}

export interface CylinderSelect {
  radius: number;
  axis: Axis;
  center?: [number, number, number];
  atol?: number;
}

/**
 * A picked surface: its shape, its nodes (without those of excluded faces, #195),
 * and whether the selection of the shape selects exactly its nodes (of all drawn
 * meshes) and its faces (of its section). A plane or a cylinder that selects more,
 * e.g. a part of a plane picked with Shift or without the points of an excluded
 * edge, is stored by its nodes and faces instead.
 */
export type Surface = {
  nodes: Float64Array;
  /** The selection of the shape selects exactly the nodes of the surface. */
  exactPoints: boolean;
  /** The plane selects exactly the faces of the surface (of its one section). */
  exactFaces: boolean;
} & (
  | { kind: "plane"; plane: CoordinateSelect }
  | { kind: "cylinder"; cylinder: CylinderSelect }
  | { kind: "surface" }
);

/** Rounded to significant digits, without a sign of zero. */
const round = (x: number, digits = 10) => +x.toPrecision(digits) || 0;

/**
 * The plane of faces normal to an axis whose nodes all have the same coordinate
 * along it, if any.
 */
function planeOf(
  faces: readonly Face[],
  nodes: Float64Array,
  all: readonly Float64Array[],
): CoordinateSelect | undefined {
  for (const k of [0, 1, 2] as const) {
    if (!faces.every((f) => Math.abs(Math.abs(f.normal[k]) - 1) <= 1e-6))
      continue;
    // the exact coordinate of the plane at the first node, from all drawn nodes
    const select = planeSelect(k, [nodes[0], nodes[1], nodes[2]], all);
    const atol = select.atol ?? ATOL;
    for (let p = k; p < nodes.length; p += 3) {
      if (!isClose(nodes[p], select.value, atol)) return undefined;
    }
    return select;
  }
  return undefined;
}

/**
 * The circle through points in a plane (least squares, the algebraic fit of Kåsa):
 * x² + y² + a x + b y + c = 0, or undefined if the points are on a line.
 */
function circle(
  xs: readonly number[],
  ys: readonly number[],
): { cx: number; cy: number; r: number } | undefined {
  // shifted to the mean, for a well-conditioned system
  const n = xs.length;
  const mx = xs.reduce((s, x) => s + x, 0) / n;
  const my = ys.reduce((s, y) => s + y, 0) / n;
  let [sxx, sxy, syy, sxz, syz, sz, sx, sy] = [0, 0, 0, 0, 0, 0, 0, 0];
  for (let i = 0; i < n; i++) {
    const x = xs[i] - mx;
    const y = ys[i] - my;
    const z = x * x + y * y;
    sxx += x * x;
    sxy += x * y;
    syy += y * y;
    sxz += x * z;
    syz += y * z;
    sz += z;
    sx += x;
    sy += y;
  }
  // [sxx sxy sx; sxy syy sy; sx sy n] [a b c] = -[sxz syz sz]
  const m = [
    [sxx, sxy, sx],
    [sxy, syy, sy],
    [sx, sy, n],
  ];
  const rhs = [-sxz, -syz, -sz];
  const det = (a: number[][]) =>
    a[0][0] * (a[1][1] * a[2][2] - a[1][2] * a[2][1]) -
    a[0][1] * (a[1][0] * a[2][2] - a[1][2] * a[2][0]) +
    a[0][2] * (a[1][0] * a[2][1] - a[1][1] * a[2][0]);
  const d = det(m);
  const scale = Math.max(sxx, syy) ** 2 * n;
  if (!(Math.abs(d) > 1e-12 * scale)) return undefined;
  const solve = (k: number) =>
    det(m.map((row, i) => row.map((v, j) => (j === k ? rhs[i] : v)))) / d;
  const [a, b, c] = [solve(0), solve(1), solve(2)];
  const r2 = (a * a + b * b) / 4 - c;
  if (!(r2 > 0)) return undefined;
  return { cx: mx - a / 2, cy: my - b / 2, r: Math.sqrt(r2) };
}

/**
 * The cylinder of faces about an axis parallel to x, y or z: the normals are normal
 * to the axis and not all parallel, all nodes are at the same distance from the
 * axis (with a tolerance that covers their spread, up to 1e-3 of the radius), and
 * every face spans at most 60° about the axis.
 */
function cylinderOf(
  faces: readonly Face[],
  nodes: Float64Array,
): CylinderSelect | undefined {
  for (const k of [0, 1, 2] as const) {
    if (!faces.every((f) => Math.abs(f.normal[k]) <= 1e-3)) continue;
    // curved: the normals span more than 1°
    const first = faces[0].normal;
    if (faces.every((f) => dot(f.normal, first) > Math.cos(Math.PI / 180)))
      continue;
    const [i, j] = [0, 1, 2].filter((n) => n !== k);
    const xs: number[] = [];
    const ys: number[] = [];
    for (let p = 0; p < nodes.length; p += 3) {
      xs.push(nodes[p + i]);
      ys.push(nodes[p + j]);
    }
    const fit = circle(xs, ys);
    if (!fit) continue;
    const radius = round(fit.r);
    const center: [number, number, number] = [0, 0, 0];
    center[i] = round(fit.cx);
    center[j] = round(fit.cy);
    // tiny offsets of the center are zero
    for (const n of [i, j])
      if (Math.abs(center[n]) <= 1e-9 * radius) center[n] = 0;
    const spread = Math.max(
      ...xs.map((x, n) =>
        Math.abs(Math.hypot(x - center[i], ys[n] - center[j]) - radius),
      ),
    );
    if (spread > 1e-3 * radius) continue;
    // every face spans at most 60° about the axis (six segments around): the
    // corners of a few planes, e.g. two sides of a box, are on a circle as well
    const span = (face: Face) => {
      const angles: number[] = [];
      for (let p = 0; p < face.nodes.length; p += 3) {
        angles.push(
          Math.atan2(
            face.nodes[p + j] - center[j],
            face.nodes[p + i] - center[i],
          ),
        );
      }
      // relative to the first node, within (-180°, 180°]
      const relative = angles.map((a) => {
        const d = a - angles[0];
        return d > Math.PI
          ? d - 2 * Math.PI
          : d <= -Math.PI
            ? d + 2 * Math.PI
            : d;
      });
      return Math.max(...relative) - Math.min(...relative);
    };
    if (faces.some((f) => span(f) > (60.5 * Math.PI) / 180)) continue;
    const select: CylinderSelect = { radius, axis: AXES[k] };
    if (center[i] !== 0 || center[j] !== 0) select.center = center;
    if (!isClose(radius + spread, radius, ATOL)) {
      select.atol = 10 ** Math.ceil(Math.log10(2 * spread));
    }
    return select;
  }
  return undefined;
}

/**
 * The simplest selection that describes picked faces of one or more sections,
 * without the nodes of excluded faces (#195): a plane normal to an axis, a cylinder
 * about an axis parallel to x, y or z, or else a surface of nodes. `all` are the
 * nodes of the drawn meshes (for the exact coordinate of a plane).
 */
export function describeSurface(
  picks: readonly SectionPick[],
  all: readonly Float64Array[],
  excluded: readonly SectionPick[] = [],
): Surface {
  const faces = picks.flatMap(({ of, faces }) => faces.map((i) => of.faces[i]));
  const nodes = surfaceNodes(picks, excluded);
  // the nodes of the meshes that a selection selects: as many as the surface has
  const drawn = all.length ? all : [nodes];
  const exactPoints = (select: PointSetAdd["select"]) =>
    selectedPoints(select, drawn).length === nodes.length;
  if (faces.length && nodes.length) {
    const plane = planeOf(faces, nodes, all);
    if (plane) {
      const one = picks.length === 1 ? picks[0] : undefined;
      const chosen = one ? selectedFaces(plane, one.of) : [];
      return {
        kind: "plane",
        plane,
        nodes,
        exactPoints: exactPoints(plane),
        exactFaces:
          !!one &&
          chosen.length === one.faces.length &&
          chosen.every((f) => one.faces.includes(f)),
      };
    }
    const cylinder = cylinderOf(faces, nodes);
    if (cylinder) {
      return {
        kind: "cylinder",
        cylinder,
        nodes,
        exactPoints: exactPoints(cylinder),
        exactFaces: false,
      };
    }
  }
  return { kind: "surface", nodes, exactPoints: true, exactFaces: false };
}

/** The selection of a point set of a surface by its nodes. */
export function nodesSelect(nodes: Float64Array): PointSetAdd["select"] {
  const points: [number, number, number][] = [];
  for (let p = 0; p < nodes.length; p += 3)
    points.push([nodes[p], nodes[p + 1], nodes[p + 2]]);
  return { points: points as [[number, number, number]] };
}
