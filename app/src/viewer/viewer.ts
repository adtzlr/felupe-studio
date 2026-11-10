// Adapter of the vendored FElupe viewer (ADR 0004): the only module that talks to it.
// Content is set in parts (meshes, markers, arrows); changes of the same task are
// drawn together. The camera fits the model when it is first shown and keeps its
// rotation, zoom and pan afterwards. A click (not a drag) picks the face under the
// pointer; the faces of a picked plane are highlighted.
import {
  createViewer,
  type ViewerHandle,
} from "../vendor/felupe-viewer/viewer.js";
import {
  firstHit,
  rayAt,
  trianglesInPlane,
  type Ray,
  type Vec3,
} from "./picking";
import {
  type Arrows,
  buildScene,
  type Highlight,
  type LegendEntry,
  type Lines,
  type Markers,
  type MeshLayer,
  meshNodes,
  type ResultContent,
  resultNodes,
} from "./scene";
import { deformedPositions, type Probe, probeAt, projectPoint } from "./probe";
import { snapshot } from "./snapshot";

export type CreateViewer = typeof createViewer;

/** Camera presets: a view onto a plane of the global axes, or isometric. */
export const VIEWS = [
  { id: "iso", label: "Iso", title: "Isometric view" },
  { id: "xy", label: "XY", title: "View onto the xy-plane" },
  { id: "xz", label: "XZ", title: "View onto the xz-plane" },
  { id: "yz", label: "YZ", title: "View onto the yz-plane" },
] as const;

export type CameraView = (typeof VIEWS)[number]["id"];

/** The face under the pointer: the mesh, the hit point and the unit normal. */
export interface Pick {
  mesh: string;
  point: Vec3;
  normal: Vec3;
}

/** Color of the faces of a picked plane. */
export const HIGHLIGHT = "#ffd23f";

/** A drag of more pixels is a rotation, not a click. */
const CLICK = 4;

/**
 * A tolerance of the coordinates of the meshes: relative to the size of the model
 * and to the precision of the float32 coordinates of the surfaces.
 */
function tolerance(meshes: readonly MeshLayer[]): number {
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (const { surface } of meshes) {
    const p = surface.positions;
    for (let i = 0; i < p.length; i++) {
      min[i % 3] = Math.min(min[i % 3], p[i]);
      max[i % 3] = Math.max(max[i % 3], p[i]);
    }
  }
  const size = Math.hypot(...max.map((m, k) => m - min[k]));
  const magnitude = Math.max(...min.map(Math.abs), ...max.map(Math.abs));
  const tol = 1e-6 * size + 1e-6 * magnitude;
  return Number.isFinite(tol) && tol > 0 ? tol : 1e-9;
}

/** The triangles of the cells that are drawn. */
function drawnTriangles(layer: MeshLayer): Uint32Array {
  const { surface, hidden } = layer;
  if (!hidden) return surface.triangles;
  const kept: number[] = [];
  for (let t = 0; t < surface.owners.length; t++) {
    if (hidden[surface.owners[t]]) continue;
    kept.push(...surface.triangles.subarray(3 * t, 3 * t + 3));
  }
  return Uint32Array.from(kept);
}

/** A slot for a function that returns a PNG of a view (none without a view). */
export interface Capture {
  current?: () => Promise<Blob | undefined>;
}

export class Viewer {
  private handle: ViewerHandle;
  private meshes: readonly MeshLayer[] = [];
  private markers: readonly Markers[] = [];
  private arrows: readonly Arrows[] = [];
  private lines: readonly Lines[] = [];
  private legend: readonly LegendEntry[] | undefined;
  private result: ResultContent | undefined;
  /** The drawn surfaces of the result, for probing (cached per scene and scale). */
  private drawn?: {
    result: ResultContent;
    surfaces: { positions: Float32Array; triangles: Uint32Array }[];
  };
  private plane: { point: Vec3; normal: Vec3 } | undefined;
  private nodes = false;
  private scheduled = false;
  private down: { x: number; y: number } | undefined;
  private pickListeners = new Set<(pick: Pick | undefined) => void>();
  /** The camera fits the model on the next draw (e.g. after it was empty). */
  private fitNext = true;

  constructor(element: HTMLElement, create: CreateViewer = createViewer) {
    this.handle = create(element, buildScene({ meshes: [] }), {
      wheelOnFocus: false,
    });
    const root = this.handle.root;
    root.addEventListener(
      "pointerdown",
      (event) => (this.down = { x: event.clientX, y: event.clientY }),
      true,
    );
    root.addEventListener("click", (event) => this.click(event));
  }

  /** False if the browser has no WebGL2 (the viewer shows a message instead). */
  get available(): boolean {
    return typeof this.handle.setView === "function";
  }

  setMeshes(meshes: readonly MeshLayer[]): void {
    this.meshes = meshes;
    this.schedule();
  }

  /**
   * A PNG of the view with the scalar bars, the legend and the axis triad, or none
   * without WebGL2.
   */
  async snapshot(): Promise<Blob | undefined> {
    const redraw = this.handle.redraw;
    if (!this.available || !redraw) return undefined;
    return snapshot(this.handle.root, () => redraw());
  }

  /**
   * The point of the result under a point of the view (pixels from its top left
   * corner): the hit triangle of a section and its nearest point (#85).
   */
  probeAt(
    x: number,
    y: number,
    width: number,
    height: number,
  ): Probe | undefined {
    const result = this.result;
    if (!result) return undefined;
    const ray = this.rayAt(x, y, width, height);
    if (!ray) return undefined;
    if (
      this.drawn?.result.scene !== result.scene ||
      this.drawn.result.scale !== result.scale
    ) {
      this.drawn = {
        result,
        surfaces: result.scene.surfaces.map((s) => ({
          positions: deformedPositions(
            s.positions,
            s.displacement,
            result.scale,
          ),
          triangles: s.triangles,
        })),
      };
    }
    return probeAt(ray, this.drawn.surfaces);
  }

  /** The position of a point in the view of the given size, in pixels. */
  project(
    point: Vec3,
    width: number,
    height: number,
  ): [number, number] | undefined {
    const camera = this.handle.camera;
    return camera ? projectPoint(camera, point, width, height) : undefined;
  }

  /** Show the result of a substep (deformed surfaces with a contour), or none. */
  setResult(result: ResultContent | undefined): void {
    this.result = result;
    this.schedule();
  }

  setMarkers(markers: readonly Markers[]): void {
    this.markers = markers;
    this.schedule();
  }

  setArrows(arrows: readonly Arrows[]): void {
    this.arrows = arrows;
    this.schedule();
  }

  /** Line segments, e.g. the symbols of the boundaries. */
  setLines(lines: readonly Lines[]): void {
    this.lines = lines;
    this.schedule();
  }

  /** Set the legend; undefined names the meshes (if there is more than one). */
  setLegend(legend: readonly LegendEntry[] | undefined): void {
    this.legend = legend;
    this.schedule();
  }

  /** Show the nodes of the drawn meshes and of the result (#91). */
  setNodes(show: boolean): void {
    if (show === this.nodes) return;
    this.nodes = show;
    this.schedule();
  }

  /** Highlight the drawn faces in a plane (e.g. of a picked face), or none. */
  setPlane(plane: { point: Vec3; normal: Vec3 } | undefined): void {
    this.plane = plane;
    this.schedule();
  }

  /** Listen to picks: a face, or undefined for a click beside the model. */
  onPick(listener: (pick: Pick | undefined) => void): () => void {
    this.pickListeners.add(listener);
    return () => this.pickListeners.delete(listener);
  }

  /** The ray through a point of the view (pixels from its top left corner). */
  rayAt(x: number, y: number, width: number, height: number): Ray | undefined {
    const camera = this.handle.camera;
    return camera ? rayAt(camera, x, y, width, height) : undefined;
  }

  /** The first drawn face at a point of the view of the given size. */
  pickAt(
    x: number,
    y: number,
    width: number,
    height: number,
  ): Pick | undefined {
    this.flush();
    const ray = this.rayAt(x, y, width, height);
    if (!ray) return undefined;
    let best: (Pick & { distance: number }) | undefined;
    for (const layer of this.meshes) {
      const hit = firstHit(ray, layer.surface.positions, drawnTriangles(layer));
      if (hit && (!best || hit.distance < best.distance)) {
        best = { mesh: layer.name, ...hit };
      }
    }
    return best && { mesh: best.mesh, point: best.point, normal: best.normal };
  }

  /** Look at the model from a preset direction, fitted into the view. */
  setView(view: CameraView): void {
    this.flush();
    this.handle.setView?.(view);
  }

  /** Fit the model into the view and keep the direction. */
  fit(): void {
    this.flush();
    this.handle.setView?.(null);
  }

  dispose(): void {
    this.handle.dispose();
  }

  private click(event: MouseEvent) {
    const down = this.down;
    this.down = undefined;
    if (
      down &&
      Math.hypot(event.clientX - down.x, event.clientY - down.y) > CLICK
    ) {
      return;
    }
    const canvas = this.handle.root.querySelector("canvas");
    if (!canvas || !this.available) return;
    const rect = canvas.getBoundingClientRect();
    const pick = this.pickAt(
      event.clientX - rect.left,
      event.clientY - rect.top,
      rect.width,
      rect.height,
    );
    for (const listener of this.pickListeners) listener(pick);
  }

  /** The faces of the meshes in the highlighted plane. */
  private highlights(): Highlight[] {
    const plane = this.plane;
    if (!plane) return [];
    const tol = tolerance(this.meshes);
    return this.meshes.map((layer) => ({
      positions: layer.surface.positions,
      triangles: trianglesInPlane(
        layer.surface.positions,
        drawnTriangles(layer),
        plane.point,
        plane.normal,
        tol,
      ),
      color: HIGHLIGHT,
    }));
  }

  private schedule() {
    if (this.scheduled) return;
    this.scheduled = true;
    queueMicrotask(() => this.flush());
  }

  /** Draw the pending changes. */
  flush(): void {
    if (!this.scheduled) return;
    this.scheduled = false;
    const scene = buildScene({
      meshes: this.meshes,
      result: this.result,
      highlights: this.highlights(),
      nodes: this.nodes
        ? [
            ...this.meshes.map(meshNodes),
            ...(this.result ? resultNodes(this.result) : []),
          ]
        : [],
      markers: this.markers,
      arrows: this.arrows,
      lines: this.lines,
      legend: this.legend,
    });
    this.handle.update(scene, { keepView: !this.fitNext });
    this.fitNext = this.meshes.length === 0 && !this.result;
  }
}
