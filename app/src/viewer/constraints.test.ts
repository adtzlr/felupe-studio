import { describe, expect, it } from "vitest";
import type { Command, MpcAdd } from "../core/resolved";
import type { ResultScene } from "../worker/protocol";
import { boundaryLines, boundarySymbols, strokes } from "./boundaries";
import {
  constraintLines,
  constraintShapes,
  frameLines,
  localOverlaps,
  overConstrained,
  pointsOnAxis,
  resultPlacement,
} from "./constraints";
import { AXIS_COLORS, FADED, VIEW_COLORS } from "./palette";

// the nodes of a unit square in the plane z = 0 and of its face at x = 1
const nodes = [Float64Array.from([0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0])];

const glue: MpcAdd = {
  command: "mpc.add",
  name: "glue",
  points: "right",
  center: "plate",
  constrained: ["x", "y"],
};

const commands = [
  {
    command: "pointset.add",
    name: "right",
    select: { axis: "x", value: 1 },
  },
  { command: "point.add", name: "plate", coordinates: [1.5, 0.5, 0] },
  glue,
  {
    command: "boundary.add",
    name: "fixed",
    pointset: "right",
    constrained: ["y", "z"],
  },
] as Command[];

describe("multi-point constraints in the viewport (#99)", () => {
  it("have a center point and the connected points", () => {
    const [shape] = constraintShapes(commands, nodes);
    expect(shape.name).toBe("glue");
    expect(shape.center).toEqual([1.5, 0.5, 0]);
    expect([...shape.points]).toEqual([1, 0, 0, 1, 1, 0]);
    // a center point of more than one point is not drawn
    const wide = commands.map((c) =>
      c.name === "glue" ? { ...glue, center: "right" } : c,
    );
    expect(constraintShapes(wide, nodes)).toEqual([]);
  });

  it("are drawn as lines from the center, highlighted or hidden", () => {
    const shapes = constraintShapes(commands, nodes);
    const colors = VIEW_COLORS.dark;
    const [lines] = constraintLines(shapes, { colors });
    expect(lines).toMatchObject({ color: colors.control, width: 1 });
    expect([...lines.positions]).toEqual([
      1.5, 0.5, 0, 1, 0, 0, 1.5, 0.5, 0, 1, 1, 0,
    ]);
    const [chosen] = constraintLines(shapes, { colors, selected: "glue" });
    expect(chosen).toMatchObject({ color: colors.highlight, width: 2 });
    // in the colors of the light theme (#375)
    const light = VIEW_COLORS.light;
    expect(constraintLines(shapes, { colors: light })[0].color).toBe(
      light.control,
    );
    expect(
      constraintLines(shapes, { colors, hidden: new Set(["glue"]) }),
    ).toEqual([]);
    // moved points, e.g. of a result
    const [moved] = constraintLines(shapes, {
      colors,
      place: (p) => [p[0] + 1, p[1], p[2]],
    });
    expect(moved.positions[0]).toBe(2.5);
    expect(moved.positions[3]).toBe(2);
    // faded if it is off in the selected step (#393)
    expect(constraintLines(shapes, { colors })[0].opacity).toBeUndefined();
    const [faded] = constraintLines(shapes, {
      colors,
      faded: new Set(["glue"]),
    });
    expect(faded).toMatchObject({ color: colors.control, opacity: FADED });
  });

  it("report points that a boundary prescribes as well", () => {
    const [shape] = constraintShapes(commands, nodes);
    const symbols = boundarySymbols(commands, nodes);
    expect(overConstrained(glue, shape, symbols)).toEqual([
      { boundary: "fixed", points: 2, components: ["y"] },
    ]);
    expect(
      overConstrained({ ...glue, constrained: ["x"] }, shape, symbols),
    ).toEqual([]);
  });

  it("follow the displacements of a result", () => {
    const scene: ResultScene = {
      label: "Displacement",
      at: "point",
      range: [0, 1],
      points: [
        { name: "plate", position: [1.5, 0.5, 0], displacement: [0.2, 0, 0] },
      ],
      surfaces: [
        {
          name: "square",
          positions: Float32Array.from(nodes[0]),
          displacement: Float32Array.from([
            0, 0, 0, 0.1, 0, 0, 0.1, 0, 0, 0, 0, 0,
          ]),
          triangles: new Uint32Array([0, 1, 2, 0, 2, 3]),
          edges: new Uint32Array(),
          values: new Float32Array(4),
          owners: new Uint32Array([0, 0]),
          nodes: new Int32Array([0, 1, 2, 3]),
        },
      ],
    };
    const { nodes: at, place } = resultPlacement(scene, 2);
    expect([...at[0]]).toEqual([...nodes[0]]);
    const moved = place([1, 1, 0]);
    expect(moved[0]).toBeCloseTo(1.2, 6);
    expect(moved.slice(1)).toEqual([1, 0]);
    // a control point moves with its own displacement
    expect(place([1.5, 0.5, 0])).toEqual([1.9, 0.5, 0]);
  });
});

describe("Cartesian constraints in the viewport (#421)", () => {
  // the points at x = 1 slide on a plane normal to e1 = (1, 1, 0) / √2
  const slide = {
    command: "cartesian.add",
    name: "slide",
    points: "right",
    e1: [1, 1, 0],
    e2: [0, 0, 1],
    constrained: ["1"],
  };
  const model = [...commands, slide] as Command[];

  it("are drawn like boundaries along their base vectors", () => {
    const symbol = boundarySymbols(model, nodes).find(
      (s) => s.owner === "slide",
    )!;
    expect(symbol.components).toEqual([0]);
    expect(symbol.values).toEqual([0]);
    expect(symbol.points).toEqual(Float64Array.from([1, 0, 0, 1, 1, 0]));
    const r = Math.SQRT1_2;
    expect(symbol.axes![0][0]).toBeCloseTo(r);
    expect(symbol.axes![0][1]).toBeCloseTo(r);
    expect(symbol.axes![2][0]).toBeCloseTo(r);
    expect(symbol.axes![2][1]).toBeCloseTo(-r);
    // a stroke through every point along e1, not along x
    const [a, b] = [
      strokes(symbol, 0, 2).subarray(0, 3),
      strokes(symbol, 0, 2).subarray(3, 6),
    ];
    expect(b[0] - a[0]).toBeCloseTo(2 * r, 6);
    expect(b[1] - a[1]).toBeCloseTo(2 * r, 6);
  });

  it("draw the coordinate system of the selected one", () => {
    const symbols = boundarySymbols(model, nodes);
    expect(frameLines(symbols, undefined, 1)).toEqual([]);
    expect(frameLines(symbols, "glue", 1)).toEqual([]);
    const lines = frameLines(symbols, "slide", 1);
    expect(lines.map((l) => l.color)).toEqual([...AXIS_COLORS]);
    // from the center of the points (1, 0.5, 0) along e1
    expect(Array.from(lines[0].positions.subarray(0, 3))).toEqual([1, 0.5, 0]);
    expect(lines[0].positions[3]).toBeCloseTo(1 + 0.15 * Math.SQRT1_2);
    expect(frameLines(symbols, "slide", 1, 2)).toHaveLength(2);
  });

  it("report points that a boundary prescribes in a direction not normal to theirs", () => {
    const symbols = boundarySymbols(model, nodes);
    // fixed prescribes y and z: y is not normal to e1, z is
    expect(localOverlaps("slide", symbols)).toEqual([
      { boundary: "fixed", points: 2, components: ["y"] },
    ]);
    const normal = [
      ...commands,
      { ...slide, e1: [1, 0, 0], e2: [0, 1, 0] },
    ] as Command[];
    expect(localOverlaps("slide", boundarySymbols(normal, nodes))).toEqual([]);
    // the multi-point constraint does not take the directions as components
    const [shape] = constraintShapes(model, nodes);
    expect(overConstrained(glue, shape, symbols)).toEqual([
      { boundary: "fixed", points: 2, components: ["y"] },
    ]);
  });
});

describe("cylindrical constraints in the viewport (#422)", () => {
  // the points at x = 1 in a rigid sleeve about z through the origin
  const sleeve = {
    command: "cylindrical.add",
    name: "sleeve",
    points: "right",
    constrained: ["r"],
  };
  const model = [...commands, sleeve] as Command[];
  const symbolOf = (commands: Command[]) =>
    boundarySymbols(commands, nodes).find((s) => s.owner === "sleeve")!;

  it("are drawn like boundaries along r, θ and z of every point", () => {
    const symbol = symbolOf(model);
    expect(symbol.components).toEqual([0]);
    expect(symbol.cylinder).toEqual({ center: [0, 0, 0], axis: [0, 0, 1] });
    // radially: along x at (1, 0, 0), diagonal at (1, 1, 0)
    const segments = strokes(symbol, 0, 2);
    expect(Array.from(segments.subarray(0, 6))).toEqual([0, 0, 0, 2, 0, 0]);
    const r = Math.SQRT1_2;
    expect(segments[9] - segments[6]).toBeCloseTo(2 * r, 6);
    expect(segments[10] - segments[7]).toBeCloseTo(2 * r, 6);
    // around the axis: along y at (1, 0, 0)
    const around = symbolOf([
      ...commands,
      { ...sleeve, constrained: ["theta"] },
    ] as Command[]);
    expect(around.components).toEqual([1]);
    expect(Array.from(strokes(around, 1, 2).subarray(0, 6))).toEqual([
      1, -1, 0, 1, 1, 0,
    ]);
  });

  it("draw a radial displacement as arrows along r of every point", () => {
    const moved = [...commands, { ...sleeve, value: 0.1 }] as Command[];
    const symbols = boundarySymbols(moved, nodes).filter(
      (s) => s.owner === "sleeve",
    );
    const [arrows] = boundaryLines(symbols, {
      size: 10,
      colors: VIEW_COLORS.dark,
    });
    // the shaft of the first arrow from (1, 0, 0) along x, of the second along
    // (1, 1, 0) / √2
    expect(Array.from(arrows.positions.subarray(0, 6))).toEqual([
      1, 0, 0, 2, 0, 0,
    ]);
    const second = arrows.positions.length / 2;
    const [x0, y0, , x1, y1] = arrows.positions.subarray(second, second + 6);
    expect(x1 - x0).toBeCloseTo(Math.SQRT1_2, 6);
    expect(y1 - y0).toBeCloseTo(Math.SQRT1_2, 6);
  });

  it("draw the axis of the selected one", () => {
    const symbols = boundarySymbols(
      [...commands, { ...sleeve, center: [0, 0, -1] }] as Command[],
      nodes,
    );
    const [axis] = frameLines(symbols, "sleeve", 1);
    expect(axis.color).toBe(AXIS_COLORS[2]);
    // from below the points along z
    const [x, y, z] = axis.positions;
    expect([x, y]).toEqual([0, 0]);
    expect(z).toBeLessThan(1);
    // of a 2D model, a cross at the center
    const [cross] = frameLines(symbols, "sleeve", 1, 2);
    expect(Array.from(cross.positions.subarray(0, 6))).toEqual(
      [-0.03, 0, 0, 0.03, 0, 0].map(Math.fround),
    );
  });

  it("report points that a boundary prescribes in a direction not normal to theirs", () => {
    // fixed prescribes y and z: y is radial at (1, 1, 0) only
    expect(localOverlaps("sleeve", boundarySymbols(model, nodes))).toEqual([
      { boundary: "fixed", points: 1, components: ["y"] },
    ]);
  });

  it("report the points on the axis that it holds radially or around it", () => {
    const at = (changes: object) =>
      pointsOnAxis(
        "sleeve",
        boundarySymbols(
          [...commands, { ...sleeve, ...changes }] as Command[],
          nodes,
        ),
      );
    expect(at({})).toBe(0);
    expect(at({ center: [1, 0, 0] })).toBe(1);
    expect(at({ center: [1, 0, 0], constrained: ["theta", "z"] })).toBe(1);
    expect(at({ center: [1, 0, 0], constrained: ["z"] })).toBe(0);
    expect(pointsOnAxis("glue", boundarySymbols(model, nodes))).toBe(0);
  });
});
