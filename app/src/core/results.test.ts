import { describe, expect, it } from "vitest";
import type { Command } from "./commands";
import { startProgress } from "./jobs";
import {
  advance,
  curvePoint,
  type Direction,
  type Finished,
  formatValue,
  nextSubstep,
  quantityGroups,
  stepOf,
  substepsAhead,
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

describe("the substeps ahead (#141)", () => {
  it("loop after the last substep", () => {
    expect(nextSubstep(2, 5)).toBe(3);
    expect(nextSubstep(5, 5)).toBe(1);
    expect(substepsAhead(3, 5, 4)).toEqual([4, 5, 1, 2]);
    // never the substep itself
    expect(substepsAhead(2, 3, 4)).toEqual([3, 1]);
    expect(substepsAhead(1, 1, 4)).toEqual([]);
  });

  it("go back and forth", () => {
    // forward, turn at the last substep, backward, turn at the first one
    const played: number[] = [];
    let state: [number, Direction] = [1, 1];
    for (let i = 0; i < 9; i++) {
      state = advance(state[0], 4, "bounce", state[1]);
      played.push(state[0]);
    }
    expect(played).toEqual([2, 3, 4, 3, 2, 1, 2, 3, 4]);
    // from the last substep backward, also from a substep beyond the ends
    expect(advance(5, 5, "bounce", 1)).toEqual([4, -1]);
    expect(advance(7, 5, "bounce", 1)).toEqual([6, -1]);
    expect(advance(1, 5, "bounce", -1)).toEqual([2, 1]);
    expect(advance(3, 5, "bounce", -1)).toEqual([2, -1]);
    // a single substep stays
    expect(advance(1, 1, "bounce", 1)).toEqual([1, 1]);
    // looping is always forward
    expect(advance(5, 5, "loop", -1)).toEqual([1, 1]);
    // the substeps ahead in the order of playing, each once
    expect(substepsAhead(3, 5, 4, "bounce", 1)).toEqual([4, 5]);
    expect(substepsAhead(4, 5, 4, "bounce", -1)).toEqual([3, 2, 1]);
    expect(substepsAhead(2, 2, 4, "bounce", 1)).toEqual([1]);
  });
});

describe("quantities of the contour", () => {
  const ids = (commands: Command[]) =>
    quantityGroups(commands).flatMap((g) => g.options.map((o) => o.id));

  it("has no displacement in z in a 2D model (#175)", () => {
    expect(ids([])).toContain("displacement_z");
    const settings = (analysis: string) =>
      [{ command: "model.settings", analysis }] as Command[];
    expect(ids(settings("3d"))).toContain("displacement_z");
    expect(ids(settings("axisymmetric"))).not.toContain("displacement_z");
    expect(ids(settings("plane-strain"))).toEqual(
      ids([]).filter((id) => id !== "displacement_z"),
    );
  });
});
