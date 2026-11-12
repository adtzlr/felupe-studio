// The options of the axes of the curve (#197) in a popover of the curve card: per
// axis the scale (linear or log), negated values and a fixed range. Esc or a click
// outside closes it; like the contour settings (#139).
import { useEffect, useLayoutEffect, useRef, useState } from "preact/hooks";
import {
  type CurveAxis,
  type CurveSettings as Settings,
  DEFAULT_CURVE,
  fixedRange,
} from "../core/curve";

interface Props {
  settings: Settings;
  onChange: (settings: Settings) => void;
  /** The names of the quantities of the axes, e.g. ux and Fx. */
  names: { x: string; y: string };
  /** The shown ranges of the axes, as the start of a fixed range. */
  current: { x: [number, number]; y: [number, number] };
}

const numberText = (x: number | undefined) =>
  x === undefined ? "" : String(+x.toPrecision(6));

/** The options of one axis. */
function AxisOptions({
  id,
  name,
  axis,
  current,
  onChange,
}: {
  id: "x" | "y";
  name: string;
  axis: CurveAxis;
  current: [number, number];
  onChange: (axis: CurveAxis) => void;
}) {
  // the typed limits of a fixed range, while they are edited
  const [min, setMin] = useState(numberText(axis.min));
  const [max, setMax] = useState(numberText(axis.max));
  const fixed = axis.min !== undefined && axis.max !== undefined;
  const set = (change: Partial<CurveAxis>) => onChange({ ...axis, ...change });

  const setLimits = (minText: string, maxText: string) => {
    setMin(minText);
    setMax(maxText);
    const a = Number(minText.trim());
    const b = Number(maxText.trim());
    if (
      minText.trim() !== "" &&
      maxText.trim() !== "" &&
      Number.isFinite(a) &&
      Number.isFinite(b)
    )
      set({ min: a, max: b });
  };
  const chooseFixed = (on: boolean) => {
    if (!on) {
      onChange({ scale: axis.scale, negate: axis.negate });
      return;
    }
    // start with the shown range
    const [a, b] = current.map((v) => +v.toPrecision(6));
    setMin(numberText(a));
    setMax(numberText(b));
    set({ min: a, max: b });
  };
  const invalid =
    fixed && !fixedRange(axis)
      ? axis.scale === "log"
        ? "On a log scale, the limits are positive and the minimum is less than the maximum."
        : "The minimum must be less than the maximum."
      : undefined;

  return (
    <fieldset class="popover-row curve-axis-options">
      <legend>
        {id === "x" ? "Horizontal" : "Vertical"} axis · {name}
      </legend>
      <div class="popover-choices">
        <label class="check">
          <input
            type="radio"
            name={`curve-scale-${id}`}
            checked={axis.scale === "linear"}
            onChange={() => set({ scale: "linear" })}
          />
          Linear
        </label>
        <label class="check">
          <input
            type="radio"
            name={`curve-scale-${id}`}
            checked={axis.scale === "log"}
            onChange={() => set({ scale: "log" })}
          />
          Log
        </label>
        <label class="check">
          <input
            type="checkbox"
            checked={axis.negate}
            onChange={(event) => set({ negate: event.currentTarget.checked })}
          />
          Negate
        </label>
        <label class="check">
          <input
            type="checkbox"
            checked={fixed}
            onChange={(event) => chooseFixed(event.currentTarget.checked)}
          />
          Fixed range
        </label>
      </div>
      {fixed && (
        <div class="popover-limits">
          <label>
            <span>Min</span>
            <input
              type="text"
              inputMode="decimal"
              value={min}
              aria-invalid={invalid ? true : undefined}
              onInput={(event) => setLimits(event.currentTarget.value, max)}
            />
          </label>
          <label>
            <span>Max</span>
            <input
              type="text"
              inputMode="decimal"
              value={max}
              aria-invalid={invalid ? true : undefined}
              onInput={(event) => setLimits(min, event.currentTarget.value)}
            />
          </label>
          <small class={invalid ? "field-error" : "muted"}>
            {invalid ?? "The curve is cut off outside."}
          </small>
        </div>
      )}
    </fieldset>
  );
}

export function CurveSettings({ settings, onChange, names, current }: Props) {
  const [open, setOpen] = useState(false);
  const [place, setPlace] = useState({ top: 0, left: 0 });
  const button = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);

  const show = () => {
    const rect = button.current?.getBoundingClientRect();
    if (rect) setPlace({ top: rect.bottom + 6, left: rect.left });
    setOpen(true);
  };
  const close = (focus = true) => {
    setOpen(false);
    if (focus) button.current?.focus();
  };

  // inside the window: moved to the left if it would reach beyond the right edge
  useLayoutEffect(() => {
    const width = panel.current?.offsetWidth;
    if (!open || !width) return;
    const left = Math.max(
      8,
      Math.min(place.left, window.innerWidth - width - 8),
    );
    if (left !== place.left) setPlace({ ...place, left });
  }, [open, place]);

  useEffect(() => {
    if (!open) return;
    panel.current?.querySelector<HTMLElement>("input")?.focus();
    const outside = (event: PointerEvent) => {
      const target = event.target as Node;
      if (panel.current?.contains(target) || button.current?.contains(target))
        return;
      setOpen(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      close();
    };
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("keydown", escape);
    };
  }, [open]);

  const changed = JSON.stringify(settings) !== JSON.stringify(DEFAULT_CURVE);

  return (
    <>
      <button
        ref={button}
        type="button"
        class="link-button"
        aria-label="Curve settings"
        title="Scales, negated values and ranges of the axes"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-pressed={changed}
        onClick={() => (open ? close(false) : show())}
      >
        Axes
      </button>
      {open && (
        <div
          ref={panel}
          class="popover curve-settings"
          role="dialog"
          aria-label="Curve settings"
          style={{ top: `${place.top}px`, left: `${place.left}px` }}
        >
          {(["x", "y"] as const).map((id) => (
            <AxisOptions
              key={id}
              id={id}
              name={names[id]}
              axis={settings[id]}
              current={current[id]}
              onChange={(axis) => onChange({ ...settings, [id]: axis })}
            />
          ))}
          <div class="popover-actions">
            <button
              type="button"
              class="button"
              disabled={!changed}
              onClick={() => onChange(DEFAULT_CURVE)}
            >
              Defaults
            </button>
          </div>
        </div>
      )}
    </>
  );
}
