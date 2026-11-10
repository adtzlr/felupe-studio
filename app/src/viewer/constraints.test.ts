import { describe, expect, it } from "vitest";
import type { Command, MpcAdd } from "../core/commands";
import type { ResultScene } from "../worker/protocol";
import { boundarySymbols } from "./boundaries";
import {
  constraintLines,
  constraintShapes,
  overConstrained,
  resultPlacement,
} from "./constraints";
import { CONTROL_COLOR } from "./palette";

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
    const [lines] = constraintLines(shapes, { highlight: "#ffd23f" });
    expect(lines).toMatchObject({ color: CONTROL_COLOR, width: 1 });
    expect([...lines.positions]).toEqual([
      1.5, 0.5, 0, 1, 0, 0, 1.5, 0.5, 0, 1, 1, 0,
    ]);
    const [chosen] = constraintLines(shapes, {
      highlight: "#ffd23f",
      selected: "glue",
    });
    expect(chosen).toMatchObject({ color: "#ffd23f", width: 2 });
    expect(
      constraintLines(shapes, {
        highlight: "#ffd23f",
        hidden: new Set(["glue"]),
      }),
    ).toEqual([]);
    // moved points, e.g. of a result
    const [moved] = constraintLines(shapes, {
      highlight: "#ffd23f",
      place: (p) => [p[0] + 1, p[1], p[2]],
    });
    expect(moved.positions[0]).toBe(2.5);
    expect(moved.positions[3]).toBe(2);
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
