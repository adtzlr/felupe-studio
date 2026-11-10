import { describe, expect, it } from "vitest";
import type { Command } from "./commands";
import { startProgress } from "./jobs";
import {
  curvePoint,
  type Finished,
  formatValue,
  stepOf,
  substepsOf,
  viewOf,
} from "./results";

const commands = [
  { command: "job.add", name: "job_1", steps: ["load", "unload"] },
] as unknown as Command[];

const run: Finished = {
  state: "finished",
  commands,
  progress: { ...startProgress(), plan: { job_1: [3, 2] } },
  results: {
    job_1: {
      substeps: 5,
      time: 1,
      x: [
        [0, 0, 0],
        [0.1, 0.01, 0],
        [0.2, 0.02, 0],
        [0.1, 0.01, 0],
        [-0.3, 0, 0],
      ],
      y: [
        [0, 0, 0],
        [1, 0, 0],
        [2, 0, 0],
        [1, 0, 0],
        [null, 0, 0],
      ],
    },
    job_2: { substeps: 2, time: 1 },
  },
};

describe("results view", () => {
  it("starts at the last substep and keeps the choices", () => {
    expect(viewOf(run, undefined)).toEqual({
      job: "job_1",
      substep: 5,
      quantity: "displacement",
      scale: 1,
      undeformed: true,
      curve: true,
    });
    const previous = {
      job: "job_2",
      substep: 1,
      quantity: "stress_mises" as const,
      scale: 5,
      undeformed: false,
      curve: false,
      axis: 1,
    };
    expect(viewOf(run, previous)).toEqual({ ...previous, substep: 2 });
    expect(viewOf(run, { ...previous, job: "gone" }).job).toBe("job_1");
    expect(substepsOf(run, "job_2")).toBe(2);
    expect(substepsOf(run, "gone")).toBe(0);
  });

  it("finds the step of a substep", () => {
    expect(stepOf(run, "job_1", 1)).toEqual({
      name: "load",
      step: 1,
      substep: 1,
      substeps: 3,
    });
    expect(stepOf(run, "job_1", 3)).toMatchObject({ name: "load", substep: 3 });
    expect(stepOf(run, "job_1", 4)).toEqual({
      name: "unload",
      step: 2,
      substep: 1,
      substeps: 2,
    });
    expect(stepOf(run, "job_2", 2)).toMatchObject({ name: "", substep: 2 });
  });

  it("takes the curve along the axis of the largest last displacement", () => {
    const result = run.results.job_1;
    expect(curvePoint(result, 3)).toEqual({ axis: "x", u: 0.2, f: 2 });
    expect(curvePoint(result, 3, 1)).toEqual({ axis: "y", u: 0.02, f: 0 });
    // non-finite values are null
    expect(curvePoint(result)).toBeUndefined();
    expect(curvePoint(run.results.job_2)).toBeUndefined();
  });

  it("formats values", () => {
    expect(formatValue(0.123456)).toBe("0.1235");
    expect(formatValue(12345.6)).toBe("1.235e+4");
    expect(formatValue(0.0001234)).toBe("1.234e-4");
    expect(formatValue(0)).toBe("0");
  });
});
