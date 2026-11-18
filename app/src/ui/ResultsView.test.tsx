// @vitest-environment happy-dom
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/preact";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ResultView } from "../core/results";
import type { Scene, ViewerHandle } from "../vendor/felupe-viewer/viewer.js";
import type { CreateViewer } from "../viewer/viewer";
import type { ResultScene } from "../worker/protocol";
import { ResultsView } from "./ResultsView";

afterEach(cleanup);

/** A viewer with WebGL2 that records its scenes. */
function fakeViewer() {
  const root = document.createElement("div");
  root.appendChild(document.createElement("canvas"));
  const handle = {
    root,
    update: vi.fn<(scene: Scene, options?: { keepView?: boolean }) => void>(),
    setView: vi.fn<(view: string | null) => void>(),
    dispose: vi.fn(),
  };
  const create = vi.fn(() => handle as unknown as ViewerHandle);
  return { handle, create: create as unknown as CreateViewer };
}

const scene: ResultScene = {
  label: "Displacement",
  at: "point",
  range: [0, 0.5],
  surfaces: [
    {
      name: "solid",
      positions: new Float32Array([0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0]),
      displacement: new Float32Array(12).fill(0.1),
      triangles: new Uint32Array([0, 1, 2, 0, 2, 3]),
      edges: new Uint32Array([0, 1, 1, 2, 2, 3, 3, 0]),
      values: new Float32Array([0, 0.1, 0.2, 0.5]),
      owners: new Uint32Array([0, 0]),
      nodes: new Int32Array([0, 1, 2, 3]),
    },
  ],
};

const view: ResultView = {
  job: "job_1",
  substep: 1,
  quantity: "displacement",
  scale: 1,
  undeformed: false,
  curve: false,
};

describe("ResultsView", () => {
  it("shows the contour with or without the edges of the cells (#233)", async () => {
    const viewer = fakeViewer();
    render(
      <ResultsView
        source={{ resultScene: async () => scene }}
        view={view}
        generation={1}
        active
        running={false}
        createViewer={viewer.create}
      />,
    );
    // the edges of the deformed surface in the last scene of the viewer
    const edges = () => {
      const calls = viewer.handle.update.mock.calls;
      const objects = calls.at(-1)?.[0].objects ?? [];
      return objects
        .filter((o) => o.type === "surface" && o.values)
        .map((o) => "edges" in o && o.edges !== undefined);
    };
    await waitFor(() => expect(edges()).toEqual([true]));
    const toggle = screen.getByRole("button", { name: "Edges" });
    expect(toggle.getAttribute("aria-pressed")).toBe("true");

    fireEvent.click(toggle);
    expect(toggle.getAttribute("aria-pressed")).toBe("false");
    await waitFor(() => expect(edges()).toEqual([false]));

    fireEvent.click(toggle);
    await waitFor(() => expect(edges()).toEqual([true]));
  });
});
