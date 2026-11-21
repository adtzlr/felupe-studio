import { describe, expect, it } from "vitest";
import { lookupTable } from "./colormaps";
import type { ResultExtreme, ResultScene } from "../worker/protocol";
import {
  contourLook,
  contourRange,
  DEFAULT_CONTOUR,
  jobRangeOf,
  loadContour,
  manualRange,
  methodOf,
  otherSectionsOf,
  rangeNote,
  rangeSectionsOf,
  saveContour,
  sectionValues,
} from "./contour";

/** A storage in memory, like localStorage. */
function memory(): Storage {
  const items = new Map<string, string>();
  return {
    getItem: (k) => items.get(k) ?? null,
    setItem: (k, v) => void items.set(k, v),
    removeItem: (k) => void items.delete(k),
    clear: () => items.clear(),
    key: (i) => [...items.keys()][i] ?? null,
    get length() {
      return items.size;
    },
  };
}

describe("contour settings (#139)", () => {
  it("take the range of the substep, of the job or a manual one", () => {
    const substep = [0, 2] as const;
    const job = [0, 5] as const;
    expect(contourRange(DEFAULT_CONTOUR, substep, job)).toEqual([0, 2]);
    const all = { ...DEFAULT_CONTOUR, range: "job" as const };
    expect(contourRange(all, substep, job)).toEqual([0, 5]);
    // the range of the job is loaded later
    expect(contourRange(all, substep)).toEqual([0, 2]);
    const manual = {
      ...DEFAULT_CONTOUR,
      range: "manual" as const,
      min: 1,
      max: 3,
    };
    expect(contourRange(manual, substep, job)).toEqual([1, 3]);
    // an invalid manual range is not used
    expect(manualRange({ ...manual, min: 3 })).toBeUndefined();
    expect(contourRange({ ...manual, min: 3 }, substep)).toEqual([0, 2]);
  });

  it("center a diverging map at zero for signed values", () => {
    const coolwarm = { ...DEFAULT_CONTOUR, map: "coolwarm" as const };
    expect(contourRange(coolwarm, [-1, 3])).toEqual([-3, 3]);
    expect(contourRange(coolwarm, [-4, 3])).toEqual([-4, 4]);
    expect(contourRange(coolwarm, [1, 3])).toEqual([1, 3]);
    expect(contourRange(DEFAULT_CONTOUR, [-1, 3])).toEqual([-1, 3]);
  });

  it("draw values outside of the range in an extra color", () => {
    const inside = contourLook(DEFAULT_CONTOUR, [0, 10], [0, 10]);
    expect(inside).toMatchObject({
      bands: 0,
      range: [0, 10],
      below: false,
      above: false,
    });
    expect(inside.lut).toEqual(lookupTable("turbo"));

    // continuous: one entry at both ends, the range extended by one entry
    const manual = {
      ...DEFAULT_CONTOUR,
      range: "manual" as const,
      min: 0,
      max: 254,
    };
    const look = contourLook(manual, [0, 254], [-5, 100]);
    expect(look).toMatchObject({
      bands: 0,
      range: [-1, 255],
      shown: [0, 254],
      below: true,
      above: false,
    });
    expect(look.lut).toEqual(lookupTable("turbo", { outside: true }));

    // in bands: one band at both ends
    const banded = contourLook({ ...manual, bands: 10 }, [0, 10], [0, 12]);
    expect(banded).toMatchObject({
      bands: 12,
      range: [-1, 11],
      mapBands: 10,
      above: true,
    });
    expect(banded.lut).toEqual(
      lookupTable("turbo", { bands: 10, outside: true }),
    );

    // a uniform range has no outside
    expect(contourLook(DEFAULT_CONTOUR, [1, 1], [1, 1])).toMatchObject({
      below: false,
      above: false,
    });
  });

  it("are kept in the browser", () => {
    const storage = memory();
    expect(loadContour(storage)).toEqual(DEFAULT_CONTOUR);
    const settings = {
      map: "viridis" as const,
      bands: 8,
      range: "manual" as const,
      min: -1,
      max: 2,
      values: "project" as const,
      others: "color" as const,
      othersColor: "#336699",
    };
    saveContour(settings, storage);
    expect(loadContour(storage)).toEqual(settings);
    // unknown values fall back to the defaults
    storage.setItem(
      "felupe-studio.contour",
      '{"map": "jet", "bands": 7, "range": "x", "values": "nodes", "others": "x", "othersColor": "gray"}',
    );
    expect(loadContour(storage)).toEqual(DEFAULT_CONTOUR);
    // the settings of earlier versions: the values at the cells (#231) and the
    // contour of the other sections (#396)
    storage.setItem("felupe-studio.contour", '{"map": "viridis"}');
    expect(loadContour(storage)).toEqual({
      ...DEFAULT_CONTOUR,
      map: "viridis",
    });
    storage.setItem("felupe-studio.contour", "{");
    expect(loadContour(storage)).toEqual(DEFAULT_CONTOUR);
  });

  it("of the displacements do not depend on the method (#231)", () => {
    const settings = { ...DEFAULT_CONTOUR, values: "project" as const };
    expect(methodOf("displacement_x", settings)).toBe("cells");
    expect(methodOf("stress_mises", settings)).toBe("project");
  });
});

/** An extreme of a section with a value. */
const extreme = (section: string, value: number): ResultExtreme => ({
  value,
  section,
  at: "cell",
  index: 0,
  surface: true,
  position: [0, 0, 0],
  displacement: [0, 0, 0],
});

/** A scene of a soft and a steel section and air without finite values. */
const scene: ResultScene = {
  label: "Von Mises",
  at: "cell",
  range: [0.2, 13],
  extremes: { min: extreme("rubber", 0.2), max: extreme("steel", 13) },
  sections: {
    rubber: {
      range: [0.2, 6],
      extremes: { min: extreme("rubber", 0.2), max: extreme("rubber", 6) },
    },
    steel: {
      range: [0.3, 13],
      extremes: { min: extreme("steel", 0.3), max: extreme("steel", 13) },
    },
    air: { range: null, extremes: null },
  },
  surfaces: [],
};

describe("the range of chosen sections (#377)", () => {
  const sections = ["rubber", "steel", "air"];

  it("chooses the sections of the results, in their order", () => {
    expect(rangeSectionsOf(DEFAULT_CONTOUR, undefined, sections)).toEqual([]);
    expect(rangeSectionsOf(DEFAULT_CONTOUR, [], sections)).toEqual([]);
    expect(
      rangeSectionsOf(DEFAULT_CONTOUR, ["steel", "rubber"], sections),
    ).toEqual(["rubber", "steel"]);
    // a removed or renamed section leaves the choice, none left is all sections
    expect(
      rangeSectionsOf(DEFAULT_CONTOUR, ["glass", "rubber"], sections),
    ).toEqual(["rubber"]);
    expect(rangeSectionsOf(DEFAULT_CONTOUR, ["glass"], sections)).toEqual([]);
    // all of them are all sections; a manual range does not need them
    expect(rangeSectionsOf(DEFAULT_CONTOUR, sections, sections)).toEqual([]);
    const manual = { ...DEFAULT_CONTOUR, range: "manual" as const };
    expect(rangeSectionsOf(manual, ["rubber"], sections)).toEqual([]);
    const job = { ...DEFAULT_CONTOUR, range: "job" as const };
    expect(rangeSectionsOf(job, ["rubber"], sections)).toEqual(["rubber"]);
  });

  it("takes the range and the extremes of the chosen sections", () => {
    expect(sectionValues(scene, [])).toEqual({
      range: scene.range,
      extremes: scene.extremes,
    });
    const rubber = sectionValues(scene, ["rubber"]);
    expect(rubber.range).toEqual([0.2, 6]);
    expect(rubber.extremes?.max).toEqual(extreme("rubber", 6));
    const both = sectionValues(scene, ["rubber", "air"]);
    expect(both.range).toEqual([0.2, 6]);
    const steel = sectionValues(scene, ["rubber", "steel"]);
    expect(steel.range).toEqual([0.2, 13]);
    expect(steel.extremes).toEqual({
      min: extreme("rubber", 0.2),
      max: extreme("steel", 13),
    });
    // a section without finite values has no range
    expect(sectionValues(scene, ["air"])).toEqual({
      range: null,
      extremes: null,
    });
    // a scene without sections, e.g. of an older runtime, has those of all
    const older = { ...scene, sections: undefined };
    expect(sectionValues(older, ["rubber"]).range).toEqual([0.2, 13]);
  });

  it("draws the other sections outside of the range in the outside color", () => {
    const own = sectionValues(scene, ["rubber"]).range!;
    const look = contourLook(
      DEFAULT_CONTOUR,
      contourRange(DEFAULT_CONTOUR, own),
      scene.range!,
    );
    expect(look.shown).toEqual([0.2, 6]);
    expect(look).toMatchObject({ below: false, above: true });
    // a diverging map is still centered at zero
    const diverging = { ...DEFAULT_CONTOUR, map: "coolwarm" as const };
    expect(contourRange(diverging, [-2, 6])).toEqual([-6, 6]);
  });

  it("takes the range of all substeps of the chosen sections", () => {
    const ranges = {
      range: [[0, 2], null, [0, 13]] as ([number, number] | null)[],
      sections: {
        rubber: [[0, 1], null, [0, 6]] as ([number, number] | null)[],
        steel: [[0, 2], null, [0, 13]] as ([number, number] | null)[],
      },
    };
    expect(jobRangeOf(ranges, [])).toEqual([0, 13]);
    expect(jobRangeOf(ranges, ["rubber"])).toEqual([0, 6]);
    // a section that is not in the ranges: none, the range of the substep instead
    expect(jobRangeOf(ranges, ["glass"])).toBeUndefined();
    expect(jobRangeOf({ range: [null], sections: {} }, [])).toBeUndefined();
  });

  it("names the sections at the scalar bar", () => {
    expect(rangeNote([])).toBeUndefined();
    expect(rangeNote(["rubber"])).toBe("Range: rubber");
    expect(rangeNote(["a", "b", "c"])).toBe("Range: a, b, c");
    expect(rangeNote(["a", "b", "c", "d", "e"])).toBe(
      "Range: a, b and 3 more sections",
    );
  });
});

describe("the other sections of chosen sections (#396)", () => {
  const sections = ["rubber", "steel", "air"];
  const color = { ...DEFAULT_CONTOUR, others: "color" as const };
  const hidden = { ...DEFAULT_CONTOUR, others: "hidden" as const };

  it("keep their contour by default and with all sections", () => {
    expect(DEFAULT_CONTOUR.others).toBe("contour");
    expect(otherSectionsOf(DEFAULT_CONTOUR, ["rubber"], sections)).toBe(
      undefined,
    );
    expect(otherSectionsOf(color, [], sections)).toBe(undefined);
    expect(otherSectionsOf(hidden, [], sections)).toBe(undefined);
  });

  it("are drawn in one color, semi-transparent with Grayscale, or hidden", () => {
    expect(otherSectionsOf(color, ["rubber"], sections)).toEqual({
      names: ["steel", "air"],
      mode: "color",
      opacity: 1,
    });
    expect(
      otherSectionsOf(
        { ...color, othersColor: "#336699" },
        ["rubber", "air"],
        sections,
      ),
    ).toEqual({
      names: ["steel"],
      mode: "color",
      color: "#336699",
      opacity: 1,
    });
    // a gray of the map of grays would look like a value
    const gray = { ...color, map: "grayscale" as const };
    expect(otherSectionsOf(gray, ["rubber"], sections)?.opacity).toBeLessThan(
      1,
    );
    expect(otherSectionsOf(hidden, ["steel"], sections)).toEqual({
      names: ["rubber", "air"],
      mode: "hidden",
      opacity: 1,
    });
    // an invalid own color is the gray of the view
    expect(
      otherSectionsOf({ ...color, othersColor: "gray" }, ["rubber"], sections)
        ?.color,
    ).toBe(undefined);
  });
});
