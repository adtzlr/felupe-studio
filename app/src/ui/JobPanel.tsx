import type { RefObject } from "preact";
import { useEffect, useRef } from "preact/hooks";
import {
  exceptionOf,
  fraction,
  type JobProgress,
  type JobRun,
} from "../core/jobs";
import type { Command } from "../core/commands";
import { curvePoint, formatValue as format } from "../core/results";
import type { ModelStore } from "../core/store";
import { curveQuantities } from "../core/curve";

interface Props {
  run: JobRun;
  store: ModelStore;
  onDismiss: () => void;
  /** Show the results (switches to the Results workspace), if offered. */
  onShowResults?: () => void;
}

const seconds = (time: number) => `${time.toFixed(time < 10 ? 2 : 1)} s`;

/** Whether a job of a command list retries substeps with a cutback. */
const usesCutback = (commands: readonly Command[]) =>
  commands.some((c) => c.command === "job.add" && c.cutback);

/** A line of the running job that does not wrap, so the panel keeps its size. */
const Line = ({ text, class: name }: { text: string; class?: string }) => (
  <p class={`job-line ${name ?? ""}`.trim()} title={text || undefined}>
    {text || "\u00a0"}
  </p>
);

/**
 * The progress of the running job in a fixed number of lines (#108): the position,
 * the Newton iteration (empty between iterations) and, with a cutback, its retries.
 */
function Running({
  progress,
  cutback,
}: {
  progress: JobProgress;
  cutback: boolean;
}) {
  const percent = Math.round(fraction(progress) * 100);
  const { job, jobs, failed } = progress;
  const position = job
    ? `${jobs.length > 1 ? `Job ${jobs.indexOf(job) + 1} of ${jobs.length} · ` : ""}` +
      `Step ${progress.step} of ${progress.steps} · substep ${progress.substep} of ${progress.substeps}`
    : "Preparing the model …";
  const newton =
    job && progress.iteration > 0
      ? `Newton iteration ${progress.iteration}` +
        (progress.fnorm !== null
          ? ` · residuals ${progress.fnorm.toExponential(2)}`
          : "")
      : "";
  const n = failed.length;
  const retries = n
    ? `Cutback: ${n === 1 ? "1 attempt" : `${n} attempts`} retried with smaller increments`
    : "Cutback: no retries";
  return (
    <>
      <div
        class="progress"
        role="progressbar"
        aria-label="Progress"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percent}
      >
        <div style={{ width: `${percent}%` }} />
      </div>
      <Line text={position} />
      <Line text={newton} class="muted" />
      {(cutback || n > 0) && (
        <p
          class={`job-line ${n ? "warning" : "muted"}`}
          title={n ? failed.join("\n") : undefined}
        >
          {retries}
        </p>
      )}
    </>
  );
}

/** Failed attempts of substeps, retried with smaller increments (cutback). */
function Cutbacks({ progress }: { progress: JobProgress }) {
  const n = progress.failed.length;
  if (!n) return null;
  return (
    <p class="warning" title={progress.failed.join("\n")}>
      {n === 1 ? "1 attempt" : `${n} attempts`} did not converge and{" "}
      {n === 1 ? "was" : "were"} retried with smaller increments.
    </p>
  );
}

/**
 * Publish the height of the panel as `--job-panel-height` on its parent, so that the
 * overlays of the viewports stay above it where it spans the width (#128).
 */
function useHeightOnParent(ref: RefObject<HTMLElement | null>, shown: boolean) {
  useEffect(() => {
    const element = ref.current;
    const parent = element?.parentElement;
    if (!element || !parent) return;
    const set = () =>
      parent.style.setProperty(
        "--job-panel-height",
        `${element.getBoundingClientRect().height}px`,
      );
    set();
    const observer =
      typeof ResizeObserver === "undefined"
        ? undefined
        : new ResizeObserver(set);
    observer?.observe(element);
    return () => {
      observer?.disconnect();
      parent.style.removeProperty("--job-panel-height");
    };
  }, [ref, shown]);
}

export function JobPanel({ run, store, onDismiss, onShowResults }: Props) {
  const ref = useRef<HTMLElement>(null);
  useHeightOnParent(ref, run.state !== "idle");
  if (run.state === "idle") return null;
  const titles = {
    running: `Solving ${run.progress.job ?? ""}`.trim(),
    finished: "Solved",
    failed: "Solving failed",
    cancelled: "Cancelled",
  };
  return (
    <section ref={ref} class="job-panel" aria-label="Job">
      <div class="job-head">
        <h2 aria-live="polite">{titles[run.state]}</h2>
        {run.state !== "running" && (
          <button
            type="button"
            class="icon-button"
            aria-label="Close"
            onClick={onDismiss}
          >
            ×
          </button>
        )}
      </div>
      {run.state === "running" && (
        <Running progress={run.progress} cutback={usesCutback(run.commands)} />
      )}
      {run.state === "finished" && (
        <>
          <ul class="job-results">
            {Object.entries(run.results).map(([name, result]) => {
              const point = curvePoint(result);
              return (
                <li key={name}>
                  <strong>{name}</strong>: {result.substeps}{" "}
                  {result.substeps === 1 ? "substep" : "substeps"} in{" "}
                  {seconds(result.time)}
                  {point && (
                    <>
                      <br />
                      <span class="muted">
                        Last substep: {curveQuantities(run.commands, name).u}
                        <sub>{point.axis}</sub> = {format(point.u)},{" "}
                        {curveQuantities(run.commands, name).f}
                        <sub>{point.axis}</sub> = {format(point.f)}
                      </span>
                    </>
                  )}
                </li>
              );
            })}
          </ul>
          <Cutbacks progress={run.progress} />
          {store.commands !== run.commands && (
            <p class="muted">The model was changed after solving.</p>
          )}
          {onShowResults && (
            <div class="actions">
              <button
                type="button"
                class="button primary"
                onClick={onShowResults}
              >
                Show results
              </button>
            </div>
          )}
        </>
      )}
      {run.state === "failed" && (
        <>
          <p class="error">{exceptionOf(run.message)}</p>
          {run.message.includes("NewtonConvergenceError") && (
            <p>
              Use more substeps in the ramp of the step, enable the cutback of
              the job or loosen its tolerance.
            </p>
          )}
          <details>
            <summary>Python traceback</summary>
            <pre>{run.message}</pre>
          </details>
        </>
      )}
      {run.state === "cancelled" && (
        <p class="muted">The job was stopped; Python is loaded again.</p>
      )}
    </section>
  );
}
