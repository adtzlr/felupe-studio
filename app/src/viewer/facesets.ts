// Face sets (#142, ADR 0008): the faces of the boundary of a section on the drawn
// surfaces of the meshes, like `boundary_faces()` of the generated script. A face is
// a group of triangles of one face of a cell (`faces` of linear cells, `curvedFaces`
// of quadratic cells); its center is the mean of its points, from the exact
// coordinates of the nodes. A face of two cells of the section (an interface of cell
// tags inside the section) is not on its boundary.
import type {
  CellSetFromFile,
  CellSetFromTag,
  Command,
  FaceSetAdd,
  MeshImport,
} from "../core/commands";
import { toName } from "../core/importmesh";
import type { MeshFiles } from "../core/meshfiles";
import { solidOf } from "../core/meshinfo";
import type { MeshSurface } from "../worker/protocol";
import { cellMask } from "./layers";
import type { Vec3 } from "./picking";
import { ATOL, AXES, isClose } from "./pointsets";

export interface Face {
  /** The triangles of the face in the surface of its mesh. */
  triangles: number[];
  /** The exact coordinates of its nodes, scaled like the mesh (three each). */
  nodes: Float64Array;
  /** The mean of its nodes. */
  center: Vec3;
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
}

// the faces of a surface and a mask of cells, created once per surface
const CACHE = new WeakMap<MeshSurface, Map<string, SectionFaces>>();

/** The key of a point of the surface (float32 coordinates). */
const keyOf = (x: number, y: number, z: number) => `${x},${y},${z}`;

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
  // the exact nodes of the points of the surface, by their float32 coordinates
  const exact = new Map<string, Vec3>();
  const nodes = raw.nodes ?? new Float64Array();
  for (let p = 0; p < nodes.length; p += 3) {
    const [x, y, z] = [nodes[p], nodes[p + 1], nodes[p + 2]];
    exact.set(keyOf(Math.fround(x), Math.fround(y), Math.fround(z)), [x, y, z]);
  }
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
    for (const t of c.triangles) ofTriangle[t] = faces.length;
    faces.push({ triangles: c.triangles, nodes: coordinates, center });
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
      (c): c is MeshImport =>
        c.name === set?.mesh && c.command === "mesh.import",
    );
    if (!set || !mesh) continue;
    const status = files.get(mesh.file)?.status;
    if (status?.state !== "ready") continue;
    const choice = solidOf(status.info, mesh.cell_type);
    const raw =
      "solid" in choice ? status.surfaces[choice.solid.cell_type] : undefined;
    if (!raw) continue;
    const mask = cellMask(set, mesh, raw);
    if (!mask) continue;
    const key = `${sec.name}/${set.command}/${set.command === "cellset.from_tag" ? set.value : ""}/${mesh.tag ?? ""}/${mesh.scale ?? 1}`;
    let cached = CACHE.get(raw);
    if (!cached) CACHE.set(raw, (cached = new Map()));
    let faces = cached.get(key);
    if (!faces) {
      faces = compute(
        sec.name,
        mesh.name,
        raw,
        scaled(raw, mesh.scale),
        mask,
        mesh.scale ?? 1,
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
