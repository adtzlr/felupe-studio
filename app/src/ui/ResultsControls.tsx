import type { ComponentChildren } from "preact";
import { useState } from "preact/hooks";
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
  quantityGroups,
  type ResultView,
  sectionsOf,
  stepOf,
  substepsOf,
} from "../core/results";
import type { ModelStore } from "../core/store";
import type { Theme } from "../core/theme";
import { valueWithUnit } from "../core/units";
import type { Quantity } from "../worker/protocol";
import { viewColors } from "../viewer/palette";
import { ContourSettings } from "./ContourSettings";
import { Icon } from "./icons";
import { type Player, type Speed, SPEEDS } from "./usePlayer";

/** The label of a quantity, e.g. "Von Mises stress". */
const quantityLabel = (quantity: Quantity) =>
  QUANTITY_GROUPS.flatMap((group) => group.options).find(
    (option) => option.id === quantity,
  )?.label ?? quantity;

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
  /** The values of the shown results can be shifted to the points (#231). */
  shift?: boolean;
  /** The theme of the app (#375): the gray of the other sections (#396). */
  theme?: Theme;
  /** Play the substeps (#141). */
  player?: Player;
  /**
   * The live results of a run (#207): their status and the quantity of their
   * scenes. The substep follows the run; a chosen quantity applies after it.
   */
  live?: { status: string; quantity?: Quantity };
  /** Whether the next run shows live scenes (#207), and its switch. */
  liveOn?: boolean;
  onLiveOn?: (on: boolean) => void;
  /**
   * The compact layout of a phone (#378): the contour and the substep in one row,
   * the other controls behind a button.
   */
  compact?: boolean;
}

/** The shown results of the controls, and the change of their view. */
interface Shown {
  run: Finished;
  view: ResultView;
  /** The number of substeps of the shown job. */
  total: number;
  /** The substep follows a running job (#207). */
  live?: Props["live"];
  set: (change: Partial<ResultView>) => void;
}

/** The switch of the live scenes of the next run (#207). */
function LiveSwitch({
  on,
  onChange,
}: {
  on?: boolean;
  onChange?: (on: boolean) => void;
}) {
  if (on === undefined || !onChange) return null;
  return (
    <label
      class="check"
      title="Show the deformed model of a running job, after converged substeps (applies to the next run; off for the fastest run)"
    >
      <input
        type="checkbox"
        checked={on}
        onChange={(event) => onChange(event.currentTarget.checked)}
      />
      Live results
    </label>
  );
}

/** The job of the results, if the run has more than one. */
function JobField({ run, view, set }: Shown) {
  const jobs = Object.keys(run.results);
  if (jobs.length < 2) return null;
  return (
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
  );
}

/** The quantity of the live scenes, if it is not the chosen one (#207). */
function LiveNote({ view, live }: Pick<Shown, "view" | "live">) {
  if (!live?.quantity || live.quantity === view.quantity) return null;
  return (
    <span class="muted live-note" role="note">
      Live: {quantityLabel(live.quantity)} · changes apply after the run
    </span>
  );
}

/** The contour with the button of its settings (#139). */
function ContourField({ shown, props }: { shown: Shown; props: Props }) {
  const { run, view, set } = shown;
  const { contour, onContour, currentRange, shift, theme, compact } = props;
  return (
    <div class="field-with-button">
      <label class="field">
        {/* the select shows the quantity, its name stays (#378) */}
        <span class={compact ? "visually-hidden" : undefined}>Contour</span>
        <select
          value={view.quantity}
          onChange={(event) =>
            set({ quantity: event.currentTarget.value as Quantity })
          }
        >
          {quantityGroups(run.commands).map((group) => (
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
      {!compact && <LiveNote {...shown} />}
      {contour && onContour && (
        <ContourSettings
          settings={contour}
          onChange={onContour}
          current={currentRange}
          shift={shift}
          gray={viewColors(theme).other}
          sections={sectionsOf(run.commands)}
          chosen={view.rangeSections}
          onChoose={(sections) =>
            set({ rangeSections: sections.length ? sections : undefined })
          }
        />
      )}
    </div>
  );
}

/** Play and pause the substeps (#141). */
function PlayButton({
  player,
  shown: { total, live },
  range,
}: {
  player?: Player;
  shown: Shown;
  range?: ContourSettingsType["range"];
}) {
  if (!player) return null;
  return (
    <button
      type="button"
      class="icon-button play-button"
      aria-label={player.playing ? "Pause" : "Play"}
      title={withHint(
        player.playing
          ? "Pause"
          : range === "job"
            ? "Play the substeps"
            : "Play the substeps (the range of all substeps in the contour settings keeps the colors comparable)",
        "play",
      )}
      disabled={total < 2 || !!live}
      onClick={player.toggle}
    >
      <Icon name={player.playing ? "pause" : "play"} />
    </button>
  );
}

/** Play back and forth, or in a loop (#141). */
function BounceButton({
  player,
  shown: { total, live },
}: {
  player?: Player;
  shown: Shown;
}) {
  if (!player) return null;
  return (
    <button
      type="button"
      class="icon-button play-button"
      aria-label="Back and forth"
      aria-pressed={player.mode === "bounce"}
      title="Back and forth: after the last substep backward to the first one, and forward again (off: in a loop, after the last substep the first one)"
      disabled={total < 2 || !!live}
      onClick={() =>
        player.setMode(player.mode === "bounce" ? "loop" : "bounce")
      }
    >
      <Icon name="bounce" />
    </button>
  );
}

/**
 * The substep of the view. The compact layout (#378) shows it as a count beside the
 * slider, and keeps the words as its name.
 */
function SubstepField({
  shown: { view, total, live, set },
  compact,
}: {
  shown: Shown;
  compact?: boolean;
}) {
  return (
    <label
      class="field substep"
      title={`${hint("substep-previous")} and ${hint("substep-next")} step through the substeps, ${hint("substep-first")} and ${hint("substep-last")} go to the first and the last one`}
    >
      {compact ? (
        <span class="visually-hidden">
          {live ? live.status : `Substep ${view.substep} of ${total}`}
        </span>
      ) : (
        <span>
          {live ? (
            <span class="live-badge">{live.status}</span>
          ) : (
            <>
              Substep {view.substep} of {total}
            </>
          )}
        </span>
      )}
      <input
        type="range"
        min={1}
        max={total}
        step={1}
        value={view.substep}
        disabled={total < 2 || !!live}
        onInput={(event) => set({ substep: Number(event.currentTarget.value) })}
      />
      {compact && (
        <span class="substep-count" aria-hidden="true">
          {view.substep}/{total}
        </span>
      )}
    </label>
  );
}

/** The substeps per second while playing (#141). */
function SpeedField({
  player,
  shown: { total, live },
}: {
  player?: Player;
  shown: Shown;
}) {
  if (!player) return null;
  return (
    <label class="field speed" title="Substeps per second while playing">
      <span>Speed</span>
      <select
        value={player.speed}
        disabled={total < 2 || !!live}
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
  );
}

/** The step of the substep, and the values of the curve at it (#98, #132, #197). */
function ResultsInfo({ run, view }: Shown) {
  const step = stepOf(run, view.job, view.substep);
  const result = run.results[view.job];
  const q = curveQuantities(run.commands, view.job);
  const [defaultX, defaultY] = result ? defaultSeries(result) : [];
  const values = seriesValues(
    result,
    view.substep,
    [view.curveX ?? defaultX, view.curveY ?? defaultY].filter((s) => !!s),
    q,
  );
  return (
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
  );
}

/** The scale of the deformed shape, the undeformed shape and the curve. */
function ShapeFields({ run, view, set }: Shown) {
  return (
    <>
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
      {hasCurve(run.results[view.job]) && (
        <label class="check">
          <input
            type="checkbox"
            checked={view.curve}
            onChange={(event) => set({ curve: event.currentTarget.checked })}
          />
          Curve
        </label>
      )}
    </>
  );
}

/**
 * The controls of a phone (#378): the contour and the substep in one row, so that
 * the view keeps the height; the other controls open below it from a button.
 */
function CompactControls({
  shown,
  props,
  notes,
}: {
  shown: Shown;
  props: Props;
  /** The notes about the results, shown below the row. */
  notes: ComponentChildren;
}) {
  const [open, setOpen] = useState(false);
  const { player } = props;
  return (
    <div class="results-controls">
      <div class="results-row">
        <ContourField shown={shown} props={props} />
        <PlayButton
          player={player}
          shown={shown}
          range={props.contour?.range}
        />
        <SubstepField shown={shown} compact />
        <button
          type="button"
          class="icon-button"
          aria-label="More controls"
          aria-controls="results-more"
          aria-expanded={open}
          title="Job, speed, scale, shapes, curve and live results"
          onClick={() => setOpen(!open)}
        >
          <Icon name="settings" />
        </button>
      </div>
      <LiveNote {...shown} />
      {notes}
      <div id="results-more" class="results-more" hidden={!open}>
        <JobField {...shown} />
        <div class="field-with-button">
          <BounceButton player={player} shown={shown} />
          <SpeedField player={player} shown={shown} />
        </div>
        <ResultsInfo {...shown} />
        <ShapeFields {...shown} />
        <LiveSwitch on={props.liveOn} onChange={props.onLiveOn} />
      </div>
    </div>
  );
}

/** The controls of the results in the ribbon: job, quantity, substep and shape. */
export function ResultsControls(props: Props) {
  const { store, results, running, onChange, player, live, liveOn, onLiveOn } =
    props;
  const liveSwitch = <LiveSwitch on={liveOn} onChange={onLiveOn} />;
  if (running && !live)
    return (
      <div class="results-controls">
        <span class="muted">Solving …</span>
        {liveSwitch}
      </div>
    );
  if (!results)
    return (
      <div class="results-controls">
        <span class="muted">
          Results will appear here after the jobs have run (Solve).
        </span>
        {liveSwitch}
      </div>
    );
  const { run, view } = results;
  const shown: Shown = {
    run,
    view,
    total: substepsOf(run, view.job),
    live,
    set: (change) => onChange({ ...view, ...change }),
  };
  const changed = !live && store.resolved !== run.commands && (
    <span class="warning" role="note">
      The model was changed after solving.
    </span>
  );
  if (props.compact)
    return <CompactControls shown={shown} props={props} notes={changed} />;
  return (
    <div class="results-controls">
      <JobField {...shown} />
      <ContourField shown={shown} props={props} />
      <div class="field-with-button">
        <PlayButton
          player={player}
          shown={shown}
          range={props.contour?.range}
        />
        <BounceButton player={player} shown={shown} />
        <SubstepField shown={shown} />
        <SpeedField player={player} shown={shown} />
      </div>
      <ResultsInfo {...shown} />
      <ShapeFields {...shown} />
      {liveSwitch}
      {changed}
    </div>
  );
}
