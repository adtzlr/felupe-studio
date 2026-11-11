// The settings of the contour of results (#139): the color map, the bands and the
// range, and what the viewer draws from them (its lookup table, bands and range).
import {
  type ColorMapId,
  colorMap,
  COLOR_MAPS,
  lookupTable,
} from "./colormaps";

/** Where the range of the contour comes from. */
export type RangeMode = "substep" | "job" | "manual";

export interface ContourSettings {
  map: ColorMapId;
  /** The number of discrete bands, 0 for a continuous map. */
  bands: number;
  range: RangeMode;
  /** The limits of a manual range. */
  min?: number;
  max?: number;
}

export const DEFAULT_CONTOUR: ContourSettings = {
  map: "turbo",
  bands: 0,
  range: "substep",
};

/** The numbers of bands that can be chosen, besides continuous (0). */
export const BAND_COUNTS = [6, 8, 10, 12, 14, 16, 20] as const;

export const RANGE_MODES: readonly { id: RangeMode; label: string }[] = [
  { id: "substep", label: "Substep" },
  { id: "job", label: "All substeps" },
  { id: "manual", label: "Manual" },
];

type Range = readonly [number, number];

/** A manual range of the settings, if it is valid (min < max). */
export function manualRange(settings: ContourSettings): Range | undefined {
  const { min, max } = settings;
  return typeof min === "number" &&
    typeof max === "number" &&
    Number.isFinite(min) &&
    Number.isFinite(max) &&
    min < max
    ? [min, max]
    : undefined;
}

/**
 * The range of the contour: of the substep, over all substeps of the job (if known,
 * else of the substep) or manual. An automatic range of a diverging map is centered
 * at zero for signed values.
 */
export function contourRange(
  settings: ContourSettings,
  substep: Range,
  job?: Range,
): Range {
  if (settings.range === "manual") return manualRange(settings) ?? substep;
  const [low, high] = settings.range === "job" && job ? job : substep;
  if (colorMap(settings.map).diverging && low < 0 && high > 0) {
    const m = Math.max(-low, high);
    return [-m, m];
  }
  return [low, high];
}

/** What the viewer draws of a contour. */
export interface ContourLook {
  /** The lookup table (256 RGB colors) of the surfaces. */
  lut: Uint8Array;
  /** The bands of the surfaces (0 for continuous), with the outside bands. */
  bands: number;
  /** The range of the surfaces, extended by the outside entries or bands. */
  range: [number, number];
  /** The range of the scalar bar and the bands of the map. */
  shown: Range;
  mapBands: number;
  map: ColorMapId;
  /** Values below or above the shown range, drawn in the outside color. */
  below: boolean;
  above: boolean;
}

/**
 * The look of a contour of values within `values` (their range): with values
 * outside of the range of the contour, the lookup table has an extra color at its
 * ends (an entry, or a band) and the range of the surfaces is extended by it, so the
 * values within the range keep their colors.
 */
export function contourLook(
  settings: ContourSettings,
  shown: Range,
  values: Range,
): ContourLook {
  const [low, high] = shown;
  const flat = !(high > low);
  const below = !flat && values[0] < low;
  const above = !flat && values[1] > high;
  const bands = settings.bands;
  const outside = below || above;
  const common = {
    shown,
    mapBands: bands,
    map: settings.map,
    below,
    above,
  };
  if (!outside) {
    return {
      ...common,
      lut: lookupTable(settings.map),
      bands,
      range: [low, high],
    };
  }
  const step = bands > 0 ? (high - low) / bands : (high - low) / 254;
  return {
    ...common,
    lut: lookupTable(settings.map, { bands, outside: true }),
    bands: bands > 0 ? bands + 2 : 0,
    range: [low - step, high + step],
  };
}

const KEY = "felupe-studio.contour";

/** The settings kept in the browser, or the defaults. */
export function loadContour(storage?: Storage): ContourSettings {
  try {
    const text = (storage ?? localStorage).getItem(KEY);
    if (!text) return DEFAULT_CONTOUR;
    const value = JSON.parse(text) as Partial<ContourSettings>;
    const settings: ContourSettings = {
      map: COLOR_MAPS.some((m) => m.id === value.map)
        ? (value.map as ColorMapId)
        : DEFAULT_CONTOUR.map,
      bands:
        value.bands === 0 ||
        BAND_COUNTS.includes(value.bands as (typeof BAND_COUNTS)[number])
          ? (value.bands as number)
          : DEFAULT_CONTOUR.bands,
      range: RANGE_MODES.some((r) => r.id === value.range)
        ? (value.range as RangeMode)
        : DEFAULT_CONTOUR.range,
    };
    if (typeof value.min === "number") settings.min = value.min;
    if (typeof value.max === "number") settings.max = value.max;
    return settings;
  } catch {
    return DEFAULT_CONTOUR;
  }
}

/** Keep the settings in the browser (where it can). */
export function saveContour(settings: ContourSettings, storage?: Storage) {
  try {
    (storage ?? localStorage).setItem(KEY, JSON.stringify(settings));
  } catch {
    // e.g. storage disabled: the settings last for the session
  }
}
