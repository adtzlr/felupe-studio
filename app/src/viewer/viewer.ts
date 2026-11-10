// Adapter of the vendored FElupe viewer (ADR 0004): the only module that talks to it.
// Content is set in parts (meshes, markers, arrows); changes of the same task are
// drawn together. The camera fits the model when it is first shown and keeps its
// rotation, zoom and pan afterwards.
import {
  createViewer,
  type ViewerHandle,
} from "../vendor/felupe-viewer/viewer.js";
import { type Arrows, buildScene, type Markers, type MeshLayer } from "./scene";

export type CreateViewer = typeof createViewer;

/** Camera presets: a view onto a plane of the global axes, or isometric. */
export const VIEWS = [
  { id: "iso", label: "Iso", title: "Isometric view" },
  { id: "xy", label: "XY", title: "View onto the xy-plane" },
  { id: "xz", label: "XZ", title: "View onto the xz-plane" },
  { id: "yz", label: "YZ", title: "View onto the yz-plane" },
] as const;

export type CameraView = (typeof VIEWS)[number]["id"];

export class Viewer {
  private handle: ViewerHandle;
  private meshes: readonly MeshLayer[] = [];
  private markers: readonly Markers[] = [];
  private arrows: readonly Arrows[] = [];
  private scheduled = false;
  /** The camera fits the model on the next draw (e.g. after it was empty). */
  private fitNext = true;

  constructor(element: HTMLElement, create: CreateViewer = createViewer) {
    this.handle = create(element, buildScene({ meshes: [] }), {
      wheelOnFocus: false,
    });
  }

  /** False if the browser has no WebGL2 (the viewer shows a message instead). */
  get available(): boolean {
    return typeof this.handle.setView === "function";
  }

  setMeshes(meshes: readonly MeshLayer[]): void {
    this.meshes = meshes;
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
      markers: this.markers,
      arrows: this.arrows,
    });
    this.handle.update(scene, { keepView: !this.fitNext });
    this.fitNext = this.meshes.length === 0;
  }
}
