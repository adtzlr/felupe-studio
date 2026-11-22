// The cut of the view toolbars (#395, ADR 0022): a plane normal to x, y or z (not z
// of a 2D model) at a coordinate, with the hidden half. The slider spans the bounds
// of the model and asks for a new cut when it stops; the coordinate is typed in its
// field. A setting of the view, shared by the workspaces, not of the project.
import { useEffect, useState } from "preact/hooks";
import { CUT_AXES } from "../viewer/cut";
import type { Cut } from "../worker/protocol";

/** A coordinate as text, without the noise of floating point numbers. */
const text = (x: number) => String(+x.toPrecision(12));

/** The bounds of the drawn meshes: the least and the greatest coordinates. */
export interface Bounds {
  min: [number, number, number];
  max: [number, number, number];
}

/** The bounds of nodes (three coordinates each), undefined without nodes. */
export function boundsOf(
  nodes: readonly ArrayLike<number>[],
): Bounds | undefined {
  const min: Bounds["min"] = [Infinity, Infinity, Infinity];
  const max: Bounds["max"] = [-Infinity, -Infinity, -Infinity];
  for (const points of nodes) {
    for (let p = 0; p + 2 < points.length; p += 3) {
      for (const k of [0, 1, 2] as const) {
        min[k] = Math.min(min[k], points[p + k]);
        max[k] = Math.max(max[k], points[p + k]);
      }
    }
  }
  return min[0] <= max[0] ? { min, max } : undefined;
}

/**
 * The slider of a cut along an axis: about a hundred steps of a power of ten over the
 * bounds, from and to a multiple of the step.
 */
export function sliderOf(
  low: number,
  high: number,
): { min: number; max: number; step: number; round: (x: number) => number } {
  const span = high - low > 0 ? high - low : Math.max(Math.abs(low), 1);
  const step = 10 ** Math.floor(Math.log10(span / 100));
  const digits = Math.max(0, -Math.floor(Math.log10(step)));
  const round = (x: number) => +(Math.round(x / step) * step).toFixed(digits);
  return {
    min: round(Math.floor(low / step) * step),
    max: round(Math.ceil(high / step) * step),
    step,
    round,
  };
}

/** The cut of the view in a 2D model: none by z (ADR 0022). */
export const shownCut = (cut: Cut | undefined, planar: boolean) =>
  cut && !(planar && cut.axis === "z") ? cut : undefined;

interface Props {
  cut: Cut | undefined;
  onCut: (cut: Cut | undefined) => void;
  bounds: Bounds | undefined;
  /** A 2D model, cut by x or y only. */
  planar: boolean;
}

/** *Cut* of a view toolbar: the axis, the hidden half and the coordinate. */
export function CutControls({ cut: given, onCut, bounds, planar }: Props) {
  const cut = shownCut(given, planar);
  const axes = planar ? CUT_AXES.slice(0, 2) : CUT_AXES;
  const k = cut ? CUT_AXES.indexOf(cut.axis) : 0;
  const slider = bounds && sliderOf(bounds.min[k], bounds.max[k]);
  // the coordinate while the slider moves or the field is typed in
  const [draft, setDraft] = useState<string>();
  useEffect(() => setDraft(undefined), [cut?.axis, cut?.value]);

  const choose = (axis: string) => {
    if (!axis) return onCut(undefined);
    const at = CUT_AXES.indexOf(axis as Cut["axis"]);
    const range = bounds && sliderOf(bounds.min[at], bounds.max[at]);
    const middle = bounds ? (bounds.min[at] + bounds.max[at]) / 2 : 0;
    onCut({
      axis: axis as Cut["axis"],
      value: range ? range.round(middle) : 0,
      half: cut?.half ?? "+",
    });
  };
  const commit = (text: string) => {
    const value = Number(text);
    if (!cut || text.trim() === "" || !Number.isFinite(value)) {
      return setDraft(undefined);
    }
    if (value !== cut.value) onCut({ ...cut, value });
    else setDraft(undefined);
  };
  const shown = draft ?? text(cut?.value ?? 0);
  const [hidden, other] = cut?.half === "-" ? ["<", ">"] : [">", "<"];
  return (
    <span class="cut-controls">
      <select
        aria-label="Cut"
        title="Cut the view by a plane normal to an axis, through the undeformed model"
        value={cut?.axis ?? ""}
        onChange={(event) => choose(event.currentTarget.value)}
      >
        <option value="">No cut</option>
        {axes.map((axis) => (
          <option key={axis} value={axis}>
            Cut {axis}
          </option>
        ))}
      </select>
      {cut && (
        <>
          <button
            type="button"
            class="cut-half"
            title={`Hide the half ${cut.axis} ${hidden} ${shown}; click to hide ${cut.axis} ${other} ${shown} instead`}
            onClick={() =>
              onCut({ ...cut, half: cut.half === "-" ? "+" : "-" })
            }
          >
            Hide {cut.axis} {hidden}
          </button>
          <input
            type="number"
            class="cut-value"
            aria-label={`Coordinate of the cut, ${cut.axis}`}
            step={slider?.step ?? "any"}
            value={shown}
            onInput={(event) => setDraft(event.currentTarget.value)}
            onChange={(event) => commit(event.currentTarget.value)}
          />
          {slider && (
            <input
              type="range"
              class="cut-slider"
              aria-label={`Position of the cut along ${cut.axis}`}
              min={slider.min}
              max={slider.max}
              step={slider.step}
              value={draft ?? cut.value}
              onInput={(event) =>
                setDraft(text(slider.round(+event.currentTarget.value)))
              }
              onChange={(event) =>
                commit(String(slider.round(+event.currentTarget.value)))
              }
            />
          )}
        </>
      )}
    </span>
  );
}
