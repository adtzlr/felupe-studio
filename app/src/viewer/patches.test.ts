import { describe, expect, it } from "vitest";
import type { SectionFaces } from "./facesets";
import {
  combine,
  faceState,
  type Patch,
  type PatchClick,
  patchCounts,
  pickPatch,
} from "./patches";
import { describeSurface, FEATURE_ANGLE } from "./surfaces";
import { box, tube } from "./surfaces.fixture";

// the faces of the box: 1 and 5 on top (z = 1), 2 and 6 in front (y = 0), 0 and 4
// at the bottom, 3 and 7 at the back, 8 and 9 at the ends (x = 0, x = 2)
const TOP = [1, 5];
const FRONT = [2, 6];

const LEFT: PatchClick = { shift: false };
const RIGHT: PatchClick = { shift: false, right: true };
const SHIFT: PatchClick = { shift: true };
const SHIFT_RIGHT: PatchClick = { shift: true, right: true };

function clicks(
  sections: ReadonlyMap<string, SectionFaces>,
  angle = FEATURE_ANGLE,
) {
  let patches: Patch[] = [];
  const click = (face: number, how: PatchClick, section = "body") => {
    patches = pickPatch(patches, { section, face }, how, sections, angle);
    return combine(patches, sections, angle);
  };
  return { click, patches: () => patches };
}

describe("patches of picked surfaces (#195)", () => {
  const of = box();
  const sections = new Map([["body", of]]);
  const nodes = [Float64Array.from(of.faces.flatMap((f) => [...f.nodes]))];

  it("are added by left clicks", () => {
    const { click, patches } = clicks(sections);
    expect(click(1, LEFT).faces.get("body")).toEqual(TOP);
    // a click on the same patch changes nothing
    expect(click(5, LEFT).faces.get("body")).toEqual(TOP);
    expect(click(2, LEFT).faces.get("body")).toEqual([...FRONT, ...TOP].sort());
    expect(patchCounts(patches())).toEqual({ selected: 2, excluded: 0 });
    // the edge between the top and the front once: 6 + 6 - 3 nodes
    const combined = combine(patches(), sections, FEATURE_ANGLE);
    const surface = describeSurface(
      [{ of, faces: combined.faces.get("body")! }],
      nodes,
    );
    expect(surface.kind).toBe("surface");
    expect(surface.nodes).toHaveLength(3 * 9);
  });

  it("are deselected by a right click and excluded by a second one", () => {
    const { click, patches } = clicks(sections);
    click(1, LEFT);
    click(2, LEFT);
    // deselected
    let combined = click(6, RIGHT);
    expect(combined.faces.get("body")).toEqual(TOP);
    expect(combined.excluded.size).toBe(0);
    // excluded: the top without the points of the edge, but with its faces
    combined = click(6, RIGHT);
    expect(combined.faces.get("body")).toEqual(TOP);
    expect(combined.excluded.get("body")).toEqual(FRONT);
    expect(faceState(combined, { section: "body", face: 2 })).toBe("excluded");
    expect(patchCounts(patches())).toEqual({ selected: 1, excluded: 1 });
    const surface = describeSurface(
      [{ of, faces: combined.faces.get("body")! }],
      nodes,
      [{ of, faces: combined.excluded.get("body")! }],
    );
    expect(surface).toMatchObject({ kind: "plane", exactPoints: false });
    expect(surface.nodes).toHaveLength(3 * 3);
    // a third right click removes the exclusion, a left click selects it again
    expect(click(2, RIGHT).excluded.size).toBe(0);
    click(2, RIGHT);
    combined = click(2, LEFT);
    expect(combined.excluded.size).toBe(0);
    expect(combined.faces.get("body")).toEqual([...FRONT, ...TOP].sort());
  });

  it("exclude faces that are not selected", () => {
    const { click } = clicks(sections);
    const combined = click(2, RIGHT);
    expect(combined.faces.size).toBe(0);
    expect(combined.excluded.get("body")).toEqual(FRONT);
    // excluded patches have priority: the excluded front stays excluded
    expect(click(8, LEFT).excluded.get("body")).toEqual(FRONT);
  });

  it("add, omit and exclude single faces with Shift", () => {
    const { click } = clicks(sections);
    // a single face, removed again
    expect(click(1, SHIFT).faces.get("body")).toEqual([1]);
    expect(click(1, SHIFT).faces.size).toBe(0);
    // a face of a selected patch is omitted, and back
    click(1, LEFT);
    expect(click(5, SHIFT).faces.get("body")).toEqual([1]);
    expect(click(5, SHIFT).faces.get("body")).toEqual(TOP);
    // omitted, then selected again by a left click
    click(5, SHIFT);
    expect(click(5, LEFT).faces.get("body")).toEqual(TOP);
    // a single excluded face, removed with Shift+right-click
    let combined = click(6, SHIFT_RIGHT);
    expect(combined.excluded.get("body")).toEqual([6]);
    combined = click(6, SHIFT_RIGHT);
    expect(combined.excluded.size).toBe(0);
    // a single face of a selected patch excluded: its points are removed
    combined = click(5, SHIFT_RIGHT);
    expect(combined.faces.get("body")).toEqual([1]);
    expect(combined.excluded.get("body")).toEqual([5]);
  });

  it("follow the feature angle with their states", () => {
    const { of: tubeOf, inner } = tube(6);
    const tubes = new Map([["body", tubeOf]]);
    let patches: Patch[] = [];
    patches = pickPatch(
      patches,
      { section: "body", face: inner[0] },
      LEFT,
      tubes,
      30,
    );
    // 60° between the segments: a strip at 30°, the whole inner surface at 60°
    expect(combine(patches, tubes, 30).faces.get("body")).toEqual(
      inner.slice(0, 2),
    );
    expect(combine(patches, tubes, 60).faces.get("body")).toEqual(inner);
    patches = pickPatch(
      patches,
      { section: "body", face: inner[4] },
      RIGHT,
      tubes,
      30,
    );
    // the excluded strip is a part of the selected surface at 60°: removed
    const combined = combine(patches, tubes, 60);
    expect(combined.excluded.get("body")).toEqual(inner);
    expect(combined.faces.size).toBe(0);
  });

  it("belong to their sections", () => {
    const other = { ...box(), section: "other" } as SectionFaces;
    const two = new Map([
      ["body", of],
      ["other", other],
    ]);
    const { click, patches } = clicks(two);
    click(1, LEFT);
    let combined = click(1, LEFT, "other");
    expect([...combined.faces.keys()]).toEqual(["body", "other"]);
    // a right click deselects the patch of its section only
    combined = click(1, RIGHT, "other");
    expect([...combined.faces.keys()]).toEqual(["body"]);
    // patches of sections or faces that are gone are skipped
    expect(combine(patches(), new Map(), FEATURE_ANGLE).faces.size).toBe(0);
    const gone: Patch = { section: "body", seed: 99, state: "selected" };
    expect(combine([gone], two, FEATURE_ANGLE).faces.size).toBe(0);
  });
});
