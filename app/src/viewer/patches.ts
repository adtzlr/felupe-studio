// Picked surfaces as patches (#195), like `Mesh.select_surface_points()` of FElupe 12:
// a click (or a tap) cycles the connected surface of a clicked face (#189) through
// picked, excluded and not picked (#260); a right click deselects it at once. The
// faces and points of excluded patches are removed from the selection (they have
// priority), e.g. the points of an edge that a selected patch shares with an
// excluded neighbour.
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

/** A click on a face: right (deselects at once) and with Shift (single faces). */
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
 * The patches after a click on a face (#260): a click (or a tap) cycles the state of
 * the clicked surface, the same with a mouse, a pen and a touch screen:
 *
 * 1. pick: a surface that is not picked is added to the others (the connected
 *    surface of the face up to the feature angle);
 * 2. exclude: a picked surface is excluded;
 * 3. deselect: an excluded surface is removed.
 *
 * Shift+click cycles a single face the same way; a face of a picked surface is
 * omitted instead, and a second Shift+click takes it back. A right click deselects
 * the clicked surface at once, picked or excluded (with Shift, the single face); it
 * is a shortcut, not needed for any step.
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
  const selected = patches.filter((p) => p.state === "selected" && contains(p));
  // a face of a selected surface (not only single faces)
  const ofSurface = selected.some((p) => !p.single);
  // the omitted faces at the clicked face are no longer omitted
  const rest = patches.filter((p) => !single(p, "omitted"));
  const omitted = rest.length < patches.length;

  if (state === "excluded") {
    // excluded → not picked; Shift: only a single excluded face, if there is one
    if (click.shift && patches.some((p) => single(p, "excluded")))
      return patches.filter((p) => !single(p, "excluded"));
    return patches.filter((p) => !(p.state === "excluded" && contains(p)));
  }
  if (click.right) {
    if (!selected.length) return [...patches];
    if (!click.shift) return rest.filter((p) => !selected.includes(p));
    // Shift: a single face, or an omitted face of a picked surface
    if (!ofSurface) return patches.filter((p) => !single(p, "selected"));
    return omitted ? [...patches] : [...patches, added("omitted", true)];
  }
  if (click.shift) {
    // a face of a picked surface: omitted, and taken back by a second click
    if (ofSurface) return omitted ? rest : [...patches, added("omitted", true)];
    // a single face: picked → excluded
    if (state === "selected")
      return patches.map((p) =>
        single(p, "selected") ? { ...p, state: "excluded" } : p,
      );
    return [...patches, added("selected", true)];
  }
  if (state === "selected") {
    // picked → excluded: the picked surfaces (and single faces) of the face, without
    // the faces omitted from them
    const faces = new Set(
      selected.flatMap((p) => patchFaces(p, sections.get(p.section), angle)),
    );
    return patches
      .filter(
        (p) =>
          !(
            p.state === "omitted" &&
            p.section === at.section &&
            faces.has(p.seed)
          ),
      )
      .map((p) => (selected.includes(p) ? { ...p, state: "excluded" } : p));
  }
  // not picked → picked (an omitted face of a picked surface is taken back)
  return ofSurface ? rest : [...rest, added("selected", false)];
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
