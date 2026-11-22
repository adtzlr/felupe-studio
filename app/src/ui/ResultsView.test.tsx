// @vitest-environment happy-dom
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/preact";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_CONTOUR } from "../core/contour";
import type { Command } from "../core/resolved";
import type { ResultView } from "../core/results";
import type { Scene, ViewerHandle } from "../vendor/felupe-viewer/viewer.js";
import { VIEW_COLORS } from "../viewer/palette";
import type { CreateViewer } from "../viewer/viewer";
import type { Cut, ResultScene } from "../worker/protocol";
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

  it("draws in the colors of the theme (#375)", async () => {
    const viewer = fakeViewer();
    const commands = [
      { command: "point.add", name: "center", coordinates: [0, 0, 0] },
      {
        command: "mpc.add",
        name: "connect",
        points: "center",
        center: "center",
        constrained: ["x"],
      },
    ] as unknown as Command[];
    const withPoints: ResultScene = {
      ...scene,
      points: [
        {
          name: "center",
          position: [0, 0, 0],
          displacement: [0, 0, 0],
          force: [0, 0, 0],
        },
      ],
    };
    const results = (theme?: "dark" | "light") => (
      <ResultsView
        source={{ resultScene: async () => withPoints }}
        view={{ ...view, undeformed: true }}
        generation={1}
        active
        running={false}
        createViewer={viewer.create}
        commands={commands}
        theme={theme}
      />
    );
    // the colors of the ghost, the lines and the markers of the last scene
    const colors = () => {
      const objects = viewer.handle.update.mock.calls.at(-1)?.[0].objects ?? [];
      return new Set(objects.map((o) => o.color));
    };
    const { rerender } = render(results());
    const { dark, light } = VIEW_COLORS;
    await waitFor(() => expect(colors()).toContain(dark.control));
    expect(colors()).toContain(dark.ghost);
    rerender(results("light"));
    await waitFor(() => expect(colors()).toContain(light.control));
    expect(colors()).toContain(light.ghost);
    expect(colors()).not.toContain(dark.control);
  });

  it("takes the range of chosen sections (#377)", async () => {
    // the rubber beside the steel: the steel sets the range of all sections
    const extreme = (section: string, value: number, index: number) => ({
      value,
      section,
      at: "cell" as const,
      index,
      surface: true,
      position: [index, 0, 0] as [number, number, number],
      displacement: [0, 0, 0] as [number, number, number],
    });
    const two: ResultScene = {
      ...scene,
      label: "Von Mises",
      at: "cell",
      range: [0, 12],
      extremes: { min: extreme("rubber", 0, 0), max: extreme("steel", 12, 1) },
      sections: {
        rubber: {
          range: [0, 4],
          extremes: {
            min: extreme("rubber", 0, 0),
            max: extreme("rubber", 4, 0),
          },
        },
        steel: {
          range: [1, 12],
          extremes: {
            min: extreme("steel", 1, 1),
            max: extreme("steel", 12, 1),
          },
        },
      },
    };
    const viewer = fakeViewer();
    const onRange = vi.fn();
    const resultRanges = vi.fn(async () => ({
      range: [
        [0, 12],
        [0, 16],
      ] as [number, number][],
      sections: {
        rubber: [
          [0, 4],
          [0, 5],
        ] as [number, number][],
        steel: [
          [1, 12],
          [1, 16],
        ] as [number, number][],
      },
    }));
    const show = (props: Partial<Parameters<typeof ResultsView>[0]>) => (
      <ResultsView
        source={{ resultScene: async () => two, resultRanges }}
        view={{ ...view, rangeSections: ["rubber"] }}
        generation={1}
        active
        running={false}
        createViewer={viewer.create}
        onRange={onRange}
        {...props}
      />
    );
    const bar = () => viewer.handle.root.querySelector(".app-scalar-bar");
    const ticks = () =>
      [...(bar()?.querySelectorAll(".fv-ticks span") ?? [])].map(
        (s) => s.textContent,
      );
    const { rerender } = render(show({}));
    // the range of the rubber, the steel above it in the outside color, named
    await waitFor(() => expect(ticks()).toEqual(["0", "1", "2", "3", "4"]));
    expect(bar()!.querySelector(".fv-bar-note")!.textContent).toBe(
      "Range: rubber",
    );
    expect(bar()!.querySelector("canvas.scalar-outside.above")).toBeTruthy();
    // the start of a manual range is the range of the rubber
    expect(onRange).toHaveBeenLastCalledWith([0, 4]);
    // the markers of the rubber: its maximum, not that of the steel
    fireEvent.click(screen.getByRole("button", { name: "Min/Max" }));
    await waitFor(() =>
      expect(viewer.handle.root.textContent).toContain("Max. 4"),
    );
    expect(viewer.handle.root.textContent).not.toContain("Max. 12");

    // all substeps: of the rubber over the substeps of the job
    rerender(show({ contour: { ...DEFAULT_CONTOUR, range: "job" } }));
    await waitFor(() =>
      expect(ticks()).toEqual(["0", "1.25", "2.5", "3.75", "5"]),
    );
    expect(resultRanges).toHaveBeenCalledTimes(1);

    // a removed section: all sections, without a note
    rerender(show({ view: { ...view, rangeSections: ["gone"] } }));
    await waitFor(() => expect(ticks()).toEqual(["0", "3", "6", "9", "12"]));
    expect(bar()!.querySelector(".fv-bar-note")).toBeNull();
    expect(onRange).toHaveBeenLastCalledWith([0, 12]);
  });

  it("draws the other sections in one color or hides them (#396)", async () => {
    const two: ResultScene = {
      ...scene,
      surfaces: ["rubber", "steel"].map((name) => ({
        ...scene.surfaces[0],
        name,
      })),
      sections: {
        rubber: { range: [0, 0.2], extremes: null },
        steel: { range: [0, 0.5], extremes: null },
      },
    };
    const viewer = fakeViewer();
    const show = (contour = DEFAULT_CONTOUR, theme?: "light") => (
      <ResultsView
        source={{ resultScene: async () => two }}
        view={{ ...view, undeformed: true, rangeSections: ["rubber"] }}
        generation={1}
        active
        running={false}
        createViewer={viewer.create}
        contour={contour}
        theme={theme}
      />
    );
    const surfaces = () =>
      viewer.handle.update.mock.lastCall![0].objects.filter(
        (o) => o.type === "surface",
      );
    const { rerender } = render(show());
    // the contour on both sections, and their ghosts
    await waitFor(() => expect(surfaces()).toHaveLength(4));
    expect(surfaces().filter((o) => o.values)).toHaveLength(2);

    // the steel in the gray of the view, with the edges of its cells
    const color = { ...DEFAULT_CONTOUR, others: "color" as const };
    rerender(show(color, "light"));
    await waitFor(() =>
      expect(surfaces()[3]).toMatchObject({
        color: VIEW_COLORS.light.other,
        opacity: 1,
        edgeColor: "#000000",
      }),
    );
    expect(surfaces()[3].values).toBeUndefined();
    expect(surfaces()[2].values).toBeDefined();
    // semi-transparent with a map of grays, in an own color
    rerender(
      show({ ...color, map: "grayscale", othersColor: "#336699" }, "light"),
    );
    await waitFor(() =>
      expect(surfaces()[3]).toMatchObject({ color: "#336699" }),
    );
    expect(surfaces()[3].opacity).toBeLessThan(1);

    // hidden: not drawn, also not as a ghost
    rerender(show({ ...DEFAULT_CONTOUR, others: "hidden" }));
    await waitFor(() => expect(surfaces()).toHaveLength(2));
    expect(surfaces()[1].values).toBeDefined();
    // the range of the rubber, named
    const bar = viewer.handle.root.querySelector(".app-scalar-bar")!;
    expect(bar.querySelector(".fv-bar-note")!.textContent).toBe(
      "Range: rubber",
    );
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

  it("cuts the scenes and draws what is in the visible half (#395)", async () => {
    const viewer = fakeViewer();
    const cut: Cut = { axis: "x", value: 1, half: "+" };
    const extreme = (value: number, x: number) => ({
      value,
      section: "solid",
      at: "point" as const,
      index: x,
      surface: true,
      position: [x, 0, 0] as [number, number, number],
      displacement: [0, 0, 0] as [number, number, number],
    });
    // the square from x = 0 to 2 cut at x = 1: the outer triangle and the cut face
    const whole = Float32Array.from([0, 0, 0, 2, 0, 0, 2, 1, 0, 0, 1, 0]);
    const points = [
      { name: "left", position: [0, 0, 0], displacement: [0, 0, 0] },
      { name: "right", position: [2, 0, 0], displacement: [0, 0, 0] },
    ] as ResultScene["points"];
    const extremes = { min: extreme(0, 0), max: extreme(0.5, 2) };
    const cutScene: ResultScene = {
      ...scene,
      cut,
      points,
      extremes,
      surfaces: [
        {
          ...scene.surfaces[0],
          outer: 1,
          uncut: { positions: whole, displacement: new Float32Array(12) },
        },
      ],
    };
    const uncut: ResultScene = {
      ...scene,
      points,
      extremes,
      surfaces: [{ ...scene.surfaces[0], positions: whole }],
    };
    const resultScene = vi.fn(
      async (...args: [string, number, string, string?, Cut?]) =>
        args[4] ? cutScene : uncut,
    );
    const onCut = vi.fn();
    const results = (value?: Cut, commands: Command[] = []) => (
      <ResultsView
        source={{ resultScene }}
        view={view}
        generation={1}
        active
        running={false}
        createViewer={viewer.create}
        commands={commands}
        cut={value}
        onCut={onCut}
      />
    );
    const { rerender } = render(results(cut));
    await waitFor(() =>
      expect(resultScene).toHaveBeenLastCalledWith(
        "job_1",
        1,
        "displacement",
        "cells",
        cut,
      ),
    );
    // where the control points and the extremes are marked in the last scene: the
    // x of the markers (each with an outline)
    const markers = () => [
      ...new Set(
        (viewer.handle.update.mock.calls.at(-1)?.[0].objects ?? [])
          .filter((o) => o.type === "points")
          .flatMap((o) => [...(o.positions.data as Float32Array)])
          .filter((_, i) => i % 3 === 0),
      ),
    ];
    await waitFor(() => expect(markers()).toEqual([0]));
    // the slider spans the whole model, Min/Max only the visible one
    const slider = screen.getByRole("slider", {
      name: "Position of the cut along x",
    }) as HTMLInputElement;
    expect([slider.min, slider.max]).toEqual(["0", "2"]);
    fireEvent.click(screen.getByRole("button", { name: "Min/Max" }));
    const labels = () =>
      [...viewer.handle.root.querySelectorAll(".fv-label")].map(
        (l) => l.textContent,
      );
    await waitFor(() => expect(labels()).toEqual(["Min. 0"]));
    expect(markers()).toEqual([0]);

    // no cut: a scene of its own, with everything drawn
    fireEvent.change(screen.getByRole("combobox", { name: "Cut" }), {
      target: { value: "" },
    });
    expect(onCut).toHaveBeenLastCalledWith(undefined);
    rerender(results(undefined));
    await waitFor(() =>
      expect(resultScene).toHaveBeenLastCalledWith(
        "job_1",
        1,
        "displacement",
        "cells",
      ),
    );
    await waitFor(() => expect(labels()).toEqual(["Min. 0", "Max. 0.5"]));
    expect(markers()).toEqual([0, 2]);

    // a 2D model is not cut by z
    const calls = resultScene.mock.calls.length;
    const planar = [
      { command: "model.settings", name: "settings", analysis: "plane-strain" },
    ] as unknown as Command[];
    rerender(results({ ...cut, axis: "z" }, planar));
    await screen.findByRole("combobox", { name: "Cut" });
    expect(resultScene).toHaveBeenCalledTimes(calls);
  });
});
