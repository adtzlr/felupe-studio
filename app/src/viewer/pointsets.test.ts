import { describe, expect, it } from "vitest";
import type { Command } from "../core/commands";
import {
  outlined,
  planeName,
  planeSelect,
  selectedPoints,
  tolerance,
} from "./pointsets";

// nodes of two meshes sharing the points at x = 1
const left = Float64Array.from([0, 0, 0, 1, 0, 0, 0, 1, 0, 1, 1, 0]);
const right = Float64Array.from([1, 0, 0, 2, 0, 0, 1, 1, 0, 2, 1, 0]);

describe("point sets", () => {
  it("select the nodes of a coordinate without duplicates", () => {
    const points = selectedPoints({ axis: "x", value: 1 }, [left, right]);
    expect([...points]).toEqual([1, 0, 0, 1, 1, 0]);
    expect(selectedPoints({ ids: [0, 1] }, [left])).toHaveLength(0);
  });

  it("use the tolerances of np.isclose", () => {
    const shifted = Float64Array.from([100.0005, 0, 0]);
    // atol + rtol * |value|: 1e-8 + 1e-5 * 100 = 1e-3
    expect(selectedPoints({ axis: "x", value: 100 }, [shifted])).toHaveLength(
      3,
    );
    expect(
      selectedPoints({ axis: "x", value: 0.001 }, [
        Float64Array.from([0.0011, 0, 0]),
      ]),
    ).toHaveLength(0);
    expect(
      selectedPoints({ axis: "x", value: 0.001, atol: 1e-3 }, [
        Float64Array.from([0.0011, 0, 0]),
      ]),
    ).toHaveLength(3);
  });

  it("take the exact coordinate of the nodes of a picked plane", () => {
    const nodes = [Float64Array.from([0.1, 0, 0, 0.1, 1, 0, 0.7, 0, 0])];
    // the hit is on float32 coordinates
    const select = planeSelect(0, [Math.fround(0.1), 0.5, 0], nodes);
    expect(select).toEqual({ axis: "x", value: 0.1 });
    expect(tolerance(nodes)).toBeGreaterThan(1e-7);
  });

  it("widen the tolerance to the spread of the nodes in the plane", () => {
    const nodes = [Float64Array.from([0, 0, 0, 0, 1, 0, 2e-7, 0, 1, 1, 0, 0])];
    expect(planeSelect(0, [0, 0.5, 0.5], nodes)).toEqual({
      axis: "x",
      value: 0,
      atol: 1e-6,
    });
    // within the relative tolerance of np.isclose at x = 3
    const far = [
      Float64Array.from([3, 0, 0, 3, 1, 0, 3 + 2e-7, 0, 1, 0, 0, 0]),
    ];
    expect(planeSelect(0, [3, 0.5, 0.5], far)).toEqual({ axis: "x", value: 3 });
  });

  it("are named after the bounds or the coordinate", () => {
    const nodes = [left, right];
    const taken: Command[] = [
      {
        command: "pointset.add",
        name: "x_min",
        select: { axis: "x", value: 0 },
      },
    ];
    expect(planeName({ axis: "x", value: 0 }, nodes, [])).toBe("x_min");
    expect(planeName({ axis: "x", value: 0 }, nodes, taken)).toBe("x_min_2");
    expect(planeName({ axis: "x", value: 2 }, nodes, [])).toBe("x_max");
    expect(planeName({ axis: "x", value: 1.5 }, nodes, [])).toBe("x_1_5");
  });

  it("are drawn with an outline", () => {
    const markers = outlined(Float64Array.from([0, 0, 0]), "#ffffff");
    expect(markers.map((m) => [m.color, m.size])).toEqual([
      ["#11151c", 11],
      ["#ffffff", 7],
    ]);
    expect(outlined(new Float64Array(), "#ffffff")).toEqual([]);
  });
});
