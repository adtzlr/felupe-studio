import type { ContourSettings as ContourSettingsType } from "../core/contour";
import { hint, withHint } from "../core/shortcuts";
import {
  curveQuantities,
  defaultSeries,
  hasCurve,
  seriesValues,
} from "../core/curve";
import {
  type Finished,
  formatValue,
  QUANTITY_GROUPS,
  type ResultView,
  stepOf,
  substepsOf,
} from "../core/results";
import type { ModelStore } from "../core/store";
import { valueWithUnit } from "../core/units";
import type { Quantity } from "../worker/protocol";
import { ContourSettings } from "./ContourSettings";
import { Icon } from "./icons";
import { type Player, type Speed, SPEEDS } from "./usePlayer";

interface Props {
  store: ModelStore;
  /** The last finished run and its view, if any. */
  results?: { run: Finished; view: ResultView };
  running: boolean;
  onChange: (view: ResultView) => void;
  /** The settings of the contour (#139). */
  contour?: ContourSettingsType;
  onContour?: (settings: ContourSettingsType) => void;
  /** The range of the shown substep, as the start of a manual range. */
  currentRange?: readonly [number, number];
  /** Play the substeps (#141). */
  player?: Player;
}

/** The controls of the results in the ribbon: job, quantity, substep and shape. */
export function ResultsControls({
  store,
  results,
  running,
  onChange,
  contour,
  onContour,
  currentRange,
  player,
}: Props) {
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
  // the symbols and the units of the curve (#98, #132), its axes (#197)
  const q = curveQuantities(run.commands, view.job);
  const [defaultX, defaultY] = result ? defaultSeries(result) : [];
  const values = seriesValues(
    result,
    view.substep,
    [view.curveX ?? defaultX, view.curveY ?? defaultY].filter((s) => !!s),
    q,
  );
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
      <div class="field-with-button">
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
        {contour && onContour && (
          <ContourSettings
            settings={contour}
            onChange={onContour}
            current={currentRange}
          />
        )}
      </div>
      <div class="field-with-button">
        {player && (
          <button
            type="button"
            class="icon-button play-button"
            aria-label={player.playing ? "Pause" : "Play"}
            title={withHint(
              player.playing
                ? "Pause"
                : contour?.range === "job"
                  ? "Play the substeps"
                  : "Play the substeps (the range of all substeps in the contour settings keeps the colors comparable)",
              "play",
            )}
            disabled={total < 2}
            onClick={player.toggle}
          >
            <Icon name={player.playing ? "pause" : "play"} />
          </button>
        )}
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
        {player && (
          <label class="field speed" title="Substeps per second while playing">
            <span>Speed</span>
            <select
              value={player.speed}
              disabled={total < 2}
              onChange={(event) =>
                player.setSpeed(Number(event.currentTarget.value) as Speed)
              }
            >
              {SPEEDS.map((speed) => (
                <option key={speed} value={speed}>
                  {speed}/s
                </option>
              ))}
            </select>
          </label>
        )}
      </div>
      <div class="results-info muted" aria-live="polite">
        {step.name}: {step.substep} of {step.substeps}
        {values.length > 0 && (
          <>
            <br />
            {values.map(({ label, value }, i) => (
              <span key={i}>
                {i > 0 && ", "}
                {label.symbol}
                <sub>{label.component}</sub> ={" "}
                {valueWithUnit(formatValue(value), label.unit)}
              </span>
            ))}
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
