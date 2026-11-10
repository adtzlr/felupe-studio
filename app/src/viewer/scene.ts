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
import type { MeshSurface } from "../worker/protocol";
import { EDGE_COLOR, MARKER_COLOR } from "./palette";

/** A mesh with its color, or with colors of groups of its cells. */
export interface MeshLayer {
  name: string;
  surface: MeshSurface;
  color: string;
  /** Colors of cells; cells of no group (and later groups win) keep `color`. */
  groups?: readonly CellGroup[];
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

export interface LegendEntry {
  label: string;
  color: string;
}

export interface SceneContent {
  meshes: readonly MeshLayer[];
  markers?: readonly Markers[];
  arrows?: readonly Arrows[];
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

/** The triangles (and their faces) of each color of a mesh, in order of first use. */
function split(layer: MeshLayer) {
  const { surface } = layer;
  const ntriangles = surface.triangles.length / 3;
  if (!layer.groups?.length) {
    return [
      {
        color: layer.color,
        triangles: surface.triangles,
        faces: surface.faces,
      },
    ];
  }

  // the color of every cell: 0 for the color of the mesh, i + 1 for group i
  const colorOf = new Uint32Array(surface.cells);
  layer.groups.forEach((group, i) => {
    for (let k = 0; k < group.cells.length; k++) {
      const cell = group.cells[k];
      if (cell >= 0 && cell < surface.cells) colorOf[cell] = i + 1;
    }
  });
  const colors = [layer.color, ...layer.groups.map((g) => g.color)];
  const counts = new Uint32Array(colors.length);
  for (let t = 0; t < ntriangles; t++) counts[colorOf[surface.owners[t]]]++;

  const parts = colors.map((color, c) => ({
    color,
    triangles: new Uint32Array(3 * counts[c]),
    faces: surface.faces ? new Uint32Array(counts[c]) : undefined,
    count: 0,
  }));
  for (let t = 0; t < ntriangles; t++) {
    const part = parts[colorOf[surface.owners[t]]];
    part.triangles.set(
      surface.triangles.subarray(3 * t, 3 * t + 3),
      3 * part.count,
    );
    if (part.faces) part.faces[part.count] = surface.faces![t];
    part.count++;
  }
  return parts.filter((part) => part.count > 0);
}

/** The surface objects of a mesh: its faces (by color) and its edges. */
export function meshObjects(layer: MeshLayer): SurfaceObject[] {
  const positions = f4(layer.surface.positions);
  const opacity = layer.opacity ?? 1;
  const objects: SurfaceObject[] = split(layer).map((part) => ({
    type: "surface",
    positions,
    triangles: u4(part.triangles),
    ...(part.faces ? { faceIds: u4(part.faces) } : {}),
    color: part.color,
    opacity,
    smooth: false,
    sharp: true,
  }));
  const edges = {
    edges: u4(layer.surface.edges),
    edgeColor: EDGE_COLOR,
    lineWidth: 1,
  };
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

/** The scene of the viewer: the meshes, the markers and the arrows. */
export function buildScene(content: SceneContent): Scene {
  const objects: SceneObject[] = [
    ...content.meshes.flatMap(meshObjects),
    ...(content.markers ?? []).map(markerObject),
    ...(content.arrows ?? []).map(arrowObject),
  ];
  const legend =
    content.legend === undefined
      ? content.meshes.length > 1
        ? content.meshes.map((m) => ({ label: m.name, color: m.color }))
        : null
      : content.legend && [...content.legend];
  return { objects, legend, view: "default", axes: true };
}
