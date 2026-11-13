// Rigid surfaces (#219) in the viewport: a plane as a translucent rectangle around
// the model, with its outward normal as an arrow at the reference point, and a
// cylinder as a translucent tube along the model. In a 2D model (#175), whose view
// is onto the xy-plane, a plane is a strip along its line on the rigid side and a
// cylinder (a circle about z) a disc of a roller or a ring of a tube. In the
// results, the surfaces are moved by the displacements of their reference points.
import { analysisOf, is2d } from "../core/analysis";
import type { Command, ContactAdd, RigidAdd } from "../core/commands";
import { bounds } from "./boundaries";
import { type SectionFaces, selectedFaces } from "./facesets";
import { selectedPoints } from "./pointsets";
import { arrowSegments, type Highlight, type Lines } from "./scene";

/** Color of the rigid surfaces; the selected one is highlighted. */
export const RIGID_COLOR = "#aab4c3";

type Vec3 = [number, number, number];

const isRigid = (c: Command): c is RigidAdd => c.command === "rigid.add";

const unit = (v: readonly number[]): Vec3 => {
  const length = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / length, v[1] / length, v[2] / length];
};
const cross = (a: readonly number[], b: readonly number[]): Vec3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
const dot = (a: readonly number[], b: readonly number[]) =>
  a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const along = (p: readonly number[], d: readonly number[], t: number): Vec3 => [
  p[0] + t * d[0],
  p[1] + t * d[1],
  p[2] + t * d[2],
];

/** Two unit vectors normal to a direction and to each other. */
function tangents(direction: readonly number[]): [Vec3, Vec3] {
  const n = unit(direction);
  // the axis least aligned with the direction
  const k = [0, 1, 2].reduce((a, b) =>
    Math.abs(n[b]) < Math.abs(n[a]) ? b : a,
  );
  const e: Vec3 = [0, 0, 0];
  e[k] = 1;
  const t = unit(cross(n, e));
  return [t, cross(n, t)];
}

/** The center and the size (the diagonal) of the bounds of the nodes. */
export function extent(nodes: readonly Float64Array[]): {
  center?: Vec3;
  size: number;
} {
  const ranges = [0, 1, 2].map((k) => bounds(nodes, k));
  if (!ranges.every(([min]) => Number.isFinite(min))) return { size: 1 };
  const center = ranges.map(([min, max]) => (min + max) / 2) as Vec3;
  const size = Math.hypot(...ranges.map(([min, max]) => max - min));
  return { center, size: size || 1 };
}

/** The triangles and outlines of a shape, as flat arrays. */
interface Mesh {
  positions: number[];
  triangles: number[];
  outline: number[];
}

/** A rectangle of the plane around the projection of the center of the model. */
function plane(point: Vec3, normal: Vec3, center: Vec3, half: number): Mesh {
  const n = unit(normal);
  const c = along(
    center,
    n,
    -dot(
      n,
      center.map((x, k) => x - point[k]),
    ),
  );
  const [t, s] = tangents(n);
  const corners = [
    [-1, -1],
    [1, -1],
    [1, 1],
    [-1, 1],
  ].map(([a, b]) => along(along(c, t, a * half), s, b * half));
  return {
    positions: corners.flat(),
    triangles: [0, 1, 2, 0, 2, 3],
    outline: [0, 1, 1, 2, 2, 3, 3, 0].flatMap((i) => corners[i]),
  };
}

/** A tube of the cylinder along the projection of the center of the model. */
function tube(
  point: Vec3,
  axis: Vec3,
  radius: number,
  center: Vec3,
  half: number,
  segments = 48,
): Mesh {
  const a = unit(axis);
  const c = along(
    point,
    a,
    dot(
      a,
      center.map((x, k) => x - point[k]),
    ),
  );
  const [t, s] = tangents(a);
  const positions: number[] = [];
  const triangles: number[] = [];
  const outline: number[] = [];
  const ring = (end: number) =>
    Array.from({ length: segments }, (_, i) => {
      const phi = (2 * Math.PI * i) / segments;
      const r = along(
        along(c, t, radius * Math.cos(phi)),
        s,
        radius * Math.sin(phi),
      );
      return along(r, a, end * half);
    });
  const [low, high] = [ring(-1), ring(1)];
  positions.push(...low.flat(), ...high.flat());
  for (let i = 0; i < segments; i++) {
    const j = (i + 1) % segments;
    triangles.push(i, j, segments + j, i, segments + j, segments + i);
    outline.push(...low[i], ...low[j], ...high[i], ...high[j]);
  }
  return { positions, triangles, outline };
}

/**
 * The strip of a line of a 2D model in the xy-plane: along the line, on the side
 * opposite to its normal (the rigid side).
 */
function strip(point: Vec3, normal: Vec3, center: Vec3, half: number): Mesh {
  const n = unit([normal[0], normal[1], 0]);
  const t: Vec3 = [-n[1], n[0], 0];
  const c = along(
    center,
    n,
    -dot(
      n,
      center.map((x, k) => x - point[k]),
    ),
  );
  const width = 0.04 * half;
  const corners = [
    along(c, t, -half),
    along(c, t, half),
    along(along(c, t, half), n, -width),
    along(along(c, t, -half), n, -width),
  ];
  return {
    positions: corners.flat(),
    triangles: [0, 1, 2, 0, 2, 3],
    outline: [...corners[0], ...corners[1]],
  };
}

/**
 * The circle of a 2D model in the xy-plane: a disc of a roller (the points are
 * outside), or a ring outside the circle of a tube (the points are inside).
 */
function circle(
  point: Vec3,
  radius: number,
  inside: boolean,
  half: number,
  segments = 64,
): Mesh {
  const outer = inside ? radius + 0.04 * half : radius;
  const inner = inside ? radius : 0;
  const at = (r: number, i: number): Vec3 => {
    const phi = (2 * Math.PI * i) / segments;
    return [point[0] + r * Math.cos(phi), point[1] + r * Math.sin(phi), 0];
  };
  const positions: number[] = [];
  const triangles: number[] = [];
  const outline: number[] = [];
  for (let i = 0; i < segments; i++) {
    positions.push(...at(inner, i), ...at(outer, i));
    const j = (i + 1) % segments;
    triangles.push(2 * i, 2 * i + 1, 2 * j + 1, 2 * i, 2 * j + 1, 2 * j);
    outline.push(...at(radius, i), ...at(radius, j));
  }
  return { positions, triangles, outline };
}

/**
 * The faces and the lines of the rigid surfaces: translucent shapes (the selected
 * one highlighted), their outlines and the normals of the planes. `offsets` move
 * the surfaces, e.g. by the displacements of their reference points in the results.
 */
export function rigidShapes(
  commands: readonly Command[],
  nodes: readonly Float64Array[],
  {
    hidden = new Set<string>(),
    selected,
    highlight,
    offsets = new Map<string, readonly number[]>(),
  }: {
    hidden?: ReadonlySet<string>;
    selected?: string;
    highlight: string;
    offsets?: ReadonlyMap<string, readonly number[]>;
  },
): { faces: Highlight[]; lines: Lines[] } {
  const rigids = commands.filter(isRigid).filter((c) => !hidden.has(c.name));
  if (!rigids.length) return { faces: [], lines: [] };
  const { center: model, size } = extent(nodes);
  const half = 0.6 * size;
  const planar = is2d(analysisOf(commands));
  const faces: Highlight[] = [];
  const lines: Lines[] = [];
  for (const rigid of rigids) {
    const offset = offsets.get(rigid.name) ?? [0, 0, 0];
    const point = rigid.coordinates.map((x, k) => x + offset[k]) as Vec3;
    const center = model ? (model.map((x, k) => x + offset[k]) as Vec3) : point;
    const shape = rigid.shape as {
      normal?: number[];
      radius?: number;
      axis?: number[];
      inside?: boolean;
    };
    let mesh: Mesh;
    if (shape.normal) {
      mesh = planar
        ? strip(point, shape.normal as Vec3, center, half)
        : plane(point, shape.normal as Vec3, center, half);
    } else {
      const radius = shape.radius ?? 1;
      mesh = planar
        ? circle(point, radius, !!shape.inside, half)
        : tube(point, (shape.axis ?? [0, 0, 1]) as Vec3, radius, center, half);
    }
    const chosen = rigid.name === selected;
    const color = chosen ? highlight : RIGID_COLOR;
    faces.push({
      positions: Float32Array.from(mesh.positions),
      triangles: Uint32Array.from(mesh.triangles),
      color,
      opacity: chosen ? 0.4 : 0.22,
    });
    lines.push({
      positions: Float32Array.from(mesh.outline),
      color,
      width: chosen ? 2 : 1,
    });
    if (shape.normal) {
      const n = unit(
        planar ? [shape.normal[0], shape.normal[1], 0] : shape.normal,
      );
      lines.push({
        positions: arrowSegments({
          origins: Float32Array.from(point),
          directions: Float32Array.from(n.map((x) => 0.12 * size * x)),
        }),
        color,
        width: chosen ? 3 : 2,
      });
    }
  }
  return { faces, lines };
}

/**
 * The points of a contact (#220), three coordinates each: of its point set, or the
 * nodes of the faces of its face set.
 */
export function contactPoints(
  contact: ContactAdd,
  commands: readonly Command[],
  nodes: readonly Float64Array[],
  sections: ReadonlyMap<string, SectionFaces>,
): number[] {
  const set = commands.find((c) => c.name === contact.points);
  if (set?.command === "pointset.add")
    return [...selectedPoints(set.select, nodes)];
  if (set?.command !== "faceset.add") return [];
  const of = sections.get(set.section);
  if (!of) return [];
  const seen = new Set<string>();
  const points: number[] = [];
  for (const i of selectedFaces(set.select, of)) {
    const face = of.faces[i].nodes;
    for (let p = 0; p < face.length; p += 3) {
      const key = `${face[p]},${face[p + 1]},${face[p + 2]}`;
      if (seen.has(key)) continue;
      seen.add(key);
      points.push(face[p], face[p + 1], face[p + 2]);
    }
  }
  return points;
}
