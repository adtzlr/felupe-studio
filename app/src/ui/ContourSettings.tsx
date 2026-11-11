// The settings of the contour (#139) in a popover beside *Contour*: the color map,
// the bands and the range. Esc or a click outside closes it.
import { useEffect, useRef, useState } from "preact/hooks";
import { COLOR_MAPS, type ColorMapId, colorOf } from "../core/colormaps";
import {
  BAND_COUNTS,
  type ContourSettings as Settings,
  DEFAULT_CONTOUR,
  manualRange,
  RANGE_MODES,
  type RangeMode,
} from "../core/contour";

interface Props {
  settings: Settings;
  onChange: (settings: Settings) => void;
  /** The range of the shown substep, as the start of a manual range. */
  current?: readonly [number, number];
}

/** A small gradient of a map, beside its name. */
function Swatch({ map }: { map: ColorMapId }) {
  const stops = [0, 0.25, 0.5, 0.75, 1]
    .map((t) => `rgb(${colorOf(map, t).join(",")}) ${t * 100}%`)
    .join(", ");
  return (
    <span
      class="map-swatch"
      aria-hidden="true"
      style={{ background: `linear-gradient(to right, ${stops})` }}
    />
  );
}

const numberText = (x: number | undefined) =>
  x === undefined ? "" : String(+x.toPrecision(6));

export function ContourSettings({ settings, onChange, current }: Props) {
  const [open, setOpen] = useState(false);
  const [place, setPlace] = useState({ top: 0, left: 0 });
  const button = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  // the typed limits of a manual range, while they are edited
  const [min, setMin] = useState(numberText(settings.min));
  const [max, setMax] = useState(numberText(settings.max));

  const show = () => {
    const rect = button.current?.getBoundingClientRect();
    if (rect) setPlace({ top: rect.bottom + 6, left: rect.left });
    setMin(numberText(settings.min));
    setMax(numberText(settings.max));
    setOpen(true);
  };
  const close = (focus = true) => {
    setOpen(false);
    if (focus) button.current?.focus();
  };

  useEffect(() => {
    if (!open) return;
    panel.current?.querySelector<HTMLElement>("select")?.focus();
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

  const set = (change: Partial<Settings>) =>
    onChange({ ...settings, ...change });

  /** A manual range from the typed limits (kept only if both are numbers). */
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
      set({ range: "manual", min: a, max: b });
  };

  const chooseRange = (range: RangeMode) => {
    if (range === "manual" && !manualRange(settings) && current) {
      // start with the range of the shown substep
      setMin(numberText(current[0]));
      setMax(numberText(current[1]));
      set({
        range,
        min: +current[0].toPrecision(6),
        max: +current[1].toPrecision(6),
      });
    } else set({ range });
  };

  const invalid =
    settings.range === "manual" && !manualRange(settings)
      ? "The minimum must be less than the maximum."
      : undefined;
  const changed = JSON.stringify(settings) !== JSON.stringify(DEFAULT_CONTOUR);

  return (
    <>
      <button
        ref={button}
        type="button"
        class="icon-button contour-button"
        aria-label="Contour settings"
        title="Color map, bands and range of the contour"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => (open ? close(false) : show())}
      >
        <Swatch map={settings.map} />
      </button>
      {open && (
        <div
          ref={panel}
          class="popover contour-settings"
          role="dialog"
          aria-label="Contour settings"
          style={{ top: `${place.top}px`, left: `${place.left}px` }}
        >
          <label class="popover-row">
            <span>Color map</span>
            <select
              value={settings.map}
              onChange={(event) =>
                set({ map: event.currentTarget.value as ColorMapId })
              }
            >
              {COLOR_MAPS.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.label}
                  {m.diverging ? " (centered at 0)" : ""}
                </option>
              ))}
            </select>
          </label>
          <label class="popover-row">
            <span>Bands</span>
            <select
              value={String(settings.bands)}
              onChange={(event) =>
                set({ bands: Number(event.currentTarget.value) })
              }
            >
              <option value="0">Continuous</option>
              {BAND_COUNTS.map((n) => (
                <option key={n} value={String(n)}>
                  {n} bands
                </option>
              ))}
            </select>
          </label>
          <fieldset class="popover-row">
            <legend>Range</legend>
            <div class="popover-choices">
              {RANGE_MODES.map((r) => (
                <label key={r.id} class="check">
                  <input
                    type="radio"
                    name="contour-range"
                    checked={settings.range === r.id}
                    onChange={() => chooseRange(r.id)}
                  />
                  {r.label}
                </label>
              ))}
            </div>
          </fieldset>
          {settings.range === "manual" && (
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
                {invalid ?? "Values outside are drawn in an extra color."}
              </small>
            </div>
          )}
          <div class="popover-actions">
            <button
              type="button"
              class="button"
              disabled={!changed}
              onClick={() => {
                onChange(DEFAULT_CONTOUR);
                setMin("");
                setMax("");
              }}
            >
              Defaults
            </button>
          </div>
        </div>
      )}
    </>
  );
}
