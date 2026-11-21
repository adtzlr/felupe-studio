// Adapter of the vendored FElupe viewer (ADR 0004): the only module that talks to it.
// Content is set in parts (meshes, markers, arrows); changes of the same task are
// drawn together. The camera fits the model when it is first shown and keeps its
// rotation, zoom and pan afterwards; a fit also fits the width of a view that is
// higher than wide (#378). A click (not a drag) picks the face under the
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
import {
  deformedPositions,
  depthOf,
  nearestNode,
  type Probe,
  probeAt,
  projectPoint,
} from "./probe";
import { snapshot } from "./snapshot";
import { LabelLayer, type ViewLabel } from "./labels";
import { VIEW_COLORS, type ViewColors } from "./palette";
import { renderScalarBar } from "./scalarbar";

export type CreateViewer = typeof createViewer;

/**
 * Camera presets: the default view, in which a viewer opens (like the plots of
 * FElupe, onto the xy-plane for a planar model), or a view onto a plane of the
 * global axes.
 */
export const VIEWS = [
  {
    id: "iso",
    label: "Iso",
    title: "Default view, as the viewer opens",
    shortcut: "view-iso",
  },
  {
    id: "xy",
    label: "XY",
    title: "View onto the xy-plane",
    shortcut: "view-xy",
  },
  {
    id: "xz",
    label: "XZ",
    title: "View onto the xz-plane",
    shortcut: "view-xz",
  },
  {
    id: "yz",
    label: "YZ",
    title: "View onto the yz-plane",
    shortcut: "view-yz",
  },
] as const;

export type CameraView = (typeof VIEWS)[number]["id"];

/** The face under the pointer: the mesh, the hit point and the unit normal. */
export interface Pick {
  mesh: string;
  point: Vec3;
  normal: Vec3;
  /** The hit triangle of the surface of the mesh (e.g. of a face of a face set). */
  triangle: number;
}

/** How a click picked: a node (with **Nodes** shown, #93) and the Shift key. */
export interface Click {
  /** The drawn node within a few pixels of the click, if the nodes are shown. */
  node?: Vec3;
  /** The name of a target (a control point, #95) within a few pixels. */
  target?: string;
  shift: boolean;
  /** A right click (without a drag), to deselect or exclude surfaces (#195). */
  right?: boolean;
}

/** A point that a click picks by its name, e.g. a control point (#95). */
export interface Target {
  name: string;
  position: Vec3;
}

/** A drag of more pixels is a rotation, not a click. */
const CLICK = 4;

/**
 * A pointer held still for this time (ms) is a long press, which picks like
 * Shift+click, also on a touch screen without Shift (#273).
 */
export const LONG_PRESS = 500;

/** A node is picked within this distance of the click, in pixels. */
const NODE_RADIUS = 8;

/** The diagonal of the bounding box of the meshes. */
function extent(meshes: readonly MeshLayer[]): number {
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
  return Number.isFinite(size) ? size : 0;
}

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

/** The index in the surface of a triangle of `drawnTriangles()`. */
function surfaceTriangle(layer: MeshLayer, drawn: number): number {
  const { surface, hidden } = layer;
  if (!hidden) return drawn;
  let count = -1;
  for (let t = 0; t < surface.owners.length; t++) {
    if (!hidden[surface.owners[t]] && ++count === drawn) return t;
  }
  return -1;
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
  private faces: readonly Highlight[] = [];
  private nodes = false;
  private targets: readonly Target[] = [];
  private scheduled = false;
  private down: { x: number; y: number } | undefined;
  /** The timer of a long press (#273), and whether one picked (its click is dropped). */
  private press: ReturnType<typeof setTimeout> | undefined;
  private pressed = false;
  private pickListeners = new Set<
    (pick: Pick | undefined, click: Click) => void
  >();
  /** The camera fits the model on the next draw (e.g. after it was empty). */
  private fitNext = true;
  /** The default view of the scene: onto the xy-plane for a 2D model (#175). */
  private view: "xy" | "default" = "default";
  /** Labels at points of the view, e.g. of the extremes of a contour (#140). */
  private labels: LabelLayer;
  /** The colors of the view in its theme (#375). */
  private colors: ViewColors = VIEW_COLORS.dark;

  constructor(element: HTMLElement, create: CreateViewer = createViewer) {
    this.handle = create(element, buildScene({ meshes: [] }), {
      wheelOnFocus: false,
    });
    const root = this.handle.root;
    this.labels = new LabelLayer(
      root,
      (point, width, height) => this.project(point, width, height),
      {
        depth: (point) => {
          const camera = this.handle.camera;
          return camera ? depthOf(camera, point) : 0;
        },
        occluded: (point, width, height) => this.occluded(point, width, height),
      },
    );
    root.addEventListener(
      "pointerdown",
      (event) => {
        this.down = { x: event.clientX, y: event.clientY };
        this.pressed = false;
        this.cancelPress();
        // a long press of the primary pointer (#273); a second finger (a pinch)
        // cancels it
        if (event.button === 0 && event.isPrimary !== false) {
          const at = { x: event.clientX, y: event.clientY };
          this.press = setTimeout(() => this.longPress(at), LONG_PRESS);
        }
      },
      true,
    );
    root.addEventListener(
      "pointermove",
      (event) => {
        const down = this.down;
        if (
          this.press &&
          down &&
          Math.hypot(event.clientX - down.x, event.clientY - down.y) > CLICK
        )
          this.cancelPress();
      },
      true,
    );
    for (const type of ["pointerup", "pointercancel"])
      root.addEventListener(type, () => this.cancelPress(), true);
    root.addEventListener("click", (event) => {
      // the click after a long press, which picked already (#273)
      if (this.pressed) {
        this.pressed = false;
        this.down = undefined;
        return;
      }
      this.click(event);
    });
    // a double click fits the model, after the viewer (#378)
    root.addEventListener("dblclick", () => this.fitWidth());
    // a right click without a drag (which pans) deselects or excludes (#195)
    root.addEventListener(
      "pointerup",
      (event) => {
        if (event.button === 2) this.click(event, true);
      },
      true,
    );
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
    const surfaces = this.drawnSurfaces();
    const ray = surfaces && this.rayAt(x, y, width, height);
    return ray ? probeAt(ray, surfaces) : undefined;
  }

  /** The drawn (deformed and scaled) surfaces of the result, or none. */
  private drawnSurfaces() {
    const result = this.result;
    if (!result) return undefined;
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
    return this.drawn.surfaces;
  }

  /** True if a point is behind the drawn faces (of the meshes and the result). */
  private occluded(point: Vec3, width: number, height: number): boolean {
    const camera = this.handle.camera;
    const at = camera && projectPoint(camera, point, width, height);
    const ray = at && this.rayAt(at[0], at[1], width, height);
    if (!camera || !ray) return false;
    const along = [0, 1, 2].reduce(
      (sum, k) => sum + (point[k] - ray.origin[k]) * ray.direction[k],
      0,
    );
    const faces = [
      ...this.meshes.map((layer) => ({
        positions: layer.surface.positions,
        triangles: drawnTriangles(layer),
      })),
      ...(this.drawnSurfaces() ?? []),
    ];
    // a point on a face is not behind it
    const tolerance = 0.005 * camera.radius;
    return faces.some((f) => {
      const hit = firstHit(ray, f.positions, f.triangles);
      return !!hit && hit.distance < along - tolerance;
    });
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

  /**
   * The colors of the view in the theme of the app (#375): of the picked plane, the
   * ghost of results and the markers and arrows without a color of their own.
   */
  setColors(colors: ViewColors): void {
    if (colors === this.colors) return;
    this.colors = colors;
    this.schedule();
  }

  /** Highlight the drawn faces in a plane (e.g. of a picked face), or none. */
  setPlane(plane: { point: Vec3; normal: Vec3 } | undefined): void {
    this.plane = plane;
    this.schedule();
  }

  /** Faces drawn over the meshes, e.g. of the face sets (#142). */
  setFaces(faces: readonly Highlight[]): void {
    this.faces = faces;
    this.schedule();
  }

  /**
   * Listen to picks: a face, or undefined for a click beside the model, and a node
   * near the click if the nodes are shown.
   */
  onPick(listener: (pick: Pick | undefined, click: Click) => void): () => void {
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
        const triangle = surfaceTriangle(layer, hit.triangle);
        best = { mesh: layer.name, ...hit, triangle };
      }
    }
    return (
      best && {
        mesh: best.mesh,
        point: best.point,
        normal: best.normal,
        triangle: best.triangle,
      }
    );
  }

  /** Points that a click picks by their name, e.g. the control points (#95). */
  setTargets(targets: readonly Target[]): void {
    this.targets = targets;
  }

  /**
   * The drawn node within a few pixels of a point of the view, if the nodes are
   * shown; nodes behind the drawn faces are not picked.
   */
  nodeAt(
    x: number,
    y: number,
    width: number,
    height: number,
  ): Vec3 | undefined {
    if (!this.nodes) return undefined;
    const nodes = this.meshes.map((m) => meshNodes(m).positions);
    return this.nearest(x, y, width, height, nodes);
  }

  /** The name of the target within a few pixels of a point of the view. */
  targetAt(
    x: number,
    y: number,
    width: number,
    height: number,
  ): string | undefined {
    if (!this.targets.length) return undefined;
    const positions = Float64Array.from(
      this.targets.flatMap((t) => t.position),
    );
    const point = this.nearest(x, y, width, height, [positions]);
    if (!point) return undefined;
    return this.targets.find((t) => t.position.every((v, k) => v === point[k]))
      ?.name;
  }

  /** The point nearest to a point of the view that is not behind drawn faces. */
  private nearest(
    x: number,
    y: number,
    width: number,
    height: number,
    points: readonly ArrayLike<number>[],
  ): Vec3 | undefined {
    this.flush();
    const camera = this.handle.camera;
    const ray = this.rayAt(x, y, width, height);
    if (!camera || !ray) return undefined;
    let hit: number | undefined;
    for (const layer of this.meshes) {
      const h = firstHit(ray, layer.surface.positions, drawnTriangles(layer));
      if (h && (hit === undefined || h.distance < hit)) hit = h.distance;
    }
    // a point on the hit face may be a little further away along the ray
    const depth = 0.02 * extent(this.meshes);
    return nearestNode(
      camera,
      ray,
      x,
      y,
      width,
      height,
      points,
      NODE_RADIUS,
      hit === undefined ? undefined : { distance: hit, depth },
    );
  }

  /** Look at the model from a preset direction, fitted into the view. */
  setView(view: CameraView): void {
    this.flush();
    // "iso" is the default view of the scene, in which the viewer opens (onto the
    // xy-plane for a 2D model), not the isometric view of the vendored viewer
    this.handle.setView?.(view === "iso" ? this.view : view);
    this.fitWidth();
  }

  /** Fit the model into the view and keep the direction. */
  fit(): void {
    this.flush();
    this.handle.setView?.(null);
    this.fitWidth();
  }

  /**
   * Fit the model into the width of a view that is higher than wide, e.g. of a phone
   * in portrait (#378): the vendored viewer fits it into the height of the view, so
   * the sides of the model were cut off there. The zoom out is the ratio of the
   * width and the height of the view.
   */
  private fitWidth() {
    const { camera, root } = this.handle;
    const canvas = root.querySelector("canvas");
    const width = canvas?.clientWidth ?? 0;
    const height = canvas?.clientHeight ?? 0;
    if (!camera || !(width > 0 && width < height)) return;
    camera.zoom = width / height;
    this.handle.redraw?.();
  }

  /** Labels at points of the view, moved with the camera (#140). */
  setLabels(labels: readonly ViewLabel[]): void {
    this.labels.set(labels);
  }

  dispose(): void {
    this.cancelPress();
    this.labels.dispose();
    this.handle.dispose();
  }

  private cancelPress() {
    clearTimeout(this.press);
    this.press = undefined;
  }

  /** A long press picks like Shift+click and shows a ring at the pointer (#273). */
  private longPress(at: { x: number; y: number }) {
    this.press = undefined;
    this.pressed = true;
    const root = this.handle.root;
    const box = root.getBoundingClientRect();
    const ring = document.createElement("div");
    ring.className = "fv-press";
    ring.style.left = `${at.x - box.left}px`;
    ring.style.top = `${at.y - box.top}px`;
    root.append(ring);
    setTimeout(() => ring.remove(), 400);
    this.pick(at.x, at.y, { shift: true });
  }

  private click(event: MouseEvent, right = false) {
    const down = this.down;
    this.down = undefined;
    if (
      down &&
      Math.hypot(event.clientX - down.x, event.clientY - down.y) > CLICK
    ) {
      return;
    }
    this.pick(event.clientX, event.clientY, {
      shift: event.shiftKey,
      ...(right ? { right: true } : {}),
    });
  }

  /** Pick at a point of the client and tell the listeners. */
  private pick(
    clientX: number,
    clientY: number,
    modifiers: { shift: boolean; right?: boolean },
  ) {
    const canvas = this.handle.root.querySelector("canvas");
    if (!canvas || !this.available) return;
    const rect = canvas.getBoundingClientRect();
    const [x, y] = [clientX - rect.left, clientY - rect.top];
    const pick = this.pickAt(x, y, rect.width, rect.height);
    const target = this.targetAt(x, y, rect.width, rect.height);
    const node = target
      ? undefined
      : this.nodeAt(x, y, rect.width, rect.height);
    const click: Click = {
      ...modifiers,
      ...(node ? { node } : {}),
      ...(target ? { target } : {}),
    };
    for (const listener of this.pickListeners) listener(pick, click);
  }

  /** The faces of the meshes in the highlighted plane. */
  private highlights(): Highlight[] {
    const plane = this.plane;
    if (!plane) return [...this.faces];
    const tol = tolerance(this.meshes);
    return this.meshes
      .map((layer) => ({
        positions: layer.surface.positions,
        triangles: trianglesInPlane(
          layer.surface.positions,
          drawnTriangles(layer),
          plane.point,
          plane.normal,
          tol,
        ),
        color: this.colors.highlight,
      }))
      .concat(this.faces);
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
      colors: this.colors,
    });
    this.view = scene.view === "xy" ? "xy" : "default";
    this.handle.update(scene, { keepView: !this.fitNext });
    if (this.fitNext) this.fitWidth();
    // the scalar bar of a contour with settings (#139), drawn by the app
    const look = this.result?.look;
    renderScalarBar(
      this.handle.root,
      this.result && look
        ? { label: this.result.scene.label, look }
        : undefined,
    );
    this.fitNext = this.meshes.length === 0 && !this.result;
  }
}
