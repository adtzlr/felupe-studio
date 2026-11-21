// The contour of the shown scene of the results (#139): its look, the map, the
// bands and the range of the substep, of all substeps of the job or manual. The
// automatic range may come from chosen sections (#377): their range and their
// minimum and maximum, which the scene shows instead of those of all sections; the
// values of the other sections outside of the range take the outside color, or the
// other sections are drawn in one color or not at all (#396).
import { useMemo } from "preact/hooks";
import {
  type ContourSettings,
  contourLook,
  contourRange,
  jobRangeOf,
  otherSectionsOf,
  rangeNote,
  rangeSectionsOf,
  sectionValues,
} from "../core/contour";
import type { ResultView } from "../core/results";
import type { ResultScene, ValuesMethod } from "../worker/protocol";
import { type ResultSource, useJobRanges } from "./useResultScene";

interface Options {
  source?: ResultSource;
  /** The loaded or the live scene. */
  scene?: ResultScene;
  view?: ResultView;
  contour: ContourSettings;
  /** The values of the strains and the stresses (#231). */
  method: ValuesMethod;
  /** The scenes are loaded: the ranges of all substeps can be, too. */
  shown: boolean;
  /** The results of a run (#141): a new run has other ranges. */
  generation: number;
}

export function useContourLook({
  source,
  scene: loaded,
  view,
  contour,
  method,
  shown,
  generation,
}: Options) {
  const sections = Object.keys(loaded?.sections ?? {});
  const chosen = rangeSectionsOf(contour, view?.rangeSections, sections);
  const chosenKey = chosen.join("\n");
  const own = useMemo(
    () => loaded && sectionValues(loaded, chosen),
    [loaded, chosenKey],
  );
  // the extremes of the chosen sections, so the markers match the scale
  const scene = useMemo(
    () =>
      loaded && chosen.length
        ? { ...loaded, extremes: own?.extremes ?? null }
        : loaded,
    [loaded, own],
  );
  const jobRanges = useJobRanges(
    source,
    view && shown && contour.range === "job"
      ? `${generation}/${view.job}/${method}/${view.quantity}`
      : undefined,
    view?.job ?? "",
    view?.quantity ?? "displacement",
    method,
  );
  const jobRange = useMemo(
    () => jobRanges && jobRangeOf(jobRanges, chosen),
    [jobRanges, chosenKey],
  );
  // the range of all sections, and of the chosen ones (if they have values)
  const values = loaded?.range ?? undefined;
  const range = own?.range ?? values;
  const look = useMemo(() => {
    if (!loaded) return undefined;
    const all: [number, number] = values ?? [0, 0];
    const result = contourLook(
      contour,
      contourRange(contour, range ?? all, jobRange),
      all,
    );
    const note = rangeNote(chosen);
    const others = otherSectionsOf(contour, chosen, sections);
    return {
      ...result,
      ...(note ? { note } : {}),
      ...(others ? { others } : {}),
    };
  }, [
    loaded,
    contour,
    chosenKey,
    jobRange?.[0],
    jobRange?.[1],
    range?.[0],
    range?.[1],
  ]);
  return { scene, look, range };
}
