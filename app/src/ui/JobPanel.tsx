import {
  exceptionOf,
  fraction,
  type JobProgress,
  type JobRun,
} from "../core/jobs";
import type { ModelStore } from "../core/store";
import type { JobResult } from "../worker/protocol";

interface Props {
  run: JobRun;
  store: ModelStore;
  onDismiss: () => void;
}

const seconds = (time: number) => `${time.toFixed(time < 10 ? 2 : 1)} s`;

/** The force and displacement of the last substep of a characteristic curve, along
 * the axis with the largest displacement. */
export function lastPoint(result: JobResult) {
  const x = result.x?.at(-1);
  const y = result.y?.at(-1);
  if (!x || !y) return undefined;
  let axis = 0;
  x.forEach((value, i) => {
    if (Math.abs(value ?? 0) > Math.abs(x[axis] ?? 0)) axis = i;
  });
  const [u, f] = [x[axis], y[axis]];
  if (u === null || f === null) return undefined;
  return { axis: "xyz"[axis] ?? String(axis), u, f };
}

const format = (value: number) =>
  Math.abs(value) >= 1e4 || (value !== 0 && Math.abs(value) < 1e-3)
    ? value.toExponential(3)
    : String(Number(value.toPrecision(4)));

function Running({ progress }: { progress: JobProgress }) {
  const percent = Math.round(fraction(progress) * 100);
  const { job, jobs } = progress;
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
      {job ? (
        <p>
          {jobs.length > 1 &&
            `Job ${jobs.indexOf(job) + 1} of ${jobs.length} · `}
          Step {progress.step} of {progress.steps} · substep {progress.substep}{" "}
          of {progress.substeps}
          {progress.iteration > 0 && (
            <>
              <br />
              Newton iteration {progress.iteration}
              {progress.fnorm !== null &&
                ` · residuals ${progress.fnorm.toExponential(2)}`}
            </>
          )}
        </p>
      ) : (
        <p>Preparing the model …</p>
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

export function JobPanel({ run, store, onDismiss }: Props) {
  if (run.state === "idle") return null;
  const titles = {
    running: `Solving ${run.progress.job ?? ""}`.trim(),
    finished: "Solved",
    failed: "Solving failed",
    cancelled: "Cancelled",
  };
  return (
    <section class="job-panel" aria-label="Job">
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
        <>
          <Running progress={run.progress} />
          <Cutbacks progress={run.progress} />
        </>
      )}
      {run.state === "finished" && (
        <>
          <ul class="job-results">
            {Object.entries(run.results).map(([name, result]) => {
              const point = lastPoint(result);
              return (
                <li key={name}>
                  <strong>{name}</strong>: {result.substeps}{" "}
                  {result.substeps === 1 ? "substep" : "substeps"} in{" "}
                  {seconds(result.time)}
                  {point && (
                    <>
                      <br />
                      <span class="muted">
                        Last substep: u<sub>{point.axis}</sub> ={" "}
                        {format(point.u)}, F<sub>{point.axis}</sub> ={" "}
                        {format(point.f)}
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
        </>
      )}
      {run.state === "failed" && (
        <>
          <p class="error">{exceptionOf(run.message)}</p>
          {run.message.includes("NewtonConvergenceError") && (
            <p>
              Use more substeps in the ramp of the step, or enable the cutback
              of the job.
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
