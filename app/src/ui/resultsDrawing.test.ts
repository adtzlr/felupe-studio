import { describe, expect, it, vi } from "vitest";
import type { Command } from "../core/resolved";
import type { ResultView } from "../core/results";
import { planeOf } from "../viewer/cut";
import { VIEW_COLORS } from "../viewer/palette";
import type { Highlight, Lines, Markers } from "../viewer/scene";
import type { Viewer } from "../viewer/viewer";
import type { ResultScene } from "../worker/protocol";
import { drawResults } from "./resultsDrawing";

/** A viewer that keeps what it is given to draw. */
function fakeViewer() {
  const drawn = {
    markers: [] as Markers[],
    faces: [] as Highlight[],
    lines: [] as Lines[],
  };
  const viewer = {
    setColors: vi.fn(),
    setResult: vi.fn(),
    setNodes: vi.fn(),
    setTargets: vi.fn(),
    setLabels: vi.fn(),
    setMarkers: (markers: Markers[]) => (drawn.markers = markers),
    setFaces: (faces: Highlight[]) => (drawn.faces = faces),
    setLines: (lines: Lines[]) => (drawn.lines = lines),
  };
  return { viewer: viewer as unknown as Viewer, drawn };
}

/** The x of the points of flat arrays, once each, rounded. */
const xs = (arrays: readonly { positions: ArrayLike<number> }[]) => [
  ...new Set(
    arrays.flatMap((a) =>
      Array.from(a.positions)
        .filter((_, i) => i % 3 === 0)
        .map((x) => +x.toFixed(4)),
    ),
  ),
];

// a unit cube, cut at x = 0.5: its nodes beyond the plane are not drawn, but are
// those of the whole outer surface
const cube = Float32Array.from([
  0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0, 0, 0, 1, 1, 0, 1, 1, 1, 1, 0, 1, 1,
]);
const moved = Float32Array.from({ length: 24 }, (_, i) =>
  i % 3 === 0 ? 0.2 : 0,
);
const cut = { axis: "x", value: 0.5, half: "+" } as const;
const scene: ResultScene = {
  label: "Displacement",
  at: "point",
  range: [0, 1],
  cut,
  points: [
    { name: "center", position: [0, 0.5, 0.5], displacement: [0.1, 0, 0] },
    { name: "plate", position: [1, 0.5, 0.5], displacement: [-0.8, 0, 0] },
    { name: "wall", position: [0.25, 0.5, 0.5], displacement: [0.5, 0, 0] },
  ],
  surfaces: [
    {
      name: "solid",
      positions: Float32Array.from([0, 0, 0, 0.5, 0, 0, 0.5, 1, 0]),
      displacement: new Float32Array(9),
      triangles: Uint32Array.from([0, 1, 2]),
      edges: new Uint32Array(),
      values: new Float32Array(3),
      owners: new Uint32Array(1),
      nodes: Int32Array.from([0, -1, -1]),
      outer: 1,
      uncut: { positions: cube, displacement: moved },
    },
  ],
};
// a constraint from the center to the far side (x = 1), and two rigid surfaces:
// the plate on the far side moved into the visible half, the wall moved beyond it
const commands = [
  { command: "point.add", name: "center", coordinates: [0, 0.5, 0.5] },
  {
    command: "pointset.add",
    name: "far",
    select: { axis: "x", bound: "max" },
  },
  {
    command: "mpc.add",
    name: "connect",
    center: "center",
    points: "far",
    constrained: ["x"],
  },
  {
    command: "rigid.add",
    name: "plate",
    coordinates: [1, 0.5, 0.5],
    shape: { normal: [-1, 0, 0] },
  },
  {
    command: "rigid.add",
    name: "wall",
    coordinates: [0.25, 0.5, 0.5],
    shape: { normal: [1, 0, 0] },
  },
] as unknown as Command[];
const view: ResultView = {
  job: "job_1",
  substep: 1,
  quantity: "displacement",
  scale: 1,
  undeformed: false,
  curve: false,
};

const draw = (plane?: ReturnType<typeof planeOf>) => {
  const { viewer, drawn } = fakeViewer();
  drawResults(viewer, {
    scene,
    view,
    edges: true,
    nodes: false,
    constraints: true,
    extremesShown: false,
    onPin: () => {},
    commands,
    colors: VIEW_COLORS.dark,
    plane,
  });
  return drawn;
};

describe("the results of a cut scene (#395)", () => {
  it("draws the constraints and the rigid surfaces without a plane", () => {
    const drawn = draw();
    // the center and the far side, moved; the plate and the wall where they are
    expect(xs(drawn.markers)).toEqual([0.1, 0.2, 0.75]);
    expect(xs([drawn.lines[0]])).toEqual([0.1, 1.2]);
    expect(xs(drawn.faces)).toEqual([0.2, 0.75]);
  });

  it("clips them at the plane through the undeformed model", () => {
    const drawn = draw(planeOf(cut, Math.sqrt(3)));
    // the control points in the visible half, the plate's is beyond the plane
    expect(xs(drawn.markers)).toEqual([0.1, 0.75]);
    // the lines to the far side end at the plane, moved like it: halfway
    expect(xs([drawn.lines[0]])).toEqual([0.1, 0.65]);
    // the plate is on the far side, though moved into the visible half; the wall
    // is drawn, though moved beyond the plane
    expect(xs(drawn.faces)).toEqual([0.75]);
    expect(drawn.faces).toHaveLength(1);
  });
});
