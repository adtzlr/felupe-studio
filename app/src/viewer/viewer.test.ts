// @vitest-environment happy-dom
import { describe, expect, it, vi } from "vitest";
import type { Scene, ViewerHandle } from "../vendor/felupe-viewer/viewer.js";
import type { MeshSurface } from "../worker/protocol";
import { type CreateViewer, Viewer } from "./viewer";

const surface: MeshSurface = {
  positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
  triangles: new Uint32Array([0, 1, 2]),
  edges: new Uint32Array([0, 1]),
  owners: new Uint32Array([0]),
  cells: 1,
};

function fake(webgl = true) {
  const handle = {
    root: document.createElement("div"),
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

  it("works without WebGL2", () => {
    const { create } = fake(false);
    const viewer = new Viewer(document.createElement("div"), create);
    expect(viewer.available).toBe(false);
    expect(() => viewer.setView("iso")).not.toThrow();
  });
});
