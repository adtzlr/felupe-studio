// Picked surfaces as patches (#195), like `Mesh.select_surface_points()` of FElupe 12:
// left clicks add the connected surfaces of clicked faces (#189), a right click
// deselects a patch and a second one excludes it. The faces and points of excluded
// patches are removed from the selection (they have priority), e.g. the points of an
// edge that a selected patch shares with an excluded neighbour.
import type { SectionFaces } from "./facesets";
import { connectedFaces } from "./surfaces";

/**
 * The state of a patch: selected, excluded (its faces and points are removed from
 * the selection) or omitted (a face of a selected patch removed with Shift+click,
 * its points stay if other selected faces have them).
 */
export type PatchState = "selected" | "excluded" | "omitted";

export interface Patch {
  section: string;
  /** The clicked face: the patch is its connected surface up to the feature angle. */
  seed: number;
  state: PatchState;
  /** A single face, picked with Shift. */
  single?: boolean;
}

/** A face of the boundary of a section. */
export interface FaceAt {
  section: string;
  face: number;
}

/** A click on a face: right (deselect or exclude) and with Shift (single faces). */
export interface PatchClick {
  right?: boolean;
  shift: boolean;
}

/** The faces of a patch (none if its section or its face is gone). */
export function patchFaces(
  patch: Patch,
  of: SectionFaces | undefined,
  angle: number,
): number[] {
  if (!of || !(patch.seed >= 0 && patch.seed < of.faces.length)) return [];
  return patch.single ? [patch.seed] : connectedFaces(of, patch.seed, angle);
}

/** The faces of combined patches per section, sorted. */
export interface Combined {
  /** The selected faces, without excluded and omitted faces. */
  faces: Map<string, number[]>;
  /** The excluded faces. */
  excluded: Map<string, number[]>;
}

/** The faces of patches: those of the selected ones without excluded or omitted. */
export function combine(
  patches: readonly Patch[],
  sections: ReadonlyMap<string, SectionFaces>,
  angle: number,
): Combined {
  const sets: Record<PatchState, Map<string, Set<number>>> = {
    selected: new Map(),
    excluded: new Map(),
    omitted: new Map(),
  };
  for (const patch of patches) {
    const faces = patchFaces(patch, sections.get(patch.section), angle);
    if (!faces.length) continue;
    const of = sets[patch.state];
    const set = of.get(patch.section) ?? new Set<number>();
    for (const f of faces) set.add(f);
    of.set(patch.section, set);
  }
  const sorted = (set: Iterable<number>) => [...set].sort((a, b) => a - b);
  const faces = new Map<string, number[]>();
  for (const [section, set] of sets.selected) {
    const excluded = sets.excluded.get(section);
    const omitted = sets.omitted.get(section);
    const list = sorted(set).filter(
      (f) => !excluded?.has(f) && !omitted?.has(f),
    );
    if (list.length) faces.set(section, list);
  }
  const excluded = new Map<string, number[]>();
  for (const [section, set] of sets.excluded)
    excluded.set(section, sorted(set));
  return { faces, excluded };
}

/** Whether a face is selected or excluded by combined patches (else undefined). */
export function faceState(
  combined: Combined,
  at: FaceAt,
): "selected" | "excluded" | undefined {
  if (combined.excluded.get(at.section)?.includes(at.face)) return "excluded";
  if (combined.faces.get(at.section)?.includes(at.face)) return "selected";
  return undefined;
}

/**
 * The patches after a click on a face:
 *
 * - a left click selects the patch of the face (added to the others), or an
 *   excluded patch again;
 * - a right click deselects the selected patches of the face; on a face that is not
 *   selected it excludes its patch, on an excluded face it removes the exclusion;
 * - with Shift the same for single faces: Shift+click adds or removes a face (or
 *   omits a face of a selected patch), Shift+right-click excludes a face.
 */
export function pickPatch(
  patches: readonly Patch[],
  at: FaceAt,
  click: PatchClick,
  sections: ReadonlyMap<string, SectionFaces>,
  angle: number,
): Patch[] {
  const contains = (p: Patch) =>
    p.section === at.section &&
    patchFaces(p, sections.get(p.section), angle).includes(at.face);
  const single = (p: Patch, state: PatchState) =>
    !!p.single &&
    p.section === at.section &&
    p.seed === at.face &&
    p.state === state;
  const added = (state: PatchState, one: boolean): Patch => ({
    section: at.section,
    seed: at.face,
    state,
    ...(one ? { single: true } : {}),
  });
  const state = faceState(combine(patches, sections, angle), at);
  const selectedHere = patches.some(
    (p) => p.state === "selected" && contains(p),
  );
  // the omitted faces at the clicked face are no longer omitted
  const rest = patches.filter((p) => !single(p, "omitted"));

  if (click.right) {
    if (state === "excluded") {
      // Shift: only a single excluded face, if there is one
      if (click.shift && patches.some((p) => single(p, "excluded")))
        return patches.filter((p) => !single(p, "excluded"));
      return patches.filter((p) => !(p.state === "excluded" && contains(p)));
    }
    if (selectedHere && !click.shift) {
      return rest.filter((p) => !(p.state === "selected" && contains(p)));
    }
    return [...rest, added("excluded", click.shift)];
  }
  if (state === "excluded") {
    return patches.map((p) =>
      p.state === "excluded" && contains(p) ? { ...p, state: "selected" } : p,
    );
  }
  if (click.shift) {
    if (state === "selected") {
      // a face added with Shift is removed, a face of a selected patch omitted
      const singles = patches
        .filter((p) => p.state === "selected" && contains(p))
        .every((p) => single(p, "selected"));
      return singles
        ? patches.filter((p) => !single(p, "selected"))
        : [...patches, added("omitted", true)];
    }
    return rest.length < patches.length
      ? rest
      : [...patches, added("selected", true)];
  }
  if (state === "selected") return [...patches];
  return rest.some((p) => p.state === "selected" && !p.single && contains(p))
    ? rest
    : [...rest, added("selected", false)];
}

/** The number of selected and of excluded patches. */
export function patchCounts(patches: readonly Patch[]): {
  selected: number;
  excluded: number;
} {
  return {
    selected: patches.filter((p) => p.state === "selected").length,
    excluded: patches.filter((p) => p.state === "excluded").length,
  };
}
