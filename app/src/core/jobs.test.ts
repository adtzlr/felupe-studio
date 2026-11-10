import { describe, expect, it, vi } from "vitest";
import type { JobEvent, JobResult } from "../worker/protocol";
import type { Command } from "./commands";
import {
  advance,
  exceptionOf,
  fraction,
  type JobClient,
  JobRunner,
  solveBlocker,
  startProgress,
} from "./jobs";

const events: JobEvent[] = [
  { event: "start", jobs: ["job_1", "job_2"], substeps: { job_1: [3, 2] } },
  {
    event: "substep",
    job: "job_1",
    step: 0,
    steps: 2,
    substep: 0,
    substeps: 3,
  },
  { event: "iteration", iteration: 1, fnorm: 0.5, xnorm: 1 },
  { event: "iteration", iteration: 2, fnorm: 1e-9, xnorm: 1e-5 },
  { event: "converged", step: 0, substep: 0, iterations: 2, increments: 1 },
  {
    event: "substep",
    job: "job_1",
    step: 1,
    steps: 2,
    substep: 1,
    substeps: 2,
  },
];

describe("progress", () => {
  it("follows the events of the runner", () => {
    let progress = startProgress();
    const states = events.map((event) => (progress = advance(progress, event)));
    expect(states[1]).toMatchObject({
      job: "job_1",
      step: 1,
      substep: 1,
      done: 0,
      total: 5,
    });
    expect(states[3]).toMatchObject({ iteration: 2, fnorm: 1e-9 });
    expect(states[4].done).toBe(1);
    // the substeps of the first step and one of the second step have converged
    expect(states[5]).toMatchObject({
      step: 2,
      substep: 2,
      done: 4,
      iteration: 0,
      fnorm: null,
    });
    expect(fraction(progress)).toBeCloseTo(0.4);

    progress = advance(progress, {
      event: "failed",
      step: 1,
      substep: 1,
      message: "NewtonConvergenceError: no convergence",
    });
    expect(progress.failed).toEqual([
      "Step 2, substep 2: NewtonConvergenceError: no convergence",
    ]);
    progress = advance(progress, { event: "finished", job: "job_1", time: 1 });
    expect(fraction(progress)).toBe(0.5);
    expect(fraction(startProgress())).toBe(0);
  });

  it("takes the exception of a traceback", () => {
    expect(
      exceptionOf(
        "Traceback (most recent call last):\n  File ...\nValueError: wrong\n",
      ),
    ).toBe("ValueError: wrong");
    expect(
      exceptionOf("felupe.tools._newton.NewtonConvergenceError: NaN. A.b: c"),
    ).toBe("NewtonConvergenceError: NaN. A.b: c");
  });
});

describe("solve", () => {
  const job = { command: "job.add", name: "job_1", steps: ["step_1"] };
  const commands = [job] as unknown as Command[];

  it("is possible for a valid model with a job and loaded files", () => {
    const base = { commands, issues: 0, notes: 0, runtime: "ready" } as const;
    expect(solveBlocker(base)).toBeUndefined();
    expect(solveBlocker({ ...base, commands: [] })).toContain("Add a job");
    expect(solveBlocker({ ...base, issues: 2 })).toContain("issues");
    expect(solveBlocker({ ...base, notes: 1 })).toContain("mesh files");
    expect(solveBlocker({ ...base, runtime: "loading" })).toContain("loading");
    expect(solveBlocker({ ...base, runtime: "error" })).toContain(
      "could not be loaded",
    );
  });

  function fakeClient() {
    let onEvent: (event: JobEvent) => void = () => {};
    let settle!: {
      resolve: (results: Record<string, JobResult>) => void;
      reject: (error: Error) => void;
    };
    const client: JobClient & { emit: typeof onEvent } = {
      run: vi.fn((_document: string, listener: typeof onEvent) => {
        onEvent = listener;
        return new Promise<Record<string, JobResult>>((resolve, reject) => {
          settle = { resolve, reject };
        });
      }),
      restart: vi.fn(() => {
        const error = new Error("Cancelled.");
        error.name = "CancelledError";
        settle.reject(error);
      }),
      emit: (event) => onEvent(event),
    };
    return { client, settle: () => settle };
  }

  it("runs the jobs with progress and keeps the results", async () => {
    const { client, settle } = fakeClient();
    const runner = new JobRunner(client);
    const listener = vi.fn();
    runner.subscribe(listener);
    const solved = runner.solve(commands, "{}");
    expect(runner.running).toBe(true);
    // a second run is not started while running
    await runner.solve(commands, "{}");
    expect(client.run).toHaveBeenCalledTimes(1);

    client.emit(events[0]);
    client.emit(events[1]);
    expect(runner.run).toMatchObject({
      state: "running",
      progress: { job: "job_1", substep: 1 },
      commands,
    });
    const results = { job_1: { substeps: 5, time: 0.1 } };
    settle().resolve(results);
    await solved;
    expect(runner.run).toMatchObject({ state: "finished", results, commands });
    expect(runner.results?.results).toBe(results);
    expect(listener).toHaveBeenCalledTimes(4);

    runner.dismiss();
    expect(runner.run.state).toBe("idle");
    expect(runner.results?.results).toBe(results);
  });

  it("reports a failed and a cancelled run", async () => {
    const { client, settle } = fakeClient();
    const runner = new JobRunner(client);
    let solved = runner.solve(commands, "{}");
    settle().reject(new Error("Traceback ...\nValueError: wrong"));
    await solved;
    expect(runner.run).toMatchObject({
      state: "failed",
      message: "Traceback ...\nValueError: wrong",
    });

    runner.cancel(); // not running: nothing to cancel
    expect(client.restart).not.toHaveBeenCalled();
    solved = runner.solve(commands, "{}");
    runner.cancel();
    await solved;
    expect(client.restart).toHaveBeenCalledTimes(1);
    expect(runner.run.state).toBe("cancelled");
    // events of a stopped run are ignored
    client.emit(events[0]);
    expect(runner.run.state).toBe("cancelled");
  });
});
