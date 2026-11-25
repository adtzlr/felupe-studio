// A cut of the view through the undeformed model (#395, ADR 0022). The meshes are cut
// in Python, with their cut faces (`MeshFiles.cutMeshes`); everything else that the
// viewport draws is cut here by the same plane: the markers in the hidden half are
// left out, and the lines and the faces (of face sets, picked surfaces, rigid
// surfaces and construction meshes) are clipped at the plane. A point on the plane
// is drawn, e.g. a marker on the cut face.
import type { Cut, MeshSurface } from "../worker/protocol";
import { exceptionOf } from "../core/jobs";
import type { MeshCut, MeshFiles } from "../core/meshfiles";
import { scaledSurface, type ViewportContent } from "./layers";
import type { Highlight, Lines, Markers, MeshLayer } from "./scene";
import type { Pick } from "./viewer";

/** The axes of a cut; a 2D model is cut by x or y only (ADR 0022). */
export const CUT_AXES = ["x", "y", "z"] as const;

/** The plane of a cut: the axis, the coordinate and the sign of the hidden half. */
export interface Plane {
  axis: 0 | 1 | 2;
  value: number;
  /** 1 if the half beyond the plane is hidden (`+`), -1 before it (`-`). */
  sign: 1 | -1;
  /** Points closer to the plane are on it. */
  tol: number;
}

/**
 * The plane of a cut, with a tolerance of the size of the model: the coordinates of
 * the drawn arrays are single precision.
 */
export function planeOf(cut: Cut, size: number): Plane {
  return {
    axis: CUT_AXES.indexOf(cut.axis) as Plane["axis"],
    value: cut.value,
    sign: cut.half === "-" ? -1 : 1,
    tol: 1e-6 * Math.max(Math.abs(size), Math.abs(cut.value), 1e-30),
  };
}

/** The signed distance to the plane, positive in the hidden half, 0 on the plane. */
function distance(plane: Plane, x: number): number {
  const s = plane.sign * (x - plane.value);
  return Math.abs(s) <= plane.tol ? 0 : s;
}

/** Whether a point is in the visible half or on the plane. */
export function isVisible(plane: Plane, point: ArrayLike<number>): boolean {
  return distance(plane, point[plane.axis]) <= 0;
}

/**
 * The visible part of the segment from a to b: the parameters of its ends from 0
 * (at a) to 1 (at b); none if it is hidden or only a point on the plane. Clipped in
 * the undeformed model, the displaced segment is clipped at the same parameters,
 * as its displacement is linear (#395).
 */
export function visiblePart(
  plane: Plane,
  a: ArrayLike<number>,
  b: ArrayLike<number>,
): readonly [number, number] | undefined {
  const sa = distance(plane, a[plane.axis]);
  const sb = distance(plane, b[plane.axis]);
  if (Math.max(sa, sb) > 0 && Math.min(sa, sb) >= 0) return undefined;
  if (sa <= 0 && sb <= 0) return [0, 1];
  const t = sa / (sa - sb);
  return sa <= 0 ? [0, t] : [t, 1];
}

/** The points in the visible half or on the plane (three coordinates each). */
export function visiblePoints(
  plane: Plane,
  positions: ArrayLike<number>,
): Float64Array {
  const kept: number[] = [];
  for (let p = 0; p + 2 < positions.length; p += 3) {
    if (distance(plane, positions[p + plane.axis]) > 0) continue;
    kept.push(positions[p], positions[p + 1], positions[p + 2]);
  }
  return Float64Array.from(kept);
}

/** Markers without the points in the hidden half, none of them empty. */
export function cutMarkers(
  plane: Plane,
  markers: readonly Markers[],
): Markers[] {
  return markers.flatMap((m) => {
    const positions = visiblePoints(plane, m.positions);
    return positions.length ? [{ ...m, positions }] : [];
  });
}

/** The point at the plane on the segment from a to b (in the visible half). */
function crossing(
  a: ArrayLike<number>,
  b: ArrayLike<number>,
  sa: number,
  sb: number,
): number[] {
  const t = sa / (sa - sb);
  return [0, 1, 2].map((k) => a[k] + t * (b[k] - a[k]));
}

/** Segments (six coordinates each) clipped at the plane, none of no length. */
export function clipSegments(
  plane: Plane,
  positions: Float32Array,
): Float32Array {
  const kept: number[] = [];
  for (let p = 0; p + 5 < positions.length; p += 6) {
    const a = positions.subarray(p, p + 3);
    const b = positions.subarray(p + 3, p + 6);
    const [sa, sb] = [
      distance(plane, a[plane.axis]),
      distance(plane, b[plane.axis]),
    ];
    // hidden, or only a point on the plane
    if (Math.max(sa, sb) > 0 && Math.min(sa, sb) >= 0) continue;
    if (sa <= 0 && sb <= 0) kept.push(...a, ...b);
    else if (sa <= 0) kept.push(...a, ...crossing(a, b, sa, sb));
    else kept.push(...crossing(b, a, sb, sa), ...b);
  }
  return Float32Array.from(kept);
}

/** Lines clipped at the plane, none of them empty. */
export function cutLines(plane: Plane, lines: readonly Lines[]): Lines[] {
  return lines.flatMap((l) => {
    const positions = clipSegments(plane, l.positions);
    return positions.length ? [{ ...l, positions }] : [];
  });
}

/**
 * Triangles and segments clipped at the plane, with the new points on their edges
 * after the points, once per edge.
 */
class Clipper {
  readonly positions: number[];
  private s: number[];
  private onEdge = new Map<string, number>();

  constructor(plane: Plane, positions: ArrayLike<number>) {
    this.positions = Array.from(positions);
    this.s = [];
    for (let p = 0; p + 2 < positions.length; p += 3) {
      this.s.push(distance(plane, positions[p + plane.axis]));
    }
  }

  get points(): number {
    return this.positions.length / 3;
  }

  hidden(p: number): boolean {
    return this.s[p] > 0;
  }

  /** The point at the plane on the edge from a visible point a to a hidden b. */
  cross(a: number, b: number): number {
    if (this.s[a] === 0) return a;
    const key = a < b ? `${a},${b}` : `${b},${a}`;
    let point = this.onEdge.get(key);
    if (point === undefined) {
      const at = (p: number) => this.positions.slice(3 * p, 3 * p + 3);
      point = this.points;
      this.positions.push(...crossing(at(a), at(b), this.s[a], this.s[b]));
      this.s.push(0);
      this.onEdge.set(key, point);
    }
    return point;
  }

  /** The visible part of a triangle: none, one or two triangles. */
  triangle(a: number, b: number, c: number): [number, number, number][] {
    const ring = [a, b, c];
    const hidden = ring.map((p) => this.hidden(p));
    const count = hidden.filter(Boolean).length;
    if (count === 0) return [[a, b, c]];
    if (count === 3) return [];
    // rotated so that the odd point is the first one
    const odd = hidden.findIndex((h) => (count === 1 ? h : !h));
    const [p, q, r] = [0, 1, 2].map((k) => ring[(odd + k) % 3]);
    const result: [number, number, number][] =
      count === 1
        ? [
            [this.cross(q, p), q, r],
            [this.cross(q, p), r, this.cross(r, p)],
          ]
        : [[p, this.cross(p, q), this.cross(p, r)]];
    // without the triangles of no area, of a point on the plane
    return result.filter(([x, y, z]) => x !== y && y !== z && z !== x);
  }

  /** The visible part of a segment, if any. */
  segment(a: number, b: number): [number, number] | undefined {
    const [ha, hb] = [this.hidden(a), this.hidden(b)];
    if (ha && hb) return undefined;
    if (!ha && !hb) return [a, b];
    const part: [number, number] = ha
      ? [this.cross(b, a), b]
      : [a, this.cross(a, b)];
    return part[0] === part[1] ? undefined : part;
  }
}

/** The faces of a highlight clipped at the plane, if any are left. */
export function cutHighlights(
  plane: Plane,
  highlights: readonly Highlight[],
): Highlight[] {
  return highlights.flatMap((h) => {
    const clipper = new Clipper(plane, h.positions);
    const triangles: number[] = [];
    for (let t = 0; t + 2 < h.triangles.length; t += 3) {
      const [a, b, c] = h.triangles.subarray(t, t + 3);
      for (const part of clipper.triangle(a, b, c)) triangles.push(...part);
    }
    if (!triangles.length) return [];
    return [
      {
        ...h,
        positions: Float32Array.from(clipper.positions),
        triangles: Uint32Array.from(triangles),
      },
    ];
  });
}

/**
 * A surface clipped at the plane, without a cut face: of a construction mesh (ADR
 * 0019), which is not a part of the model. Its new points are no nodes.
 */
export function clipSurface(plane: Plane, surface: MeshSurface): MeshSurface {
  const clipper = new Clipper(plane, surface.positions);
  const triangles: number[] = [];
  const parents: number[] = [];
  for (let t = 0; t < surface.triangles.length / 3; t++) {
    const [a, b, c] = surface.triangles.subarray(3 * t, 3 * t + 3);
    for (const part of clipper.triangle(a, b, c)) {
      triangles.push(...part);
      parents.push(t);
    }
  }
  const edges: number[] = [];
  for (let e = 0; e + 1 < surface.edges.length; e += 2) {
    const part = clipper.segment(surface.edges[e], surface.edges[e + 1]);
    if (part) edges.push(...part);
  }
  const added = clipper.points - surface.positions.length / 3;
  const extended = (data: Uint8Array) => {
    const result = new Uint8Array(clipper.points);
    result.set(data);
    return result;
  };
  const of = <T extends Uint32Array>(data: T) =>
    Uint32Array.from(parents, (t) => data[t]);
  const clipped: MeshSurface = {
    ...surface,
    positions: Float32Array.from(clipper.positions),
    triangles: Uint32Array.from(triangles),
    edges: Uint32Array.from(edges),
    owners: of(surface.owners),
  };
  if (surface.faces) clipped.faces = of(surface.faces);
  if (surface.curvedFaces) clipped.curvedFaces = of(surface.curvedFaces);
  if (surface.isNode && added >= 0) clipped.isNode = extended(surface.isNode);
  if (surface.isCorner && added >= 0)
    clipped.isCorner = extended(surface.isCorner);
  return clipped;
}

/**
 * The cut of every drawn mesh (#395) in the coordinates of its file: the coordinate
 * of the plane divided by the scale of the import (#135), which is positive.
 */
export function meshCuts(
  content: ViewportContent,
  cut: Cut | undefined,
): MeshCut[] {
  if (!cut) return [];
  return content.meshes.flatMap((layer) => {
    const origin = content.origins.get(layer.name);
    if (!origin) return [];
    const value = origin.scale ? cut.value / origin.scale : cut.value;
    return [
      { name: layer.name, source: origin.source, cut: { ...cut, value } },
    ];
  });
}

/**
 * The layers of the meshes with their latest cut surfaces (#395), scaled like the
 * mesh; a mesh whose first cut has not arrived yet is drawn whole.
 */
export function cutLayers(
  content: ViewportContent,
  cuts: readonly MeshCut[],
  files: MeshFiles,
): MeshLayer[] {
  if (!cuts.length) return content.meshes;
  return content.meshes.map((layer) => {
    const origin = content.origins.get(layer.name);
    const wanted = cuts.find((c) => c.name === layer.name);
    const surfaces = wanted && files.cutSurfaces(wanted);
    const raw = origin && surfaces?.[origin.cellType];
    return raw
      ? { ...layer, surface: scaledSurface(raw, origin.scale) }
      : layer;
  });
}

/**
 * The meshes whose latest cut failed (#442), by the exception of Python: they are
 * drawn whole, or with their cut before.
 */
export function failedCuts(
  cuts: readonly MeshCut[],
  files: MeshFiles,
): { names: string[]; error: string }[] {
  const failed = new Map<string, string[]>();
  for (const mesh of cuts) {
    const error = files.cutError(mesh);
    if (error === undefined) continue;
    const exception = exceptionOf(error);
    failed.set(exception, [...(failed.get(exception) ?? []), mesh.name]);
  }
  return [...failed].map(([error, names]) => ({ names, error }));
}

/**
 * A pick of a cut surface (#395) as a pick of the outer surface of its mesh, for the
 * faces of the sections; none on the cut face, which is no face of the model.
 */
export function uncutPick(
  pick: Pick | undefined,
  layers: readonly MeshLayer[],
): Pick | undefined {
  const sources =
    pick && layers.find((l) => l.name === pick.mesh)?.surface.sources;
  if (!pick || !sources) return pick;
  const triangle = sources[pick.triangle];
  return triangle >= 0 ? { ...pick, triangle } : undefined;
}
