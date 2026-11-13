import { describe, expect, it } from "vitest";
import type { Command } from "./commands";
import {
  axisTicks,
  curveCsv,
  curveQuantities,
  curveOf,
  DEFAULT_CURVE,
  defaultSeries,
  finitePoints,
  fixedRange,
  hasCurve,
  linePath,
  loadCurve,
  logTicks,
  monotonic,
  nearest,
  niceTicks,
  plotted,
  plottedPoints,
  saveCurve,
  scale,
  seriesLabel,
  seriesName,
  seriesOf,
  seriesValues,
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
    const points = curveOf(result, "ux", "Fx");
    expect(points[2]).toEqual({ substep: 3, u: 0.2, f: null });
    expect(curveOf(result, "uy", "Fy")[3]).toEqual({
      substep: 4,
      u: 1.5,
      f: 0.3,
    });
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
    expect(linePath(curveOf(result, "ux", "Fx"), x, y)).toBe(
      "M0.0,100.0L10.0,90.0M30.0,70.0",
    );
    // the nearest finite point to a pixel position
    expect(nearest(curveOf(result, "ux", "Fx"), 19, x)).toBe(1);
    expect(nearest(curveOf(result, "ux", "Fx"), 21, x)).toBe(3);
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
    // a 2D model has two components (#175)
    const planar = {
      ...result,
      x: result.x.map((x) => x.slice(0, 2)),
      y: result.y.map((y) => y.slice(0, 2)),
    };
    expect(
      curveCsv({ ...run, results: { job_1: planar } }, "job_1").split("\n"),
    ).toEqual([
      "substep,step,u_x,u_y,F_x,F_y",
      "1,load,0,0,0,0",
      "2,load,0.1,0.5,1,0.1",
      "3,load,0.2,1,,0.2",
      "4,hold,0.3,1.5,3,0.3",
      "",
    ]);
    expect(seriesOf(planar)).toEqual(["ux", "uy", "Fx", "Fy", "substep"]);
    expect(seriesOf(result)).toHaveLength(7);
  });

  it("shows the moment over the rotation of a rotation point (#98)", () => {
    const commands = [
      { command: "point.add", name: "turn", coordinates: [4, 0, 0] },
      {
        command: "mpc.add",
        name: "glue",
        points: "right",
        center: "plate",
        constrained: ["x", "y", "z"],
        rotation: "turn",
      },
      {
        command: "boundary.add",
        name: "twist",
        pointset: "turn",
        constrained: ["x"],
      },
      { command: "job.add", name: "job_1", steps: ["load"], curve: "twist" },
      { command: "job.add", name: "job_2", steps: ["load"], curve: "move" },
    ] as unknown as Command[];
    expect(curveQuantities(commands, "job_1")).toMatchObject({
      title: "Moment–rotation",
      u: "φ",
      f: "M",
    });
    expect(curveQuantities(commands, "job_2").title).toBe("Force–displacement");
    const run: Finished = {
      state: "finished",
      commands,
      progress: { ...startProgress(), plan: { job_1: [4] } },
      results: { job_1: result },
    };
    // rotations are always in rad
    expect(curveCsv(run, "job_1").split("\n")[0]).toBe(
      "substep,step,phi_x [rad],phi_y [rad],phi_z [rad],M_x,M_y,M_z",
    );
    // with the units of the model (#132)
    const settings = {
      command: "model.settings",
      name: "settings",
      units: { length: "mm", force: "N" },
    } as Command;
    expect(
      curveCsv({ ...run, commands: [settings, ...commands] }, "job_1"),
    ).toMatch(/^substep,step,phi_x \[rad\],.*,M_z \[N mm\]\n/);
  });

  it("has the units of the model (#132)", () => {
    const commands = [
      {
        command: "model.settings",
        name: "settings",
        units: { length: "m", force: "kN" },
      },
      { command: "job.add", name: "job_1", steps: ["load"], curve: "move" },
    ] as unknown as Command[];
    expect(curveQuantities(commands, "job_1")).toMatchObject({
      uUnit: "m",
      fUnit: "kN",
    });
    expect(curveQuantities(commands.slice(1), "job_1")).toMatchObject({
      uUnit: undefined,
      fUnit: undefined,
    });
    const run: Finished = {
      state: "finished",
      commands,
      progress: { ...startProgress(), plan: { job_1: [4] } },
      results: { job_1: result },
    };
    expect(curveCsv(run, "job_1").split("\n")[0]).toBe(
      "substep,step,u_x [m],u_y [m],u_z [m],F_x [kN],F_y [kN],F_z [kN]",
    );
  });
});

describe("axes of the curve (#197)", () => {
  const q = curveQuantities([], "job_1");

  it("plots any component over any other, or over the substep", () => {
    expect(defaultSeries(result)).toEqual(["uy", "Fy"]);
    // of equal displacements, the one with the largest force (#222)
    const sheared = {
      ...result,
      x: [[40, 0, 40]],
      y: [[3000, 80, -18000]],
    };
    expect(defaultSeries(sheared)).toEqual(["uz", "Fz"]);
    expect(defaultSeries({ ...sheared, y: [[3000, 0, 1]] })).toEqual([
      "ux",
      "Fx",
    ]);
    expect(curveOf(result, "ux", "uy")[3]).toEqual({
      substep: 4,
      u: 0.3,
      f: 1.5,
    });
    expect(curveOf(result, "substep", "Fx").map((p) => p.u)).toEqual([
      1, 2, 3, 4,
    ]);
    expect(curveOf(result, "Fz", "Fx")[2]).toEqual({
      substep: 3,
      u: 0,
      f: null,
    });
    expect(seriesName("uz", q)).toBe("uz");
    expect(seriesName("substep", q)).toBe("Substep");
    expect(seriesLabel("Fy", q)).toMatchObject({
      quantity: "Force",
      symbol: "F",
    });
    // the values of the axes at a substep, without the substep and a missing one
    expect(seriesValues(result, 2, ["ux", "Fx"], q)).toMatchObject([
      { label: { symbol: "u", component: "x" }, value: 0.1 },
      { label: { symbol: "F", component: "x" }, value: 1 },
    ]);
    expect(seriesValues(result, 3, ["substep", "Fx"], q)).toEqual([]);
    expect(seriesValues(result, 2, ["uy", "uy"], q)).toHaveLength(1);
  });

  it("negates values and takes logarithms of absolute values", () => {
    const log = { scale: "log", negate: false } as const;
    expect(plotted(-2, { scale: "linear", negate: true })).toBe(2);
    expect(plotted(-100, log)).toBe(2);
    expect(plotted(0, log)).toBeNull();
    expect(plotted(null, DEFAULT_CURVE.x)).toBeNull();
    const points = plottedPoints(curveOf(result, "ux", "Fx"), {
      x: log,
      y: { scale: "linear", negate: true },
    });
    expect(points[0]).toEqual({ substep: 1, u: null, f: -0 });
    expect(points[3].f).toBe(-3);
  });

  it("has ticks of the values, of a fixed range, or of powers of ten", () => {
    expect(axisTicks([0.1, 0.3], DEFAULT_CURVE.x)).toEqual({
      domain: [0, 0.3],
      ticks: [0, 0.1, 0.2, 0.3],
    });
    expect(
      axisTicks([0.1, 0.3], {
        scale: "linear",
        negate: false,
        min: 0.1,
        max: 0.2,
      }),
    ).toEqual({
      domain: [0.1, 0.2],
      ticks: [0.1, 0.12, 0.14, 0.16, 0.18, 0.2],
    });
    expect(logTicks(-2.5, 1.2)).toEqual([-3, -2, -1, 0, 1, 2]);
    expect(logTicks(0, 0)).toEqual([0, 1]);
    expect(logTicks(-20, 0)).toEqual([-20, -16, -12, -8, -4, 0]);
    const log = { scale: "log", negate: false } as const;
    expect(axisTicks([-1, 0.5], log)).toEqual({
      domain: [-1, 1],
      ticks: [-1, 0, 1],
    });
    expect(axisTicks([], log).ticks).toEqual([0, 1]);
    expect(axisTicks([], { ...log, min: 0.01, max: 10 })).toEqual({
      domain: [-2, 1],
      ticks: [-2, -1, 0, 1],
    });
    // a fixed range needs min < max, and positive limits on a log scale
    expect(fixedRange({ ...log, min: 0, max: 10 })).toBeUndefined();
    expect(fixedRange({ ...log, min: 2, max: 1 })).toBeUndefined();
    expect(
      fixedRange({ scale: "linear", negate: false, min: -1, max: 1 }),
    ).toEqual([-1, 1]);
  });

  it("finds the nearest point in the plane if the curve turns back", () => {
    const x = scale([0, 1], [0, 100]);
    const y = scale([0, 1], [100, 0]);
    const loop = [
      { substep: 1, u: 0, f: 0 },
      { substep: 2, u: 1, f: 0 },
      { substep: 3, u: 1, f: 1 },
      { substep: 4, u: 0.1, f: 1 },
    ];
    expect(monotonic(loop)).toBe(false);
    expect(monotonic(curveOf(result, "ux", "Fx"))).toBe(true);
    // at the top left: the last point, not the first one (nearer by x only)
    expect(nearest(loop, 5, x, 5, y)).toBe(3);
    expect(nearest(loop, 5, x)).toBe(0);
  });

  it("keeps the options of the axes in the browser", () => {
    const storage = new Map<string, string>();
    const fake = {
      getItem: (k: string) => storage.get(k) ?? null,
      setItem: (k: string, v: string) => storage.set(k, v),
    } as unknown as Storage;
    expect(loadCurve(fake)).toEqual(DEFAULT_CURVE);
    const settings = {
      x: { scale: "log", negate: false, min: 0.1, max: 10 },
      y: { scale: "linear", negate: true },
    } as const;
    saveCurve(settings, fake);
    expect(loadCurve(fake)).toEqual(settings);
    storage.set("felupe-studio.curve", '{"x": {"scale": "cubic", "min": 1}}');
    expect(loadCurve(fake)).toEqual(DEFAULT_CURVE);
    storage.set("felupe-studio.curve", "not json");
    expect(loadCurve(fake)).toEqual(DEFAULT_CURVE);
  });
});
