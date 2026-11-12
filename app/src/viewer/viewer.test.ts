// @vitest-environment happy-dom
import { describe, expect, it, vi } from "vitest";
import type { Scene, ViewerHandle } from "../vendor/felupe-viewer/viewer.js";
import type { MeshSurface } from "../worker/protocol";
import { type CreateViewer, HIGHLIGHT, Viewer } from "./viewer";

const surface: MeshSurface = {
  positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
  triangles: new Uint32Array([0, 1, 2]),
  edges: new Uint32Array([0, 1]),
  owners: new Uint32Array([0]),
  cells: 1,
};

function fake(webgl = true) {
  const root = document.createElement("div");
  const canvas = document.createElement("canvas");
  canvas.getBoundingClientRect = () =>
    ({ left: 10, top: 20, width: 100, height: 100 }) as DOMRect;
  root.appendChild(canvas);
  const handle = {
    root,
    // looking from +z onto the xy-plane, centered at (0.25, 0.25, 0)
    camera: {
      basis: [
        [1, 0, 0],
        [0, 1, 0],
        [0, 0, 1],
      ],
      target: [0.25, 0.25, 0],
      radius: 1,
      zoom: 1,
      parallel: true,
    },
    update: vi.fn<(scene: Scene, options?: { keepView?: boolean }) => void>(),
    setView: vi.fn<(view: string | null) => void>(),
    dispose: vi.fn(),
  };
  if (!webgl) delete (handle as Partial<typeof handle>).setView;
  const create = vi.fn(() => handle as ViewerHandle) as unknown as CreateViewer;
  return { handle, create };
}

const tick = () => new Promise<void>((resolve) => queueMicrotask(resolve));

describe("Viewer", () => {
  it("draws the changes of a task together", async () => {
    const { handle, create } = fake();
    const viewer = new Viewer(document.createElement("div"), create);
    viewer.setMeshes([{ name: "bar", surface, color: "#3987e5" }]);
    viewer.setMarkers([{ positions: [0, 0, 0] }]);
    expect(handle.update).not.toHaveBeenCalled();
    await tick();
    expect(handle.update).toHaveBeenCalledTimes(1);
    const [scene, options] = handle.update.mock.calls[0];
    expect(scene.objects.map((o) => o.type)).toEqual(["surface", "points"]);
    // the model is fitted into the view when it is shown first
    expect(options).toEqual({ keepView: false });
  });

  it("keeps the view while the model changes, until it is empty", async () => {
    const { handle, create } = fake();
    const viewer = new Viewer(document.createElement("div"), create);
    const mesh = { name: "bar", surface, color: "#3987e5" };
    viewer.setMeshes([mesh]);
    await tick();
    viewer.setMeshes([mesh, { ...mesh, name: "other" }]);
    await tick();
    viewer.setMeshes([]);
    await tick();
    viewer.setMeshes([mesh]);
    await tick();
    expect(handle.update.mock.calls.map(([, o]) => o?.keepView)).toEqual([
      false,
      true,
      true,
      false,
    ]);
  });

  it("sets camera presets and fits the model", async () => {
    const { handle, create } = fake();
    const viewer = new Viewer(document.createElement("div"), create);
    expect(viewer.available).toBe(true);
    viewer.setMeshes([{ name: "bar", surface, color: "#3987e5" }]);
    // pending changes are drawn before the camera moves
    viewer.setView("xz");
    expect(handle.update).toHaveBeenCalledTimes(1);
    viewer.fit();
    expect(handle.setView.mock.calls).toEqual([["xz"], [null]]);
    await tick();
    expect(handle.update).toHaveBeenCalledTimes(1);
    viewer.dispose();
    expect(handle.dispose).toHaveBeenCalled();
  });

  it("shows the nodes of the meshes", async () => {
    const { handle, create } = fake();
    const viewer = new Viewer(document.createElement("div"), create);
    viewer.setMeshes([{ name: "bar", surface, color: "#3987e5" }]);
    viewer.setNodes(true);
    await tick();
    const scene = handle.update.mock.calls.at(-1)![0];
    expect(scene.objects.map((o) => o.type)).toEqual(["surface", "points"]);
    expect(scene.objects[1].positions.size).toBe(9);
    viewer.setNodes(false);
    await tick();
    expect(handle.update.mock.calls.at(-1)![0].objects).toHaveLength(1);
  });

  it("sets the legend", async () => {
    const { handle, create } = fake();
    const viewer = new Viewer(document.createElement("div"), create);
    viewer.setMeshes([{ name: "bar", surface, color: "#3987e5" }]);
    viewer.setLegend([{ label: "body", color: "#3987e5" }]);
    await tick();
    expect(handle.update).toHaveBeenCalledTimes(1);
    expect(handle.update.mock.lastCall![0].legend).toEqual([
      { label: "body", color: "#3987e5" },
    ]);
  });

  it("picks the first drawn face under the pointer", () => {
    const { create } = fake();
    const viewer = new Viewer(document.createElement("div"), create);
    viewer.setMeshes([{ name: "bar", surface, color: "#3987e5" }]);
    const pick = viewer.pickAt(50, 50, 100, 100)!;
    expect(pick.mesh).toBe("bar");
    expect(pick.normal).toEqual([0, 0, 1]);
    expect(pick.point[0]).toBeCloseTo(0.25);
    expect(pick.point[2]).toBeCloseTo(0);
    // beside the triangle
    expect(viewer.pickAt(99, 1, 100, 100)).toBeUndefined();
    // hidden cells are not picked
    viewer.setMeshes([{ name: "bar", surface, color: "#3987e5", hidden: [1] }]);
    expect(viewer.pickAt(50, 50, 100, 100)).toBeUndefined();
  });

  it("picks on a click, not after a drag", () => {
    const { handle, create } = fake();
    const viewer = new Viewer(document.createElement("div"), create);
    viewer.setMeshes([{ name: "bar", surface, color: "#3987e5" }]);
    const picks = vi.fn();
    viewer.onPick(picks);
    const canvas = handle.root.querySelector("canvas")!;
    const click = (from: number[], to: number[]) => {
      canvas.dispatchEvent(
        new PointerEvent("pointerdown", {
          bubbles: true,
          clientX: from[0],
          clientY: from[1],
        }),
      );
      canvas.dispatchEvent(
        new MouseEvent("click", {
          bubbles: true,
          clientX: to[0],
          clientY: to[1],
        }),
      );
    };
    // the center of the canvas, which starts at (10, 20)
    click([60, 70], [61, 70]);
    expect(picks).toHaveBeenCalledTimes(1);
    expect(picks.mock.lastCall![0]).toMatchObject({ mesh: "bar" });
    click([60, 70], [90, 70]);
    expect(picks).toHaveBeenCalledTimes(1);
    click([109, 21], [109, 21]);
    expect(picks.mock.lastCall![0]).toBeUndefined();
  });

  it("picks on a right click, not after a drag, which pans (#195)", () => {
    const { handle, create } = fake();
    const viewer = new Viewer(document.createElement("div"), create);
    viewer.setMeshes([{ name: "bar", surface, color: "#3987e5" }]);
    const picks = vi.fn();
    viewer.onPick(picks);
    const canvas = handle.root.querySelector("canvas")!;
    const right = (from: number[], to: number[], button = 2) => {
      for (const [type, [x, y]] of [
        ["pointerdown", from],
        ["pointerup", to],
      ] as const) {
        canvas.dispatchEvent(
          new PointerEvent(type, {
            bubbles: true,
            button,
            clientX: x,
            clientY: y,
            shiftKey: true,
          }),
        );
      }
    };
    right([60, 70], [61, 70]);
    expect(picks).toHaveBeenCalledTimes(1);
    expect(picks.mock.lastCall![0]).toMatchObject({ mesh: "bar" });
    expect(picks.mock.lastCall![1]).toEqual({ shift: true, right: true });
    // a drag pans; the left button picks on its click event only
    right([60, 70], [90, 70]);
    right([60, 70], [60, 70], 0);
    expect(picks).toHaveBeenCalledTimes(1);
  });

  it("picks a node near a click if the nodes are shown (#93)", () => {
    const { handle, create } = fake();
    const viewer = new Viewer(document.createElement("div"), create);
    viewer.setMeshes([{ name: "bar", surface, color: "#3987e5" }]);
    const picks = vi.fn();
    viewer.onPick(picks);
    const canvas = handle.root.querySelector("canvas")!;
    const click = (x: number, y: number, shiftKey = false) =>
      canvas.dispatchEvent(
        new MouseEvent("click", {
          bubbles: true,
          clientX: 10 + x,
          clientY: 20 + y,
          shiftKey,
        }),
      );
    // the node (0, 0, 0) is drawn at (38.6, 61.4) of the view
    click(40, 60);
    expect(picks.mock.lastCall![1]).toEqual({ shift: false });
    viewer.setNodes(true);
    click(40, 60, true);
    const [pick, { node, shift }] = picks.mock.lastCall!;
    expect(pick).toMatchObject({ mesh: "bar" });
    expect(shift).toBe(true);
    expect(node.map((x: number) => +x.toFixed(6))).toEqual([0, 0, 0]);
    // beside the model, a node within 8 pixels; further away none
    click(33, 64);
    expect(picks.mock.lastCall![0]).toBeUndefined();
    expect(picks.mock.lastCall![1].node).toBeDefined();
    click(20, 80);
    expect(picks.mock.lastCall![1].node).toBeUndefined();
    expect(viewer.nodeAt(84, 61, 100, 100)).toEqual([1, 0, 0]);
  });

  it("picks a target by its name, e.g. a control point (#95)", () => {
    const { handle, create } = fake();
    const viewer = new Viewer(document.createElement("div"), create);
    viewer.setMeshes([{ name: "bar", surface, color: "#3987e5" }]);
    viewer.setTargets([{ name: "control", position: [-0.5, 0, 0] }]);
    const picks = vi.fn();
    viewer.onPick(picks);
    const canvas = handle.root.querySelector("canvas")!;
    // (-0.5, 0, 0) is drawn at (15.9, 61.4) of the view, beside the triangle
    canvas.dispatchEvent(
      new MouseEvent("click", { bubbles: true, clientX: 26, clientY: 81 }),
    );
    expect(picks.mock.lastCall![1]).toEqual({
      shift: false,
      target: "control",
    });
    expect(viewer.targetAt(60, 20, 100, 100)).toBeUndefined();
  });

  it("highlights the drawn faces of a plane", async () => {
    const { handle, create } = fake();
    const viewer = new Viewer(document.createElement("div"), create);
    viewer.setMeshes([{ name: "bar", surface, color: "#3987e5" }]);
    viewer.setPlane({ point: [5, 5, 0], normal: [0, 0, 1] });
    await tick();
    const objects = handle.update.mock.lastCall![0].objects;
    expect(objects.map((o) => [o.type, o.color])).toEqual([
      ["surface", "#3987e5"],
      ["surface", HIGHLIGHT],
    ]);
    viewer.setPlane({ point: [5, 5, 1], normal: [0, 0, 1] });
    await tick();
    expect(handle.update.mock.lastCall![0].objects).toHaveLength(1);
  });

  it("resets the camera to the default view with Iso", () => {
    const { handle, create } = fake();
    const viewer = new Viewer(document.createElement("div"), create);
    viewer.setView("iso");
    expect(handle.setView).toHaveBeenLastCalledWith("default");
    viewer.setView("xz");
    expect(handle.setView).toHaveBeenLastCalledWith("xz");
    viewer.fit();
    expect(handle.setView).toHaveBeenLastCalledWith(null);
  });

  it("works without WebGL2", () => {
    const { create } = fake(false);
    const viewer = new Viewer(document.createElement("div"), create);
    expect(viewer.available).toBe(false);
    expect(() => viewer.setView("iso")).not.toThrow();
  });
});
