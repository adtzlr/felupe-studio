import { describe, expect, it } from "vitest";
import type { ResultScene } from "../worker/protocol";
import type { Command } from "./commands";
import { type JobRun, type Live, startProgress } from "./jobs";
import { liveResults, loadLiveOn, saveLiveOn } from "./live";

const commands = [
  { command: "job.add", name: "job_1", steps: ["step_1"], curve: "move" },
  { command: "job.add", name: "job_2", steps: ["step_1"] },
] as Command[];
const scene = { label: "Stress", surfaces: [] } as unknown as ResultScene;
const progress = {
  ...startProgress(),
  jobs: ["job_1", "job_2"],
  plan: { job_1: [3, 2], job_2: [4] },
  job: "job_1",
};
const live: Live = {
  quantity: "stress_mises",
  jobs: {
    job_1: {
      substep: 3,
      x: [
        [0, 0, 0],
        [0.1, 0, 0],
        [0.2, 0, 0],
      ],
      y: [
        [0, 0, 0],
        [1, 0, 0],
        [2, 0, 0],
      ],
      scene,
      sceneSubstep: 2,
    },
  },
};
const running: JobRun = { state: "running", progress, commands, live };

describe("live results (#207)", () => {
  it("show the last scene and the curve of the running job", () => {
    const results = liveResults(running, undefined, {
      quantity: "displacement",
      scale: 2,
    })!;
    expect(results.view).toMatchObject({
      job: "job_1",
      substep: 2,
      quantity: "stress_mises",
      scale: 2,
      curve: true,
    });
    expect(results.scene).toBe(scene);
    expect(results.status).toBe("Live · substep 2 of 5");
    expect(results.run.results).toEqual({
      job_1: {
        substeps: 5,
        time: 0,
        x: live.jobs.job_1.x,
        y: live.jobs.job_1.y,
      },
    });
    expect(results.run.commands).toBe(commands);
  });

  it("follow the running job, or the chosen one", () => {
    const next: JobRun = {
      ...running,
      progress: { ...progress, job: "job_2", times: { job_1: 0.5 } },
      live: {
        ...live,
        jobs: { ...live.jobs, job_2: { substep: 1, x: [], y: [] } },
      },
    };
    const results = liveResults(next, undefined, undefined)!;
    // without a scene yet, at its last converged substep, without a curve
    expect(results.view.job).toBe("job_2");
    expect(results.scene).toBeUndefined();
    expect(results.run.results.job_2).toEqual({ substeps: 4, time: 0 });
    const first = liveResults(next, "job_1", undefined)!;
    expect(first.status).toBe("job_1 finished · substep 2 of 5");
    expect(first.run.results.job_1.time).toBe(0.5);
  });

  it("stay after a failed or cancelled run, until the next one", () => {
    expect(
      liveResults({ ...running, state: "cancelled" }, undefined, undefined)!
        .status,
    ).toBe("Cancelled after substep 3 of 5");
    expect(
      liveResults(
        { ...running, state: "failed", message: "NewtonConvergenceError" },
        undefined,
        undefined,
      )!.status,
    ).toBe("Failed after substep 3 of 5");
    expect(
      liveResults({ state: "idle" }, undefined, undefined),
    ).toBeUndefined();
    expect(
      liveResults({ ...running, live: { jobs: {} } }, undefined, undefined),
    ).toBeUndefined();
  });

  it("are on by default, kept in the browser", () => {
    const storage = new Map<string, string>();
    const fake = {
      getItem: (k: string) => storage.get(k) ?? null,
      setItem: (k: string, v: string) => storage.set(k, v),
    } as unknown as Storage;
    expect(loadLiveOn(fake)).toBe(true);
    saveLiveOn(false, fake);
    expect(loadLiveOn(fake)).toBe(false);
    saveLiveOn(true, fake);
    expect(loadLiveOn(fake)).toBe(true);
  });
});
