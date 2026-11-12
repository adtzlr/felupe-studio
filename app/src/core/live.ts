// The live results of a run in the Results workspace (#207): the last scene of a
// job and the curves so far, while the jobs run, and after a failed or cancelled run
// until the next one. The worker cannot answer requests while Python runs, so the
// runner pushes them (felupe_studio.runner.Live).
import type { ResultScene } from "../worker/protocol";
import type { JobRun } from "./jobs";
import type { Finished, ResultView } from "./results";

export interface LiveResults {
  /**
   * The live results as a finished run: the curves so far and the planned
   * substeps, e.g. for the curve card and the controls.
   */
  run: Finished;
  /** The view of the shown job at the substep of its last scene. */
  view: ResultView;
  /** The last scene of the shown job, if any. */
  scene?: ResultScene;
  /** Whether the run goes on, failed or was cancelled. */
  state: "running" | "failed" | "cancelled";
  /** The state of the shown job, e.g. "Live · substep 7 of 20". */
  status: string;
}

const sum = (values: readonly number[]) => values.reduce((a, b) => a + b, 0);

/**
 * The live results of a run with live results of a job: of the chosen job, else of
 * the running one, else of the last one; the view takes the choices of the base
 * (e.g. the scale), its quantity is that of the scenes.
 */
export function liveResults(
  run: JobRun,
  choice: string | undefined,
  base: Partial<ResultView> | undefined,
): LiveResults | undefined {
  if (
    run.state !== "running" &&
    run.state !== "failed" &&
    run.state !== "cancelled"
  )
    return undefined;
  const { progress, live } = run;
  const jobs = progress.jobs.filter((job) => live.jobs[job]);
  if (!jobs.length) return undefined;
  const running =
    run.state === "running" && progress.job && live.jobs[progress.job]
      ? progress.job
      : undefined;
  const job =
    choice && jobs.includes(choice)
      ? choice
      : (running ?? jobs[jobs.length - 1]);
  const results = Object.fromEntries(
    jobs.map((name) => {
      const { x, y } = live.jobs[name];
      return [
        name,
        {
          substeps: sum(progress.plan[name] ?? []),
          time: progress.times[name] ?? 0,
          ...(x.length ? { x, y } : {}),
        },
      ];
    }),
  );
  const shown = live.jobs[job];
  const substep = shown.sceneSubstep ?? shown.substep;
  const total = results[job].substeps;
  const finished = job in progress.times;
  const status =
    run.state === "running"
      ? finished
        ? `${job} finished · substep ${substep} of ${total}`
        : `Live · substep ${substep} of ${total}`
      : run.state === "failed"
        ? `Failed after substep ${shown.substep} of ${total}`
        : `Cancelled after substep ${shown.substep} of ${total}`;
  return {
    run: {
      state: "finished",
      progress,
      commands: run.commands,
      results,
    },
    view: {
      scale: 1,
      undeformed: true,
      curve: true,
      ...base,
      job,
      substep,
      quantity: live.quantity ?? base?.quantity ?? "displacement",
    },
    scene: shown.scene,
    state: run.state,
    status,
  };
}

const KEY = "felupe-studio.live";

/** Whether the live scenes are on (default), kept in the browser. */
export function loadLiveOn(storage?: Storage): boolean {
  try {
    return (storage ?? localStorage).getItem(KEY) !== "off";
  } catch {
    return true;
  }
}

/** Keep whether the live scenes are on in the browser (where it can). */
export function saveLiveOn(on: boolean, storage?: Storage) {
  try {
    (storage ?? localStorage).setItem(KEY, on ? "on" : "off");
  } catch {
    // e.g. storage disabled: the choice lasts for the session
  }
}
