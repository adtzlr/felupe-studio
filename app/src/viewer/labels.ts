// Labels at points of the 3D view (#140), e.g. of the minimum and the maximum of a
// contour: buttons in the root of the viewer, placed at the projected points and
// moved with the camera (checked once per frame while there are labels). A label
// may have several points (e.g. the outer faces of a cell): once the camera rests,
// it takes the nearest one to the camera that is not behind drawn faces, or it is
// dimmed if all of them are. The picture export draws their boxes and texts
// (`snapshot.ts`).
import type { Vec3 } from "./picking";

export interface ViewLabel {
  id: string;
  /** The point of the label, as drawn (e.g. displaced and scaled). */
  position: Vec3;
  /** Points to take instead, the one nearest to the camera (e.g. of faces). */
  anchors?: readonly Vec3[];
  text: string;
  /** More lines, e.g. where the value is, shown if the label is expanded. */
  detail?: string[];
  expanded?: boolean;
  /** A class for the color of the label, e.g. `min` or `max`. */
  tone?: string;
  onClick?: () => void;
}

type Project = (
  point: Vec3,
  width: number,
  height: number,
) => [number, number] | undefined;

export interface LabelView {
  /** The distance of a point from the camera, to take the nearest anchor. */
  depth?: (point: Vec3) => number;
  /** True if a point is behind drawn faces. */
  occluded?: (point: Vec3, width: number, height: number) => boolean;
}

/** The time the camera rests before the labels behind faces are dimmed. */
const REST = 150;

export class LabelLayer {
  private container: HTMLDivElement;
  private labels: readonly ViewLabel[] = [];
  private elements = new Map<string, HTMLButtonElement>();
  private frame = 0;
  private placed = new Map<string, string>();
  private rest: ReturnType<typeof setTimeout> | undefined;
  /** The anchor of a label taken when the camera rested last. */
  private chosen = new Map<string, Vec3>();

  constructor(
    private root: HTMLElement,
    private project: Project,
    private view: LabelView = {},
  ) {
    this.container = document.createElement("div");
    this.container.className = "fv-labels";
    root.appendChild(this.container);
  }

  set(labels: readonly ViewLabel[]): void {
    this.labels = labels;
    // the elements of the labels, created or updated
    for (const [id, element] of this.elements) {
      if (!labels.some((l) => l.id === id)) {
        element.remove();
        this.elements.delete(id);
        this.placed.delete(id);
        this.chosen.delete(id);
      }
    }
    for (const label of labels) {
      let element = this.elements.get(label.id);
      if (!element) {
        element = document.createElement("button");
        element.type = "button";
        // a click on a label is not a click into the view
        element.addEventListener("click", (event) => {
          event.stopPropagation();
          this.labels.find((l) => l.id === element!.dataset.id)?.onClick?.();
        });
        element.addEventListener("pointerdown", (e) => e.stopPropagation());
        this.container.appendChild(element);
        this.elements.set(label.id, element);
      }
      element.dataset.id = label.id;
      const occluded = element.classList.contains("occluded");
      element.className = `fv-label${label.tone ? ` ${label.tone}` : ""}`;
      element.classList.toggle("occluded", occluded);
      element.setAttribute("aria-expanded", String(!!label.expanded));
      const lines = [
        label.text,
        ...(label.expanded ? (label.detail ?? []) : []),
      ];
      element.replaceChildren(
        ...lines.map((line, i) => {
          const span = document.createElement("span");
          span.className = i === 0 ? "fv-label-text" : "fv-label-detail";
          span.textContent = line;
          return span;
        }),
      );
    }
    this.place(true);
    if (labels.length && !this.frame) this.loop();
  }

  /** The anchors of a label, the nearest to the camera first. */
  private anchorsOf(label: ViewLabel): Vec3[] {
    const anchors = label.anchors?.length
      ? [...label.anchors]
      : [label.position];
    const depth = this.view.depth;
    return depth ? anchors.sort((a, b) => depth(a) - depth(b)) : anchors;
  }

  /** The point of a label: the anchor taken when the camera rested, or the nearest. */
  private pointOf(label: ViewLabel): Vec3 {
    const chosen = this.chosen.get(label.id);
    const anchors = label.anchors?.length ? label.anchors : [label.position];
    const same = (a: Vec3) => chosen && a.every((x, k) => x === chosen[k]);
    return anchors.find(same) ?? this.anchorsOf(label)[0];
  }

  /** Move a label to the projection of its point; true if it moved. */
  private move(label: ViewLabel, width: number, height: number): boolean {
    const element = this.elements.get(label.id);
    if (!element) return false;
    const at = this.project(this.pointOf(label), width, height);
    const style = at
      ? `translate(${Math.round(at[0])}px, ${Math.round(at[1])}px)`
      : "";
    if (this.placed.get(label.id) === style) return false;
    this.placed.set(label.id, style);
    element.hidden = !at;
    element.style.transform = style;
    return true;
  }

  /** Place the labels at their projected points (hidden behind the camera). */
  place(changed = false): void {
    const canvas = this.root.querySelector("canvas");
    const { width, height } = (canvas ?? this.root).getBoundingClientRect();
    let moved = changed;
    for (const label of this.labels) {
      if (!this.move(label, width, height)) continue;
      this.elements.get(label.id)?.classList.remove("occluded");
      moved = true;
    }
    if (moved && this.labels.length && this.view.occluded) {
      clearTimeout(this.rest);
      this.rest = setTimeout(() => this.settle(width, height), REST);
    }
  }

  /**
   * Once the camera rests: take the nearest anchor of a label that is not behind
   * drawn faces, or dim the label if all of them are.
   */
  private settle(width: number, height: number) {
    this.rest = undefined;
    const occluded = this.view.occluded!;
    for (const label of this.labels) {
      const element = this.elements.get(label.id);
      if (!element || element.hidden) continue;
      const anchors = this.anchorsOf(label);
      const visible = anchors.find((a) => !occluded(a, width, height));
      this.chosen.set(label.id, visible ?? anchors[0]);
      this.move(label, width, height);
      element.classList.toggle("occluded", !visible);
    }
  }

  private loop() {
    this.frame = requestAnimationFrame(() => {
      this.frame = 0;
      if (!this.labels.length) return;
      this.place();
      this.loop();
    });
  }

  dispose(): void {
    clearTimeout(this.rest);
    cancelAnimationFrame(this.frame);
    this.frame = 0;
    this.container.remove();
  }
}
