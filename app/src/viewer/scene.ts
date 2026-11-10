// Scenes of the vendored FElupe viewer (ADR 0004), built from the surfaces of the
// meshes, point markers and arrows. Pure functions, without WebGL.
import type {
  LinesObject,
  PointsObject,
  Scene,
  SceneArray,
  SceneObject,
  SurfaceObject,
} from "../vendor/felupe-viewer/viewer.js";
import type { MeshSurface, ResultScene } from "../worker/protocol";
import { EDGE_COLOR, MARKER_COLOR } from "./palette";

/** A mesh with its color, or with colors of groups of its cells. */
export interface MeshLayer {
  name: string;
  surface: MeshSurface;
  color: string;
  /** Colors of cells; cells of no group (and later groups win) keep `color`. */
  groups?: readonly CellGroup[];
  /** Cells that are not drawn (non-zero), one entry per cell. */
  hidden?: ArrayLike<number>;
  opacity?: number;
}

export interface CellGroup {
  color: string;
  /** The cells of the mesh of this group. */
  cells: ArrayLike<number>;
}

/** Markers at points, e.g. of a point set. */
export interface Markers {
  /** Three coordinates per point. */
  positions: ArrayLike<number>;
  color?: string;
  size?: number;
}

/** Arrows from points, e.g. of loads or prescribed displacements. */
export interface Arrows {
  /** Three coordinates per start point. */
  origins: ArrayLike<number>;
  /** Three components per arrow, in the units of the coordinates. */
  directions: ArrayLike<number>;
  color?: string;
  width?: number;
}

/** Line segments, e.g. the symbols of boundaries. */
export interface Lines {
  /** Six coordinates per segment. */
  positions: Float32Array;
  color: string;
  width?: number;
}

export interface LegendEntry {
  label: string;
  color: string;
}

/** Faces drawn transparent over the meshes, e.g. a picked plane. */
export interface Highlight {
  positions: Float32Array;
  triangles: Uint32Array;
  color: string;
  opacity?: number;
}

/** The result of a substep: the deformed surfaces of the sections with a contour. */
export interface ResultContent {
  scene: ResultScene;
  /** The scale of the displacements. */
  scale: number;
  /** Show the undeformed surfaces as a transparent ghost. */
  undeformed: boolean;
}

/** Color of the undeformed ghost of results. */
export const GHOST_COLOR = "#c4c8cf";

export interface SceneContent {
  meshes: readonly MeshLayer[];
  result?: ResultContent;
  highlights?: readonly Highlight[];
  markers?: readonly Markers[];
  arrows?: readonly Arrows[];
  lines?: readonly Lines[];
  /** The legend; by default the names of the meshes, if there is more than one. */
  legend?: readonly LegendEntry[] | null;
}

const f4 = (data: ArrayLike<number>): SceneArray => {
  const array = data instanceof Float32Array ? data : Float32Array.from(data);
  return { dtype: "f4", size: array.length, data: array };
};

const u4 = (data: ArrayLike<number>): SceneArray => {
  const array = data instanceof Uint32Array ? data : Uint32Array.from(data);
  return { dtype: "u4", size: array.length, data: array };
};

const HIDDEN = 0xffffffff;

/**
 * The triangles (and their faces) of each color of a mesh, in the order of the
 * colors, without the triangles of hidden cells.
 */
function split(layer: MeshLayer) {
  const { surface } = layer;
  const ntriangles = surface.triangles.length / 3;
  const hidden = layer.hidden;
  if (!layer.groups?.length && !hidden) {
    return [
      {
        color: layer.color,
        triangles: surface.triangles,
        faces: surface.faces,
        count: ntriangles,
      },
    ];
  }

  // the color of every cell: 0 for the color of the mesh, i + 1 for group i
  const colorOf = new Uint32Array(surface.cells);
  (layer.groups ?? []).forEach((group, i) => {
    for (let k = 0; k < group.cells.length; k++) {
      const cell = group.cells[k];
      if (cell >= 0 && cell < surface.cells) colorOf[cell] = i + 1;
    }
  });
  if (hidden) {
    for (let cell = 0; cell < surface.cells; cell++) {
      if (hidden[cell]) colorOf[cell] = HIDDEN;
    }
  }
  const colors = [layer.color, ...(layer.groups ?? []).map((g) => g.color)];
  const counts = new Uint32Array(colors.length);
  for (let t = 0; t < ntriangles; t++) {
    const c = colorOf[surface.owners[t]];
    if (c !== HIDDEN) counts[c]++;
  }

  const parts = colors.map((color, c) => ({
    color,
    triangles: new Uint32Array(3 * counts[c]),
    faces: surface.faces ? new Uint32Array(counts[c]) : undefined,
    count: 0,
  }));
  for (let t = 0; t < ntriangles; t++) {
    const c = colorOf[surface.owners[t]];
    if (c === HIDDEN) continue;
    const part = parts[c];
    part.triangles.set(
      surface.triangles.subarray(3 * t, 3 * t + 3),
      3 * part.count,
    );
    if (part.faces) part.faces[part.count] = surface.faces![t];
    part.count++;
  }
  return parts.filter((part) => part.count > 0);
}

/**
 * The edges between points of drawn triangles. Every region of cells has its own
 * points (see `felupe_studio.scene`), so the edges of hidden regions are left out.
 */
function visibleEdges(
  surface: MeshSurface,
  parts: readonly { triangles: Uint32Array }[],
): Uint32Array {
  const drawn = new Uint8Array(surface.positions.length / 3);
  for (const part of parts) {
    for (const point of part.triangles) drawn[point] = 1;
  }
  const { edges } = surface;
  const kept: number[] = [];
  for (let e = 0; e < edges.length; e += 2) {
    if (drawn[edges[e]] && drawn[edges[e + 1]])
      kept.push(edges[e], edges[e + 1]);
  }
  return Uint32Array.from(kept);
}

/** The surface objects of a mesh: its faces (by color) and its edges. */
export function meshObjects(layer: MeshLayer): SurfaceObject[] {
  const positions = f4(layer.surface.positions);
  const opacity = layer.opacity ?? 1;
  const parts = split(layer);
  const objects: SurfaceObject[] = parts.map((part) => ({
    type: "surface",
    positions,
    triangles: u4(part.triangles),
    ...(part.faces ? { faceIds: u4(part.faces) } : {}),
    color: part.color,
    opacity,
    smooth: false,
    sharp: true,
  }));
  const anyHidden = Array.prototype.some.call(layer.hidden ?? [], Boolean);
  const edgeList = anyHidden
    ? visibleEdges(layer.surface, parts)
    : layer.surface.edges;
  if (edgeList.length === 0) return objects;
  const edges = { edges: u4(edgeList), edgeColor: EDGE_COLOR, lineWidth: 1 };
  if (objects.length > 0) Object.assign(objects[0], edges);
  else
    objects.push({
      type: "surface",
      positions,
      triangles: u4([]),
      faces: false,
      opacity,
      ...edges,
    });
  return objects;
}

export function markerObject(markers: Markers): PointsObject {
  return {
    type: "points",
    positions: f4(markers.positions),
    color: markers.color ?? MARKER_COLOR,
    size: markers.size ?? 8,
  };
}

const cross = (a: number[], b: number[]) => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];

const unit = (a: number[]) => {
  const length = Math.hypot(a[0], a[1], a[2]);
  return a.map((x) => x / length);
};

/**
 * Line segments of arrows: the shaft and four strokes of the head, a quarter of
 * the length long.
 */
export function arrowSegments(arrows: Arrows): Float32Array {
  const segments: number[] = [];
  const count = Math.floor(
    Math.min(arrows.origins.length, arrows.directions.length) / 3,
  );
  for (let i = 0; i < count; i++) {
    const o = [0, 1, 2].map((k) => arrows.origins[3 * i + k]);
    const d = [0, 1, 2].map((k) => arrows.directions[3 * i + k]);
    const length = Math.hypot(d[0], d[1], d[2]);
    if (!(length > 0)) continue;
    const tip = o.map((x, k) => x + d[k]);
    segments.push(...o, ...tip);

    // two directions perpendicular to the arrow
    const axis = unit(d);
    const least = axis.map(Math.abs).indexOf(Math.min(...axis.map(Math.abs)));
    const u = unit(
      cross(
        axis,
        [0, 1, 2].map((k) => (k === least ? 1 : 0)),
      ),
    );
    const v = cross(axis, u);
    const back = 0.25 * length;
    const spread = 0.1 * length;
    for (const side of [u, v, u.map((x) => -x), v.map((x) => -x)]) {
      segments.push(
        ...tip,
        ...tip.map((x, k) => x - back * axis[k] + spread * side[k]),
      );
    }
  }
  return Float32Array.from(segments);
}

export function arrowObject(arrows: Arrows): LinesObject {
  return {
    type: "lines",
    positions: f4(arrowSegments(arrows)),
    color: arrows.color ?? MARKER_COLOR,
    width: arrows.width ?? 2,
  };
}

/**
 * The surface objects of a result: the undeformed ghosts (optional) and the deformed
 * surfaces of the sections with the values in a common range (one scalar bar).
 */
export function resultObjects(result: ResultContent): SurfaceObject[] {
  const { scene, scale, undeformed } = result;
  const range: [number, number] = scene.range ?? [0, 1];
  const ghosts = undeformed
    ? scene.surfaces.map((s): SurfaceObject => ({
        type: "surface",
        positions: f4(s.positions),
        triangles: u4(s.triangles),
        color: GHOST_COLOR,
        opacity: 0.2,
        smooth: false,
      }))
    : [];
  const deformed = scene.surfaces.map((s): SurfaceObject => ({
    type: "surface",
    positions: f4(s.positions),
    displacement: f4(s.displacement),
    factor: scale,
    triangles: u4(s.triangles),
    ...(s.faces ? { faceIds: u4(s.faces) } : {}),
    edges: u4(s.edges),
    edgeColor: EDGE_COLOR,
    lineWidth: 1,
    smooth: false,
    sharp: true,
    values: f4(s.values),
    valuesAt: scene.at,
    range,
    label: scene.label,
  }));
  return [...ghosts, ...deformed];
}

/** The scene of the viewer: the meshes, a result, highlights, markers and arrows. */
export function buildScene(content: SceneContent): Scene {
  const objects: SceneObject[] = [
    ...content.meshes.flatMap(meshObjects),
    ...(content.result ? resultObjects(content.result) : []),
    ...(content.highlights ?? [])
      .filter((h) => h.triangles.length > 0)
      .map((h): SurfaceObject => ({
        type: "surface",
        positions: f4(h.positions),
        triangles: u4(h.triangles),
        color: h.color,
        opacity: h.opacity ?? 0.6,
        smooth: false,
      })),
    ...(content.markers ?? []).map(markerObject),
    ...(content.arrows ?? []).map(arrowObject),
    ...(content.lines ?? [])
      .filter((l) => l.positions.length > 0)
      .map((l): LinesObject => ({
        type: "lines",
        positions: f4(l.positions),
        color: l.color,
        width: l.width ?? 2,
      })),
  ];
  const legend =
    content.legend === undefined
      ? content.meshes.length > 1
        ? content.meshes.map((m) => ({ label: m.name, color: m.color }))
        : null
      : content.legend && [...content.legend];
  return { objects, legend, view: "default", axes: true };
}
