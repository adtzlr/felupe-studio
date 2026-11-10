// Running the jobs of the model in the Python worker (#27): the progress of a run
// from the events of `felupe_studio.runner`, cancelling by restarting the worker, and
// the results of the last finished run (for the Results workspace).
import type { JobEvent, JobResult } from "../worker/protocol";
import type { Command } from "./commands";

/** The progress of a run, from the events of the runner. */
export interface JobProgress {
  /** The jobs of the run, in the order of evaluation. */
  jobs: string[];
  /** The substeps of every step, by job. */
  plan: Record<string, number[]>;
  /** The running job (or the last one). */
  job?: string;
  /** Step and substep of the running job (counted from 1). */
  step: number;
  steps: number;
  substep: number;
  substeps: number;
  /** Converged substeps of the running job, and all of its substeps. */
  done: number;
  total: number;
  /** Newton iteration of the running substep, with the norm of the residuals. */
  iteration: number;
  fnorm: number | null;
  /** Failed attempts of substeps (retried with a cutback, if enabled). */
  failed: string[];
  /** Times of the finished jobs, in seconds. */
  times: Record<string, number>;
}

export const startProgress = (): JobProgress => ({
  jobs: [],
  plan: {},
  step: 0,
  steps: 0,
  substep: 0,
  substeps: 0,
  done: 0,
  total: 0,
  iteration: 0,
  fnorm: null,
  failed: [],
  times: {},
});

/** The progress after an event of the runner. */
export function advance(progress: JobProgress, event: JobEvent): JobProgress {
  switch (event.event) {
    case "start":
      return {
        ...startProgress(),
        jobs: event.jobs,
        plan: event.substeps,
      };
    case "substep": {
      const substeps = progress.plan[event.job] ?? [event.substeps];
      const sum = (values: number[]) => values.reduce((a, b) => a + b, 0);
      return {
        ...progress,
        job: event.job,
        step: event.step + 1,
        steps: event.steps,
        substep: event.substep + 1,
        substeps: event.substeps,
        // the substeps of the steps before and of this step have converged
        done: sum(substeps.slice(0, event.step)) + event.substep,
        total: sum(substeps),
        iteration: 0,
        fnorm: null,
      };
    }
    case "iteration":
      return { ...progress, iteration: event.iteration, fnorm: event.fnorm };
    case "failed":
      return {
        ...progress,
        failed: [
          ...progress.failed,
          `Step ${event.step + 1}, substep ${event.substep + 1}: ${event.message}`,
        ],
      };
    case "converged":
      return { ...progress, done: Math.min(progress.done + 1, progress.total) };
    case "finished":
      return {
        ...progress,
        times: { ...progress.times, [event.job]: event.time },
      };
  }
}

/** The fraction of the converged substeps of all jobs of a run (0 … 1). */
export function fraction(progress: JobProgress): number {
  const jobs = progress.jobs.length;
  if (!jobs) return 0;
  const finished = Object.keys(progress.times).length;
  const running =
    progress.job && !(progress.job in progress.times) && progress.total
      ? progress.done / progress.total
      : 0;
  return Math.min((finished + running) / jobs, 1);
}

export type JobRun =
  | { state: "idle" }
  | { state: "running"; progress: JobProgress }
  | {
      state: "finished";
      progress: JobProgress;
      results: Record<string, JobResult>;
      /** The command list of the run: the results belong to this model. */
      commands: readonly Command[];
    }
  | { state: "failed"; progress: JobProgress; message: string }
  | { state: "cancelled"; progress: JobProgress };

/**
 * The exception of a Python traceback: its last line, without the module of the
 * exception class (e.g. "NewtonConvergenceError: …").
 */
export function exceptionOf(message: string): string {
  const lines = message.trim().split("\n");
  return lines[lines.length - 1].trim().replace(/^(?:\w+\.)+(\w+:)/, "$1");
}

/** The reason why the jobs of the model cannot be run, if any. */
export function solveBlocker({
  commands,
  issues,
  notes,
  runtime,
}: {
  commands: readonly Command[];
  issues: number;
  /** Messages about the mesh files, by object name. */
  notes: number;
  runtime: "loading" | "ready" | "error";
}): string | undefined {
  if (!commands.some((c) => c.command === "job.add"))
    return "Add a job to the model first (Steps & Job).";
  if (issues) return "Fix the issues of the model first.";
  if (notes) return "Load the mesh files of the model first.";
  if (runtime === "loading") return "Python is still loading.";
  if (runtime === "error") return "Python could not be loaded.";
  return undefined;
}

/**
 * The runner interface of the worker client (see worker/client.ts); a cancelled run
 * rejects with an error named "CancelledError".
 */
export interface JobClient {
  run(
    document: string,
    onEvent: (event: JobEvent) => void,
  ): Promise<Record<string, JobResult>>;
  restart(): void;
}

/** Runs the jobs of the model, one run at a time. */
export class JobRunner {
  private current: JobRun = { state: "idle" };
  private listeners = new Set<() => void>();
  /** The last finished run; a new run replaces its results in Python. */
  private last?: Extract<JobRun, { state: "finished" }>;
  private count = 0;

  constructor(private client: JobClient) {}

  get run(): JobRun {
    return this.current;
  }

  /** The results of the last finished run, with its command list. */
  get results(): Extract<JobRun, { state: "finished" }> | undefined {
    return this.last;
  }

  /** The number of started runs, e.g. to tell the results of runs apart. */
  get generation(): number {
    return this.count;
  }

  get running(): boolean {
    return this.current.state === "running";
  }

  /** Run the jobs of a command list (with its JSON text). */
  async solve(commands: readonly Command[], document: string): Promise<void> {
    if (this.running) return;
    this.count++;
    // the results of Python are replaced by this run
    this.last = undefined;
    let progress = startProgress();
    this.set({ state: "running", progress });
    try {
      const results = await this.client.run(document, (event) => {
        if (this.current.state !== "running") return;
        progress = advance(progress, event);
        this.set({ state: "running", progress });
      });
      this.last = { state: "finished", progress, results, commands };
      this.set(this.last);
    } catch (error) {
      this.set(
        error instanceof Error && error.name === "CancelledError"
          ? { state: "cancelled", progress }
          : {
              state: "failed",
              progress,
              message: error instanceof Error ? error.message : String(error),
            },
      );
    }
  }

  /** Stop a running job; Python is loaded again. */
  cancel(): void {
    if (this.running) this.client.restart();
  }

  /** Forget the results, e.g. for a new project; a running job is cancelled. */
  forget(): void {
    this.cancel();
    this.last = undefined;
    this.set({ state: "idle" });
  }

  /** Hide the state of a run that is over. */
  dismiss(): void {
    if (!this.running) this.set({ state: "idle" });
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private set(run: JobRun) {
    this.current = run;
    for (const listener of this.listeners) listener();
  }
}
