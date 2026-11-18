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

describe("patches of picked surfaces (#195, #260)", () => {
  const of = box();
  const sections = new Map([["body", of]]);
  const nodes = [Float64Array.from(of.faces.flatMap((f) => [...f.nodes]))];

  it("are added by clicks", () => {
    const { click, patches } = clicks(sections);
    expect(click(1, LEFT).faces.get("body")).toEqual(TOP);
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

  it("cycle through picked, excluded and not picked by clicks (#260)", () => {
    const { click, patches } = clicks(sections);
    click(1, LEFT);
    // picked
    let combined = click(2, LEFT);
    expect(combined.faces.get("body")).toEqual([...FRONT, ...TOP].sort());
    // excluded by a second click, on any face of the surface: the top without the
    // points of the edge, but with its faces
    combined = click(6, LEFT);
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
    // not picked by a third click, picked again by a fourth one
    combined = click(2, LEFT);
    expect(combined.excluded.size).toBe(0);
    expect(combined.faces.get("body")).toEqual(TOP);
    expect(patchCounts(patches())).toEqual({ selected: 1, excluded: 0 });
    combined = click(2, LEFT);
    expect(combined.faces.get("body")).toEqual([...FRONT, ...TOP].sort());
  });

  it("are deselected at once by a right click, picked or excluded", () => {
    const { click, patches } = clicks(sections);
    click(1, LEFT);
    click(2, LEFT);
    const combined = click(6, RIGHT);
    expect(combined.faces.get("body")).toEqual(TOP);
    expect(combined.excluded.size).toBe(0);
    // a right click on a face that is not picked changes nothing
    expect(click(6, RIGHT).faces.get("body")).toEqual(TOP);
    expect(patches()).toHaveLength(1);
    // excluded, then deselected at once
    click(5, LEFT);
    expect(click(5, RIGHT)).toEqual({ faces: new Map(), excluded: new Map() });
    expect(patches()).toEqual([]);
  });

  it("exclude faces that are not picked by two clicks", () => {
    const { click } = clicks(sections);
    click(2, LEFT);
    const combined = click(2, LEFT);
    expect(combined.faces.size).toBe(0);
    expect(combined.excluded.get("body")).toEqual(FRONT);
    // excluded patches have priority: the excluded front stays excluded
    expect(click(8, LEFT).excluded.get("body")).toEqual(FRONT);
  });

  it("cycle single faces with Shift, and omit faces of picked surfaces", () => {
    const { click, patches } = clicks(sections);
    // a single face: picked, excluded, not picked
    expect(click(1, SHIFT).faces.get("body")).toEqual([1]);
    let combined = click(1, SHIFT);
    expect(combined.faces.size).toBe(0);
    expect(combined.excluded.get("body")).toEqual([1]);
    combined = click(1, SHIFT);
    expect(combined.excluded.size).toBe(0);
    expect(patches()).toEqual([]);
    // a face of a picked surface is omitted, and back
    click(1, LEFT);
    expect(click(5, SHIFT).faces.get("body")).toEqual([1]);
    expect(click(5, SHIFT).faces.get("body")).toEqual(TOP);
    // omitted, then picked again by a click
    click(5, SHIFT);
    expect(click(5, LEFT).faces.get("body")).toEqual(TOP);
    // omitted, then the surface excluded: the omission is gone with it
    click(5, SHIFT);
    combined = click(1, LEFT);
    expect(combined.excluded.get("body")).toEqual(TOP);
    expect(patches()).toEqual([
      { section: "body", seed: 1, state: "excluded" },
    ]);
    // a single excluded face of an excluded surface: Shift removes the surface's
    // exclusion
    expect(click(5, SHIFT).excluded.size).toBe(0);
  });

  it("deselect single faces with Shift+right-click", () => {
    const { click } = clicks(sections);
    click(6, SHIFT);
    expect(click(6, SHIFT_RIGHT).faces.size).toBe(0);
    // a face of a picked surface is omitted
    click(1, LEFT);
    expect(click(5, SHIFT_RIGHT).faces.get("body")).toEqual([1]);
    expect(click(5, SHIFT_RIGHT).faces.get("body")).toEqual([1]);
    // an excluded single face is removed, and only it
    click(2, LEFT);
    click(2, LEFT);
    click(8, SHIFT);
    click(8, SHIFT);
    const combined = click(8, SHIFT_RIGHT);
    expect(combined.excluded.get("body")).toEqual(FRONT);
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
    // a strip picked and excluded at 30°
    for (let i = 0; i < 2; i++)
      patches = pickPatch(
        patches,
        { section: "body", face: inner[4] },
        LEFT,
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
