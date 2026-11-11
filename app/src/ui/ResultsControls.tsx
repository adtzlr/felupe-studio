import { hint } from "../core/shortcuts";
import { hasCurve } from "../core/curve";
import {
  curvePoint,
  type Finished,
  formatValue,
  QUANTITY_GROUPS,
  type ResultView,
  stepOf,
  substepsOf,
} from "../core/results";
import type { ModelStore } from "../core/store";
import type { Quantity } from "../worker/protocol";

interface Props {
  store: ModelStore;
  /** The last finished run and its view, if any. */
  results?: { run: Finished; view: ResultView };
  running: boolean;
  onChange: (view: ResultView) => void;
}

/** The controls of the results in the ribbon: job, quantity, substep and shape. */
export function ResultsControls({ store, results, running, onChange }: Props) {
  if (running) return <span class="muted">Solving …</span>;
  if (!results)
    return (
      <span class="muted">
        Results will appear here after the jobs have run (Solve).
      </span>
    );
  const { run, view } = results;
  const jobs = Object.keys(run.results);
  const total = substepsOf(run, view.job);
  const step = stepOf(run, view.job, view.substep);
  const result = run.results[view.job];
  const point = curvePoint(result, view.substep, view.axis);
  const set = (change: Partial<ResultView>) => onChange({ ...view, ...change });
  return (
    <div class="results-controls">
      {jobs.length > 1 && (
        <label class="field">
          <span>Job</span>
          <select
            value={view.job}
            onChange={(event) => {
              const job = event.currentTarget.value;
              set({ job, substep: substepsOf(run, job) });
            }}
          >
            {jobs.map((job) => (
              <option key={job} value={job}>
                {job}
              </option>
            ))}
          </select>
        </label>
      )}
      <label class="field">
        <span>Contour</span>
        <select
          value={view.quantity}
          onChange={(event) =>
            set({ quantity: event.currentTarget.value as Quantity })
          }
        >
          {QUANTITY_GROUPS.map((group) => (
            <optgroup key={group.label} label={group.label}>
              {group.options.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.label}
                </option>
              ))}
            </optgroup>
          ))}
        </select>
      </label>
      <label
        class="field substep"
        title={`${hint("substep-previous")} and ${hint("substep-next")} step through the substeps, ${hint("substep-first")} and ${hint("substep-last")} go to the first and the last one`}
      >
        <span>
          Substep {view.substep} of {total}
        </span>
        <input
          type="range"
          min={1}
          max={total}
          step={1}
          value={view.substep}
          disabled={total < 2}
          onInput={(event) =>
            set({ substep: Number(event.currentTarget.value) })
          }
        />
      </label>
      <div class="results-info muted" aria-live="polite">
        {step.name}: {step.substep} of {step.substeps}
        {point && (
          <>
            <br />u<sub>{point.axis}</sub> = {formatValue(point.u)}, F
            <sub>{point.axis}</sub> = {formatValue(point.f)}
          </>
        )}
      </div>
      <label class="field scale">
        <span>Scale</span>
        <input
          type="number"
          min={0}
          step="any"
          value={view.scale}
          title="Scale of the displacements of the deformed shape"
          onChange={(event) => {
            const scale = Number(event.currentTarget.value);
            if (Number.isFinite(scale) && scale >= 0) set({ scale });
          }}
        />
      </label>
      <label class="check">
        <input
          type="checkbox"
          checked={view.undeformed}
          onChange={(event) => set({ undeformed: event.currentTarget.checked })}
        />
        Undeformed
      </label>
      {hasCurve(result) && (
        <label class="check">
          <input
            type="checkbox"
            checked={view.curve}
            onChange={(event) => set({ curve: event.currentTarget.checked })}
          />
          Curve
        </label>
      )}
      {store.commands !== run.commands && (
        <span class="warning" role="note">
          The model was changed after solving.
        </span>
      )}
    </div>
  );
}
