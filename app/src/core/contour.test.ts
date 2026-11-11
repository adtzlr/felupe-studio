import { describe, expect, it } from "vitest";
import { lookupTable } from "./colormaps";
import {
  contourLook,
  contourRange,
  DEFAULT_CONTOUR,
  loadContour,
  manualRange,
  saveContour,
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
    };
    saveContour(settings, storage);
    expect(loadContour(storage)).toEqual(settings);
    // unknown values fall back to the defaults
    storage.setItem(
      "felupe-studio.contour",
      '{"map": "jet", "bands": 7, "range": "x"}',
    );
    expect(loadContour(storage)).toEqual(DEFAULT_CONTOUR);
    storage.setItem("felupe-studio.contour", "{");
    expect(loadContour(storage)).toEqual(DEFAULT_CONTOUR);
  });
});
