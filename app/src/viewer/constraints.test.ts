import { describe, expect, it } from "vitest";
import type { Command, MpcAdd } from "../core/resolved";
import type { ResultScene } from "../worker/protocol";
import { boundarySymbols, strokes } from "./boundaries";
import {
  cartesianOverlaps,
  constraintLines,
  constraintShapes,
  frameLines,
  overConstrained,
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
    expect(cartesianOverlaps("slide", symbols)).toEqual([
      { boundary: "fixed", points: 2, components: ["y"] },
    ]);
    const normal = [
      ...commands,
      { ...slide, e1: [1, 0, 0], e2: [0, 1, 0] },
    ] as Command[];
    expect(cartesianOverlaps("slide", boundarySymbols(normal, nodes))).toEqual(
      [],
    );
    // the multi-point constraint does not take the directions as components
    const [shape] = constraintShapes(model, nodes);
    expect(overConstrained(glue, shape, symbols)).toEqual([
      { boundary: "fixed", points: 2, components: ["y"] },
    ]);
  });
});
