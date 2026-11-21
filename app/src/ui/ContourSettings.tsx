// The settings of the contour (#139) in a popover beside *Contour*: the color map,
// the bands, the range, the sections of an automatic range (#377) with the look of
// the other sections (#396) and the values at the cells or the points (#231). Esc
// or a click outside closes it.
import { useEffect, useLayoutEffect, useRef, useState } from "preact/hooks";
import {
  COLOR_MAPS,
  type ColorMapId,
  colorOf,
  isColor,
} from "../core/colormaps";
import {
  BAND_COUNTS,
  type ContourSettings as Settings,
  DEFAULT_CONTOUR,
  manualRange,
  OTHERS_MODES,
  RANGE_MODES,
  type RangeMode,
  VALUES_METHODS,
} from "../core/contour";
import { VIEW_COLORS } from "../viewer/palette";
import type { ValuesMethod } from "../worker/protocol";

interface Props {
  settings: Settings;
  onChange: (settings: Settings) => void;
  /** The range of the shown substep, as the start of a manual range. */
  current?: readonly [number, number];
  /**
   * The values of the quadrature points of the results can be shifted to the
   * points (#231); false: they are projected instead (unknown without results).
   */
  shift?: boolean;
  /**
   * The sections of the results, for an automatic range of chosen sections (#377):
   * the chosen ones (none for all sections) and their choice, a part of the view of
   * the results, not of the settings.
   */
  sections?: readonly string[];
  chosen?: readonly string[];
  onChoose?: (sections: string[]) => void;
  /** The gray of the other sections in one color in the theme of the view (#396). */
  gray?: string;
}

/**
 * The sections of an automatic range (#377): *All sections*, or the chosen ones.
 * The values of the others outside of the range take the outside color.
 */
function RangeSections({
  sections,
  chosen,
  onChoose,
}: {
  sections: readonly string[];
  chosen: readonly string[];
  onChoose: (sections: string[]) => void;
}) {
  // all of them are all sections, a removed or renamed one is not chosen
  const choose = (next: string[]) =>
    onChoose(next.length === sections.length ? [] : next);
  return (
    <fieldset class="popover-row range-sections">
      <legend>Range of</legend>
      <div class="popover-choices">
        <label class="check">
          <input
            type="checkbox"
            checked={!chosen.length}
            onChange={(event) => {
              // all sections stay chosen until a section is chosen
              if (!chosen.length) event.currentTarget.checked = true;
              else choose([]);
            }}
          />
          All sections
        </label>
        {sections.map((section) => (
          <label key={section} class="check">
            <input
              type="checkbox"
              checked={chosen.includes(section)}
              onChange={(event) =>
                choose(
                  sections.filter((s) =>
                    s === section
                      ? event.currentTarget.checked
                      : chosen.includes(s),
                  ),
                )
              }
            />
            {section}
          </label>
        ))}
      </div>
      <small class="muted popover-note">
        {chosen.length
          ? "The range of the values of the chosen sections."
          : "The range of the values of all sections."}
      </small>
    </fieldset>
  );
}

/**
 * The other sections of a range of chosen sections (#396): with their contour, in
 * one color (an own one, or the gray of the view) or hidden.
 */
function OtherSections({
  settings,
  set,
  gray,
}: {
  settings: Settings;
  set: (change: Partial<Settings>) => void;
  gray: string;
}) {
  // the typed color, while it is edited
  const [text, setText] = useState(settings.othersColor ?? "");
  useEffect(() => {
    if (!text.trim() || isColor(text.trim()))
      setText(settings.othersColor ?? "");
  }, [settings.othersColor]);
  const typed = text.trim();
  const invalid = typed !== "" && !isColor(typed);
  const color = (value: string) => {
    setText(value);
    const trimmed = value.trim();
    if (!trimmed) set({ othersColor: undefined });
    else if (isColor(trimmed)) set({ othersColor: trimmed });
  };
  const mode = OTHERS_MODES.find((m) => m.id === settings.others);
  return (
    <fieldset class="popover-row other-sections">
      <legend>Other sections</legend>
      <div class="popover-choices">
        {OTHERS_MODES.map((m) => (
          <label key={m.id} class="check">
            <input
              type="radio"
              name="contour-others"
              checked={settings.others === m.id}
              onChange={() => set({ others: m.id })}
            />
            {m.label}
          </label>
        ))}
      </div>
      {settings.others === "color" && (
        <div class="color-field popover-color">
          <input
            type="color"
            aria-label="Pick the color of the other sections"
            value={(settings.othersColor ?? gray).toLowerCase()}
            onInput={(event) => color(event.currentTarget.value)}
          />
          <input
            type="text"
            aria-label="Color of the other sections"
            value={text}
            placeholder={gray}
            title="An own color, #rrggbb; empty for the gray of the view"
            aria-invalid={invalid ? true : undefined}
            autocomplete="off"
            spellcheck={false}
            onInput={(event) => color(event.currentTarget.value)}
          />
          <button
            type="button"
            class="button"
            title="The gray of the view"
            disabled={!settings.othersColor && !text}
            onClick={() => color("")}
          >
            Default
          </button>
        </div>
      )}
      <small class={`popover-note ${invalid ? "field-error" : "muted"}`}>
        {invalid
          ? "A color like #7f8c8d: # and six hexadecimal digits."
          : mode?.hint}
      </small>
    </fieldset>
  );
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

export function ContourSettings({
  settings,
  onChange,
  current,
  shift,
  sections = [],
  chosen: stored,
  onChoose,
  gray = VIEW_COLORS.dark.other,
}: Props) {
  const chosen = sections.filter((s) => stored?.includes(s));
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
  const changed =
    JSON.stringify(settings) !== JSON.stringify(DEFAULT_CONTOUR) ||
    chosen.length > 0;
  // the sections of an automatic range (#377), and then the other sections (#396)
  const ranged = settings.range !== "manual" && sections.length > 1 && onChoose;
  // the values are projected if they cannot be shifted to the points (#231)
  const fallback = settings.values === "topoints" && shift === false;
  const values = fallback ? "project" : settings.values;

  return (
    <>
      <button
        ref={button}
        type="button"
        class="icon-button contour-button"
        aria-label="Contour settings"
        title="Color map, bands and range of the contour, and the values at the cells or the points"
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
          {ranged && (
            <RangeSections
              sections={sections}
              chosen={chosen}
              onChoose={onChoose}
            />
          )}
          {ranged && chosen.length > 0 && (
            <OtherSections settings={settings} set={set} gray={gray} />
          )}
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
          <div class="popover-row">
            <label for="contour-values">Values at</label>
            <select
              id="contour-values"
              value={values}
              title="The values of the strains and the stresses"
              aria-describedby="contour-values-note"
              onChange={(event) =>
                set({ values: event.currentTarget.value as ValuesMethod })
              }
            >
              {VALUES_METHODS.map((m) => (
                <option
                  key={m.id}
                  value={m.id}
                  disabled={m.id === "topoints" && shift === false}
                >
                  {m.label}
                </option>
              ))}
            </select>
            <small id="contour-values-note" class="muted popover-note">
              {fallback
                ? "The quadrature points of the cells are not at their points (e.g. of tetrahedrons): the values are projected instead of shifted."
                : VALUES_METHODS.find((m) => m.id === values)?.hint}
            </small>
          </div>
          <div class="popover-actions">
            <button
              type="button"
              class="button"
              disabled={!changed}
              onClick={() => {
                onChange(DEFAULT_CONTOUR);
                onChoose?.([]);
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
