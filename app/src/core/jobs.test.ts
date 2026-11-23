import { describe, expect, it, vi } from "vitest";
import type {
  JobEvent,
  JobResult,
  ResultFile,
  ResultScene,
} from "../worker/protocol";
import type { Command } from "./resolved";
import {
  advance,
  exceptionOf,
  fraction,
  type JobClient,
  type JobRun,
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

  const file: ResultFile = {
    file: "bar-job_1.xdmf",
    job: "bar-job_1",
    substeps: 6,
    sections: ["left", "right"],
    planar: false,
    units: { length: "mm", force: "N" },
    quantities: ["displacement", "stress_mises"],
  };

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
      importResults: vi.fn(async () => file),
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

  it("shows the results of a file instead of those of the last run (#414)", async () => {
    const { client, settle } = fakeClient();
    const runner = new JobRunner(client);
    const solved = runner.solve(commands, "{}");
    settle().resolve({ job_1: { substeps: 5, time: 0.1 } });
    await solved;
    const listener = vi.fn();
    runner.subscribe(listener);
    const data = new ArrayBuffer(8);

    await runner.importResults("bar-job_1.xdmf", data);
    expect(client.importResults).toHaveBeenCalledWith("bar-job_1.xdmf", data);
    // a new generation of results, without the state of a run
    expect(runner.generation).toBe(2);
    expect(runner.run).toEqual({ state: "idle" });
    expect(listener).toHaveBeenCalledTimes(1);
    expect(runner.results).toEqual({
      state: "finished",
      progress: { ...startProgress(), jobs: ["bar-job_1"] },
      results: { "bar-job_1": { substeps: 6, time: 0 } },
      commands: [],
      imported: file,
    });

    // the exception of Python; the results stay
    vi.mocked(client.importResults).mockRejectedValueOnce(
      new Error(
        "Traceback ...\nValueError: other.xdmf is not an XDMF time series.",
      ),
    );
    await expect(runner.importResults("other.xdmf", data)).rejects.toThrow(
      /^ValueError: other.xdmf is not an XDMF time series.$/,
    );
    expect(runner.results?.imported).toBe(file);
    expect(runner.generation).toBe(2);
  });

  it("imports no results while the jobs run (#414)", async () => {
    const { client, settle } = fakeClient();
    const runner = new JobRunner(client);
    let solved = runner.solve(commands, "{}");
    await expect(
      runner.importResults("bar-job_1.xdmf", new ArrayBuffer(8)),
    ).rejects.toThrow("Wait until the jobs have run.");
    expect(client.importResults).not.toHaveBeenCalled();
    settle().resolve({ job_1: { substeps: 5, time: 0.1 } });
    await solved;

    // a run that starts while Python reads the file replaces its results
    let read!: (file: ResultFile) => void;
    vi.mocked(client.importResults).mockReturnValueOnce(
      new Promise((resolve) => (read = resolve)),
    );
    const imported = runner.importResults("bar-job_1.xdmf", new ArrayBuffer(8));
    solved = runner.solve(commands, "{}");
    read(file);
    await imported;
    expect(runner.running).toBe(true);
    expect(runner.results).toBeUndefined();
    settle().resolve({ job_1: { substeps: 5, time: 0.1 } });
    await solved;
    expect(runner.results?.imported).toBeUndefined();
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

  it("keeps the live results of the jobs, also of a cancelled run (#207)", async () => {
    const { client, settle } = fakeClient();
    const runner = new JobRunner(client);
    const solved = runner.solve(commands, "{}", { quantity: "stress_mises" });
    expect(client.run).toHaveBeenCalledWith("{}", expect.any(Function), {
      quantity: "stress_mises",
    });
    const scene = { label: "Stress", at: "cell", range: [0, 1], surfaces: [] };
    client.emit(events[0]);
    client.emit(events[1]);
    client.emit({
      event: "live",
      job: "job_1",
      substep: 1,
      x: [0, 0, 0],
      y: [0, 0, 0],
    });
    client.emit({
      event: "live",
      job: "job_1",
      substep: 2,
      x: [0.1, 0, 0],
      y: [1, 0, 0],
      scene: scene as unknown as ResultScene,
    });
    // a job that is no characteristic curve: scenes only
    client.emit({
      event: "live",
      job: "job_2",
      substep: 1,
      scene: scene as unknown as ResultScene,
    });
    const live = (runner.run as Extract<JobRun, { state: "running" }>).live;
    expect(live.quantity).toBe("stress_mises");
    expect(live.jobs.job_1).toEqual({
      substep: 2,
      x: [
        [0, 0, 0],
        [0.1, 0, 0],
      ],
      y: [
        [0, 0, 0],
        [1, 0, 0],
      ],
      scene,
      sceneSubstep: 2,
    });
    expect(live.jobs.job_2).toMatchObject({
      substep: 1,
      x: [],
      sceneSubstep: 1,
    });
    // the progress is not changed by live events
    expect(runner.run).toMatchObject({ progress: { substep: 1 } });
    runner.cancel();
    await solved;
    expect(runner.run).toMatchObject({ state: "cancelled", commands, live });
    settle();
  });
});
