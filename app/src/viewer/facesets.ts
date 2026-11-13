// Face sets (#142, ADR 0008): the faces of the boundary of a section on the drawn
// surfaces of the meshes, like `boundary_faces()` of the generated script. A face is
// a group of triangles of one face of a cell (`faces` of linear cells, `curvedFaces`
// of quadratic cells); its center is the mean of its points, from the exact
// coordinates of the nodes. A face of two cells of the section (an interface of cell
// tags inside the section) is not on its boundary. The faces of the 2D cells of 2D
// models (#175) are the sides of the cells, a group of segments of the outline of a
// cell from corner to corner, like the boundary regions of quads.
import type {
  CellSetFromFile,
  CellSetFromTag,
  Command,
  FaceSetAdd,
} from "../core/commands";
import { CELLS_2D } from "../core/analysis";
import { toName } from "../core/importmesh";
import {
  isMesh,
  type MeshCommand,
  type MeshFiles,
  meshStatus,
} from "../core/meshfiles";
import { solidOf } from "../core/meshinfo";
import type { MeshSurface } from "../worker/protocol";
import { cellMask } from "./layers";
import type { Vec3 } from "./picking";
import { ATOL, AXES, isClose } from "./pointsets";

export interface Face {
  /** The triangles of the face in the surface of its mesh (none of a side). */
  triangles: number[];
  /** The segments of a side of a 2D cell, two points of the surface each (#175). */
  segments?: number[];
  /** The cell of a side of a 2D cell. */
  owner?: number;
  /** The exact coordinates of its nodes, scaled like the mesh (three each). */
  nodes: Float64Array;
  /** The mean of its nodes. */
  center: Vec3;
  /** The unit normal, outwards (of the triangles, weighted by their area). */
  normal: Vec3;
}

/** The faces of the boundary of a section on the surface of its mesh. */
export interface SectionFaces {
  section: string;
  /** The mesh, i.e. the layer of the viewport. */
  mesh: string;
  /** The surface of the mesh, scaled. */
  surface: MeshSurface;
  faces: Face[];
  /** The face of every triangle (-1 if it is not a face of the boundary). */
  ofTriangle: Int32Array;
  /** The diagonal of the bounds of the section, for the default tolerance. */
  size: number;
  /** The faces are the sides of the 2D cells of a 2D model (#175). */
  planar?: boolean;
}

// the faces of a surface and a mask of cells, created once per surface
const CACHE = new WeakMap<MeshSurface, Map<string, SectionFaces>>();

/** The key of a point of the surface (float32 coordinates). */
const keyOf = (x: number, y: number, z: number) => `${x},${y},${z}`;

/** The exact nodes of the points of a surface, by their float32 coordinates. */
function exactNodes(raw: MeshSurface): Map<string, Vec3> {
  const exact = new Map<string, Vec3>();
  const nodes = raw.nodes ?? new Float64Array();
  for (let p = 0; p < nodes.length; p += 3) {
    const [x, y, z] = [nodes[p], nodes[p + 1], nodes[p + 2]];
    exact.set(keyOf(Math.fround(x), Math.fround(y), Math.fround(z)), [x, y, z]);
  }
  return exact;
}

/**
 * The sides of the 2D cells of a section on its boundary (#175): the segments of
 * the outline of every cell (the edges of its triangles that are used once in the
 * cell), split at the corners of the cell. A side of two cells of the section is
 * inside. The normal of a side is in the xy-plane, away from its cell.
 */
function computeSides(
  section: string,
  mesh: string,
  raw: MeshSurface,
  surface: MeshSurface,
  mask: Uint8Array,
  scale: number,
): SectionFaces {
  const { triangles, owners, positions, isNode, isCorner } = raw;
  const exact = exactNodes(raw);
  const pointKey = (p: number) =>
    keyOf(positions[3 * p], positions[3 * p + 1], positions[3 * p + 2]);
  const segmentKey = (a: number, b: number) => {
    const [ka, kb] = [pointKey(a), pointKey(b)];
    return ka < kb ? `${ka};${kb}` : `${kb};${ka}`;
  };
  // the triangles of the cells of the section
  const count = triangles.length / 3;
  const cells = new Map<number, number[]>();
  for (let t = 0; t < count; t++) {
    if (!mask[owners[t]]) continue;
    const list = cells.get(owners[t]);
    if (list) list.push(t);
    else cells.set(owners[t], [t]);
  }
  // the outline of every cell (directed like its triangles), and how often each
  // segment is a segment of an outline of the section
  const outlines = new Map<number, [number, number][]>();
  const used = new Map<string, number>();
  for (const [owner, list] of cells) {
    const inCell = new Map<string, { a: number; b: number; n: number }>();
    for (const t of list) {
      for (let k = 0; k < 3; k++) {
        const a = triangles[3 * t + k];
        const b = triangles[3 * t + ((k + 1) % 3)];
        const key = segmentKey(a, b);
        const seen = inCell.get(key);
        if (seen) seen.n += 1;
        else inCell.set(key, { a, b, n: 1 });
      }
    }
    const outline = [...inCell.entries()]
      .filter(([, s]) => s.n === 1)
      .map(([key, s]): [number, number] => {
        used.set(key, (used.get(key) ?? 0) + 1);
        return [s.a, s.b];
      });
    outlines.set(owner, outline);
  }
  const corner = (p: number) => !isCorner || isCorner[p] === 1;
  const faces: Face[] = [];
  const low = [Infinity, Infinity, Infinity];
  const high = [-Infinity, -Infinity, -Infinity];
  for (const [owner, outline] of outlines) {
    if (!outline.length) continue;
    // the sides: the outline from corner to corner
    const next = new Map(outline);
    const start = outline.map(([a]) => a).find(corner) ?? outline[0][0];
    const sides: number[][] = [];
    let side = [start];
    let p = start;
    for (let i = 0; i < outline.length; i++) {
      const q = next.get(p);
      if (q === undefined) break;
      side.push(q);
      if (corner(q)) {
        sides.push(side);
        side = [q];
      }
      p = q;
      if (p === start) break;
    }
    // the centroid of the outline, for the outward normals
    const centroid = [0, 1].map(
      (k) =>
        outline.reduce((sum, [a]) => sum + positions[3 * a + k], 0) /
        outline.length,
    );
    for (const points of sides) {
      const segments = points.slice(1).flatMap((q, i) => [points[i], q]);
      const outer = points
        .slice(1)
        .every((q, i) => used.get(segmentKey(points[i], q)) === 1);
      if (!outer) continue;
      const ids = points.filter((q) => !isNode || isNode[q]);
      const coordinates = new Float64Array(3 * ids.length);
      const sum = [0, 0, 0];
      ids.forEach((q, i) => {
        const at = positions.subarray(3 * q, 3 * q + 3);
        const node = exact.get(keyOf(at[0], at[1], at[2])) ?? [...at];
        for (let k = 0; k < 3; k++) {
          sum[k] += node[k];
          coordinates[3 * i + k] = node[k] * scale;
          low[k] = Math.min(low[k], coordinates[3 * i + k]);
          high[k] = Math.max(high[k], coordinates[3 * i + k]);
        }
      });
      const [first, last] = [points[0], points[points.length - 1]];
      const dx = positions[3 * last] - positions[3 * first];
      const dy = positions[3 * last + 1] - positions[3 * first + 1];
      const length = Math.hypot(dx, dy) || 1;
      let normal: Vec3 = [dy / length, -dx / length, 0];
      // away from the cell: from its centroid to the middle of the side
      const middle = [0, 1].map(
        (k) =>
          points.reduce((s, q) => s + positions[3 * q + k], 0) / points.length,
      );
      const outward =
        normal[0] * (middle[0] - centroid[0]) +
        normal[1] * (middle[1] - centroid[1]);
      if (outward < 0) normal = [-normal[0], -normal[1], 0];
      faces.push({
        triangles: [],
        segments,
        owner,
        nodes: coordinates,
        center: sum.map((s) => (s / ids.length) * scale) as Vec3,
        normal: normal.map((n) => n || 0) as Vec3,
      });
    }
  }
  const size = faces.length
    ? Math.hypot(...[0, 1, 2].map((k) => high[k] - low[k]))
    : 0;
  const ofTriangle = new Int32Array(count).fill(-1);
  return { section, mesh, surface, faces, ofTriangle, size, planar: true };
}

function compute(
  section: string,
  mesh: string,
  raw: MeshSurface,
  surface: MeshSurface,
  mask: Uint8Array,
  scale: number,
): SectionFaces {
  const { triangles, owners, positions, isNode } = raw;
  const ids = raw.faces ?? raw.curvedFaces;
  const exact = exactNodes(raw);
  // the triangles of every face of a cell of the section
  const groups = new Map<number, number[]>();
  const count = triangles.length / 3;
  for (let t = 0; t < count; t++) {
    if (!mask[owners[t]]) continue;
    const id = ids ? ids[t] : t;
    const group = groups.get(id);
    if (group) group.push(t);
    else groups.set(id, [t]);
  }
  // the faces with their points; a face of two cells of the section is inside
  const candidates: { triangles: number[]; points: number[]; key: string }[] =
    [];
  const seen = new Map<string, number>();
  for (const group of groups.values()) {
    const points = [
      ...new Set(
        group.flatMap((t) => [0, 1, 2].map((k) => triangles[3 * t + k])),
      ),
    ].filter((p) => !isNode || isNode[p]);
    const key = points
      .map((p) =>
        keyOf(positions[3 * p], positions[3 * p + 1], positions[3 * p + 2]),
      )
      .sort()
      .join(";");
    seen.set(key, (seen.get(key) ?? 0) + 1);
    candidates.push({ triangles: group, points, key });
  }
  const faces: Face[] = [];
  const ofTriangle = new Int32Array(count).fill(-1);
  const low = [Infinity, Infinity, Infinity];
  const high = [-Infinity, -Infinity, -Infinity];
  for (const c of candidates) {
    if (seen.get(c.key) !== 1) continue;
    const coordinates = new Float64Array(3 * c.points.length);
    const sum = [0, 0, 0];
    c.points.forEach((p, i) => {
      const at = positions.subarray(3 * p, 3 * p + 3);
      const node = exact.get(keyOf(at[0], at[1], at[2])) ?? [...at];
      for (let k = 0; k < 3; k++) {
        sum[k] += node[k];
        coordinates[3 * i + k] = node[k] * scale;
        low[k] = Math.min(low[k], coordinates[3 * i + k]);
        high[k] = Math.max(high[k], coordinates[3 * i + k]);
      }
    });
    const center = sum.map((s) => (s / c.points.length) * scale) as Vec3;
    const normal = [0, 0, 0];
    for (const t of c.triangles) {
      const [a, b, d] = [0, 1, 2].map((k) => 3 * triangles[3 * t + k]);
      const u = [0, 1, 2].map((k) => positions[b + k] - positions[a + k]);
      const v = [0, 1, 2].map((k) => positions[d + k] - positions[a + k]);
      normal[0] += u[1] * v[2] - u[2] * v[1];
      normal[1] += u[2] * v[0] - u[0] * v[2];
      normal[2] += u[0] * v[1] - u[1] * v[0];
    }
    const length = Math.hypot(...normal) || 1;
    for (const t of c.triangles) ofTriangle[t] = faces.length;
    faces.push({
      triangles: c.triangles,
      nodes: coordinates,
      center,
      normal: normal.map((n) => n / length) as Vec3,
    });
  }
  const size = faces.length
    ? Math.hypot(...[0, 1, 2].map((k) => high[k] - low[k]))
    : 0;
  return { section, mesh, surface, faces, ofTriangle, size };
}

/**
 * The faces of the boundary of the sections whose mesh file is read, by section.
 * The surfaces are the drawn ones (scaled, from `scaledSurface`), so the triangles
 * index them.
 */
export function sectionFaces(
  commands: readonly Command[],
  files: MeshFiles,
  scaled: (raw: MeshSurface, scale: number | undefined) => MeshSurface,
): Map<string, SectionFaces> {
  const result = new Map<string, SectionFaces>();
  for (const sec of commands) {
    if (sec.command !== "section.add") continue;
    const set = commands.find(
      (c): c is CellSetFromTag | CellSetFromFile =>
        c.name === sec.cellset &&
        (c.command === "cellset.from_tag" || c.command === "cellset.from_file"),
    );
    const mesh = commands.find(
      (c): c is MeshCommand => c.name === set?.mesh && isMesh(c),
    );
    if (!set || !mesh) continue;
    const status = meshStatus(mesh, commands, files);
    if (status?.state !== "ready") continue;
    const choice = solidOf(status.info, mesh.cell_type);
    const cellType = "solid" in choice ? choice.solid.cell_type : undefined;
    const raw = cellType ? status.surfaces[cellType] : undefined;
    if (!cellType || !raw) continue;
    const mask = cellMask(set, mesh, raw);
    if (!mask) continue;
    const scale = mesh.command === "mesh.import" ? mesh.scale : undefined;
    const key = `${sec.name}/${set.command}/${set.command === "cellset.from_tag" ? set.value : ""}/${mesh.tag ?? ""}/${scale ?? 1}`;
    let cached = CACHE.get(raw);
    if (!cached) CACHE.set(raw, (cached = new Map()));
    let faces = cached.get(key);
    if (!faces) {
      // the sides of the 2D cells of a 2D model (#175)
      const planar = CELLS_2D.includes(cellType);
      faces = (planar ? computeSides : compute)(
        sec.name,
        mesh.name,
        raw,
        scaled(raw, scale),
        mask,
        scale ?? 1,
      );
      cached.set(key, faces);
    }
    result.set(sec.name, faces);
  }
  return result;
}

/** The faces of a face set (indices of `faces`), like `boundary_faces()`. */
export function selectedFaces(
  select: FaceSetAdd["select"],
  of: SectionFaces,
): number[] {
  const { faces } = of;
  if ("axis" in select) {
    // all points of the face on the plane (like the mask of the points)
    const k = AXES.indexOf(select.axis);
    const atol = select.atol ?? ATOL;
    return faces.flatMap((face, i) => {
      for (let p = k; p < face.nodes.length; p += 3) {
        if (!isClose(face.nodes[p], select.value, atol)) return [];
      }
      return [i];
    });
  }
  const atol = select.atol ?? 1e-6 * of.size;
  const chosen = new Set<number>();
  for (const center of select.centers) {
    let best = -1;
    let distance = Infinity;
    faces.forEach((face, i) => {
      const d = Math.hypot(...[0, 1, 2].map((k) => face.center[k] - center[k]));
      if (d < distance) [best, distance] = [i, d];
    });
    if (best >= 0 && distance <= atol) chosen.add(best);
  }
  return [...chosen].sort((a, b) => a - b);
}

/** The centers of a face set that have no face (the script raises an error). */
export function missingCenters(
  select: FaceSetAdd["select"],
  of: SectionFaces,
): Vec3[] {
  if (!("centers" in select)) return [];
  const atol = select.atol ?? 1e-6 * of.size;
  return select.centers.filter(
    (center) =>
      !of.faces.some(
        (face) =>
          Math.hypot(...[0, 1, 2].map((k) => face.center[k] - center[k])) <=
          atol,
      ),
  ) as Vec3[];
}

/**
 * The side of a 2D cell at a picked point of a triangle of the cell (#175): the
 * nearest side of the cell on the boundary of the section, or -1.
 */
export function sideAt(
  of: SectionFaces,
  triangle: number,
  point: readonly number[],
): number {
  const owner = of.surface.owners[triangle];
  const { positions } = of.surface;
  let best = -1;
  let distance = Infinity;
  of.faces.forEach((face, i) => {
    if (face.owner !== owner || !face.segments) return;
    for (let s = 0; s < face.segments.length; s += 2) {
      const [a, b] = [face.segments[s], face.segments[s + 1]];
      const d = segmentDistance(point, positions, a, b);
      if (d < distance) [best, distance] = [i, d];
    }
  });
  return best;
}

/** The distance of a point from a segment between two points of the surface. */
function segmentDistance(
  point: readonly number[],
  positions: Float32Array,
  a: number,
  b: number,
): number {
  const ab = [0, 1, 2].map((k) => positions[3 * b + k] - positions[3 * a + k]);
  const ap = [0, 1, 2].map((k) => point[k] - positions[3 * a + k]);
  const length2 = ab[0] ** 2 + ab[1] ** 2 + ab[2] ** 2;
  const t = length2
    ? Math.min(
        1,
        Math.max(0, (ap[0] * ab[0] + ap[1] * ab[1] + ap[2] * ab[2]) / length2),
      )
    : 0;
  return Math.hypot(...[0, 1, 2].map((k) => ap[k] - t * ab[k]));
}

/**
 * The sides of 2D cells as ribbons for a highlight of the viewer (#175): a strip of
 * the given width along every segment, inside the cell.
 */
export function sideRibbons(
  of: SectionFaces,
  faces: readonly number[],
  width: number,
): { positions: Float32Array; triangles: Uint32Array } {
  const { positions } = of.surface;
  const points: number[] = [];
  const triangles: number[] = [];
  for (const i of faces) {
    const { segments = [], normal } = of.faces[i];
    for (let s = 0; s < segments.length; s += 2) {
      const n = points.length / 3;
      for (const p of [segments[s], segments[s + 1]]) {
        points.push(
          positions[3 * p],
          positions[3 * p + 1],
          positions[3 * p + 2],
        );
      }
      for (const p of [segments[s + 1], segments[s]]) {
        points.push(
          positions[3 * p] - normal[0] * width,
          positions[3 * p + 1] - normal[1] * width,
          positions[3 * p + 2],
        );
      }
      triangles.push(n, n + 1, n + 2, n, n + 2, n + 3);
    }
  }
  return {
    positions: Float32Array.from(points),
    triangles: Uint32Array.from(triangles),
  };
}

/** The triangles of faces as indices of points, for a highlight of the viewer. */
export function faceTriangles(of: SectionFaces, faces: readonly number[]) {
  const { triangles } = of.surface;
  const result: number[] = [];
  for (const i of faces) {
    for (const t of of.faces[i].triangles) {
      result.push(triangles[3 * t], triangles[3 * t + 1], triangles[3 * t + 2]);
    }
  }
  return Uint32Array.from(result);
}

/** A name of a face set, e.g. `faces_z_max` of a plane, or `faces` of picked faces. */
export function faceSetName(
  select: FaceSetAdd["select"],
  of: SectionFaces | undefined,
  commands: readonly Command[],
): string {
  const taken = new Set(commands.map((c) => c.name));
  if (!("axis" in select) || !of) return toName("faces", taken, "faces");
  const k = AXES.indexOf(select.axis);
  let [min, max] = [Infinity, -Infinity];
  for (const face of of.faces) {
    for (let p = k; p < face.nodes.length; p += 3) {
      min = Math.min(min, face.nodes[p]);
      max = Math.max(max, face.nodes[p]);
    }
  }
  const atol = select.atol ?? ATOL;
  const where = isClose(min, select.value, atol)
    ? "min"
    : isClose(max, select.value, atol)
      ? "max"
      : String(select.value);
  return toName(`faces_${select.axis}_${where}`, taken, "faces");
}
