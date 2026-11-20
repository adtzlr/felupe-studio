// @vitest-environment happy-dom
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/preact";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Command } from "../core/resolved";
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

  it("shows or hides the constraints and the control points (#335)", async () => {
    const viewer = fakeViewer();
    // a constraint from a control point to another point, both control points
    const commands = [
      { command: "point.add", name: "center", coordinates: [0, 0, 0] },
      { command: "point.add", name: "tip", coordinates: [1, 1, 0] },
      {
        command: "mpc.add",
        name: "connect",
        points: "tip",
        center: "center",
        constrained: ["x", "y", "z"],
        multiplier: 1000,
      },
    ] as unknown as Command[];
    const withPoints: ResultScene = {
      ...scene,
      points: [
        {
          name: "center",
          position: [0, 0, 0],
          displacement: [0.1, 0, 0],
          force: [1, 0, 0],
        },
      ],
    };
    render(
      <ResultsView
        source={{ resultScene: async () => withPoints }}
        view={view}
        generation={1}
        active
        running={false}
        createViewer={viewer.create}
        commands={commands}
      />,
    );
    // the lines and the markers of the last scene of the viewer
    const drawn = () => {
      const objects = viewer.handle.update.mock.calls.at(-1)?.[0].objects ?? [];
      return {
        lines: objects.filter((o) => o.type === "lines").length,
        markers: objects.filter((o) => o.type === "points").length,
      };
    };
    await waitFor(() => expect(drawn().lines).toBeGreaterThan(0));
    expect(drawn().markers).toBeGreaterThan(0);
    const toggle = screen.getByRole("button", { name: "Constraints" });
    expect(toggle.getAttribute("aria-pressed")).toBe("true");
    expect(toggle.title).toContain("(C)");

    fireEvent.click(toggle);
    expect(toggle.getAttribute("aria-pressed")).toBe("false");
    await waitFor(() => expect(drawn()).toEqual({ lines: 0, markers: 0 }));
    // the table of the control points has a toggle of its own
    expect(
      screen
        .getByRole("button", { name: "Points" })
        .getAttribute("aria-pressed"),
    ).toBe("true");

    // the key C, like the button
    fireEvent.keyDown(window, { key: "c" });
    expect(toggle.getAttribute("aria-pressed")).toBe("true");
    await waitFor(() => expect(drawn().lines).toBeGreaterThan(0));
  });

  it("has no toggle of the constraints without them (#335)", async () => {
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
    await screen.findByRole("button", { name: "Edges" });
    expect(screen.queryByRole("button", { name: "Constraints" })).toBeNull();
    // the key does nothing either
    fireEvent.keyDown(window, { key: "c" });
    expect(screen.queryByRole("button", { name: "Constraints" })).toBeNull();
  });
});
