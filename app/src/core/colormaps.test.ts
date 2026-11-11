import { describe, expect, it } from "vitest";
import { COLOR_MAPS, colorMap, colorOf, lookupTable } from "./colormaps";

const at = (table: Uint8Array, i: number) => [
  ...table.subarray(3 * i, 3 * i + 3),
];

describe("color maps (#139)", () => {
  it("have tables of 256 colors from the start to the end of the map", () => {
    for (const { id } of COLOR_MAPS) {
      const table = lookupTable(id);
      expect(table).toHaveLength(768);
      expect(at(table, 0)).toEqual(colorOf(id, 0));
      expect(at(table, 255)).toEqual(colorOf(id, 1));
    }
    // turbo like the viewer: dark blue to dark red; viridis: purple to yellow
    expect(colorOf("turbo", 0)).toEqual([35, 23, 27]);
    // viridis by a polynomial fit, close to the colors of matplotlib
    const close = (a: number[], b: number[]) =>
      a.every((x, k) => Math.abs(x - b[k]) <= 4);
    expect(close(colorOf("viridis", 0), [68, 1, 84])).toBe(true);
    expect(close(colorOf("viridis", 0.5), [33, 145, 140])).toBe(true);
    expect(close(colorOf("viridis", 1), [253, 231, 37])).toBe(true);
    expect(colorOf("coolwarm", 0.5)).toEqual([221, 221, 221]);
    expect(colorOf("grayscale", 0)).toEqual([235, 235, 235]);
    expect(colorMap("coolwarm").diverging).toBe(true);
  });

  it("have the outside color at their ends", () => {
    const outside = colorMap("viridis").outside;
    const table = lookupTable("viridis", { outside: true });
    expect(at(table, 0)).toEqual(outside);
    expect(at(table, 255)).toEqual(outside);
    expect(at(table, 1)).toEqual(colorOf("viridis", 0));
    expect(at(table, 254)).toEqual(colorOf("viridis", 1));
  });

  it("are in bands, with outside bands at the ends", () => {
    const banded = lookupTable("turbo", { bands: 6, outside: true });
    const outside = colorMap("turbo").outside;
    // 8 bands of 32 entries: the first and the last are outside
    expect(at(banded, 0)).toEqual(outside);
    expect(at(banded, 31)).toEqual(outside);
    expect(at(banded, 32)).toEqual(colorOf("turbo", 0.5 / 6));
    expect(at(banded, 63)).toEqual(colorOf("turbo", 0.5 / 6));
    expect(at(banded, 224)).toEqual(outside);
    const plain = lookupTable("turbo", { bands: 4 });
    expect(at(plain, 0)).toEqual(colorOf("turbo", 0.125));
    expect(at(plain, 255)).toEqual(colorOf("turbo", 0.875));
  });
});
