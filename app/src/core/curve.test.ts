import { describe, expect, it } from "vitest";
import type { Command } from "./commands";
import {
  curveCsv,
  curveOf,
  finitePoints,
  hasCurve,
  linePath,
  nearest,
  niceTicks,
  scale,
} from "./curve";
import { startProgress } from "./jobs";
import type { Finished } from "./results";

const result = {
  substeps: 4,
  time: 1,
  x: [
    [0, 0, 0],
    [0.1, 0.5, 0],
    [0.2, 1, 0],
    [0.3, 1.5, 0],
  ],
  y: [
    [0, 0, 0],
    [1, 0.1, 0],
    [null, 0.2, 0],
    [3, 0.3, 0],
  ],
};

describe("force-displacement curve", () => {
  it("takes the points of a component", () => {
    expect(hasCurve(result)).toBe(true);
    expect(hasCurve({ substeps: 1, time: 0 })).toBe(false);
    expect(hasCurve(undefined)).toBe(false);
    const points = curveOf(result, 0);
    expect(points[2]).toEqual({ substep: 3, u: 0.2, f: null });
    expect(curveOf(result, 1)[3]).toEqual({ substep: 4, u: 1.5, f: 0.3 });
    expect(finitePoints(points).map((p) => p.substep)).toEqual([1, 2, 4]);
  });

  it("finds round ticks", () => {
    expect(niceTicks(0, 1)).toEqual([0, 0.2, 0.4, 0.6, 0.8, 1]);
    expect(niceTicks(0, 0.5011)).toEqual([0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6]);
    expect(niceTicks(-3, 7)).toEqual([-4, -2, 0, 2, 4, 6, 8]);
    expect(niceTicks(0, 1234)).toEqual([
      0, 200, 400, 600, 800, 1000, 1200, 1400,
    ]);
    expect(niceTicks(0, 0.3)).toEqual([0, 0.1, 0.2, 0.3]);
    // a range of zero width is widened
    expect(niceTicks(0, 0)).toEqual([-1, -0.5, 0, 0.5, 1]);
    expect(niceTicks(NaN, 1)).toEqual([0, 1]);
  });

  it("draws a path broken at non-finite values", () => {
    const x = scale([0, 1], [0, 100]);
    const y = scale([0, 10], [100, 0]);
    expect(y(5)).toBe(50);
    expect(scale([1, 1], [0, 10])(5)).toBe(0);
    expect(linePath(curveOf(result, 0), x, y)).toBe(
      "M0.0,100.0L10.0,90.0M30.0,70.0",
    );
    // the nearest finite point to a pixel position
    expect(nearest(curveOf(result, 0), 19, x)).toBe(1);
    expect(nearest(curveOf(result, 0), 21, x)).toBe(3);
    expect(nearest([], 0, x)).toBeUndefined();
  });

  it("exports all components as CSV", () => {
    const run: Finished = {
      state: "finished",
      commands: [
        { command: "job.add", name: "job_1", steps: ["load", "hold"] },
      ] as unknown as Command[],
      progress: { ...startProgress(), plan: { job_1: [3, 1] } },
      results: { job_1: result },
    };
    expect(curveCsv(run, "job_1").split("\n")).toEqual([
      "substep,step,u_x,u_y,u_z,F_x,F_y,F_z",
      "1,load,0,0,0,0,0,0",
      "2,load,0.1,0.5,0,1,0.1,0",
      "3,load,0.2,1,0,,0.2,0",
      "4,hold,0.3,1.5,0,3,0.3,0",
      "",
    ]);
  });
});
