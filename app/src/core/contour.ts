// The settings of the contour of results (#139): the color map, the bands and the
// range, and what the viewer draws from them (its lookup table, bands and range),
// and the values of the strains and the stresses at the cells or the points (#231).
// The automatic range may come from chosen sections (#377).
import { storageKey } from "../brand";
import type {
  Quantity,
  ResultExtremes,
  ResultRanges,
  ResultScene,
  ValuesMethod,
} from "../worker/protocol";
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
  /** The values of the strains and the stresses at the cells or the points (#231). */
  values: ValuesMethod;
}

export const DEFAULT_CONTOUR: ContourSettings = {
  map: "turbo",
  bands: 0,
  range: "substep",
  values: "cells",
};

/** The numbers of bands that can be chosen, besides continuous (0). */
export const BAND_COUNTS = [6, 8, 10, 12, 14, 16, 20] as const;

export const RANGE_MODES: readonly { id: RangeMode; label: string }[] = [
  { id: "substep", label: "Substep" },
  { id: "job", label: "All substeps" },
  { id: "manual", label: "Manual" },
];

/** The methods of the values of the strains and the stresses (#231). */
export const VALUES_METHODS: readonly {
  id: ValuesMethod;
  label: string;
  hint: string;
}[] = [
  {
    id: "cells",
    label: "Cells",
    hint: "The mean of the quadrature points of every cell, constant in the cell.",
  },
  {
    id: "mean",
    label: "Points: means of the cells",
    hint: "The means of the cells at a point, averaged (of the tensors; the principal values and von Mises at the point).",
  },
  {
    id: "project",
    label: "Points: projected",
    hint: "The tensors of the quadrature points projected to the points (L2 projection, fem.project), then the principal values and von Mises at the point: closer to the peaks, e.g. at a notch.",
  },
  {
    id: "topoints",
    label: "Points: shifted",
    hint: "The values of the quadrature points shifted to the points (fem.topoints), averaged: for cells whose quadrature points are at their points, e.g. hexahedrons and quads.",
  },
];

/**
 * The method of the values of a quantity (#231): the displacements are values of
 * the points (the scenes and their ranges do not depend on the method).
 */
export const methodOf = (
  quantity: Quantity,
  settings: ContourSettings,
): ValuesMethod =>
  quantity.startsWith("displacement") ? "cells" : settings.values;

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

/**
 * The chosen sections of the automatic range of a contour (#377), among the
 * sections of the results and in their order. None, for all sections: without a
 * choice, with a manual range, if all of them are chosen, or if none of them is in
 * the results (e.g. removed or renamed).
 */
export function rangeSectionsOf(
  settings: ContourSettings,
  chosen: readonly string[] | undefined,
  sections: readonly string[],
): string[] {
  if (settings.range === "manual" || !chosen?.length) return [];
  const result = sections.filter((s) => chosen.includes(s));
  return result.length === sections.length ? [] : result;
}

/** The range of ranges (null without any). */
function unionOf(ranges: readonly (Range | null | undefined)[]): Range | null {
  const finite = ranges.filter((r): r is Range => !!r);
  if (!finite.length) return null;
  return [
    Math.min(...finite.map((r) => r[0])),
    Math.max(...finite.map((r) => r[1])),
  ];
}

/** The smallest minimum and the largest maximum of extremes (the first of equals). */
function extremesOf(
  all: readonly (ResultExtremes | null | undefined)[],
): ResultExtremes | null {
  const found = all.filter((e): e is ResultExtremes => !!e);
  if (!found.length) return null;
  return {
    min: found.reduce((a, b) => (b.min.value < a.min.value ? b : a)).min,
    max: found.reduce((a, b) => (b.max.value > a.max.value ? b : a)).max,
  };
}

/**
 * The range and the extremes of the values of the chosen sections of a scene
 * (#377), of all sections without a choice. The range is null if the chosen
 * sections have no finite values.
 */
export function sectionValues(
  scene: ResultScene,
  chosen: readonly string[],
): { range: Range | null; extremes: ResultExtremes | null } {
  if (!chosen.length || !scene.sections)
    return { range: scene.range, extremes: scene.extremes ?? null };
  const parts = chosen.flatMap((s) => scene.sections?.[s] ?? []);
  return {
    range: unionOf(parts.map((p) => p.range)),
    extremes: extremesOf(parts.map((p) => p.extremes)),
  };
}

/**
 * The range over all substeps of a job (#139), of the chosen sections (#377) or of
 * all sections; undefined without finite values.
 */
export function jobRangeOf(
  ranges: ResultRanges,
  chosen: readonly string[],
): Range | undefined {
  const lists = chosen.length
    ? chosen.map((s) => ranges.sections[s] ?? [])
    : [ranges.range];
  return unionOf(lists.flat()) ?? undefined;
}

/**
 * The note of the scalar bar of a range of chosen sections (#377), also in a picture
 * of the view, e.g. "Range: soft_body"; none for all sections.
 */
export function rangeNote(chosen: readonly string[]): string | undefined {
  if (!chosen.length) return undefined;
  const names =
    chosen.length > 3
      ? `${chosen.slice(0, 2).join(", ")} and ${chosen.length - 2} more sections`
      : chosen.join(", ");
  return `Range: ${names}`;
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
  /** The sections of the range, if chosen (#377), below the title of the bar. */
  note?: string;
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

const KEY = storageKey("contour");

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
      values: VALUES_METHODS.some((m) => m.id === value.values)
        ? (value.values as ValuesMethod)
        : DEFAULT_CONTOUR.values,
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
