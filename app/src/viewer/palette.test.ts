// The colors of the viewer are in its palette (#375), so that the drawing of the
// view follows the theme of the app: no other module of the viewer or of the UI
// has a color of its own.
import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { VIEW_COLORS } from "./palette";

const COLOR = /["'`]#[0-9a-fA-F]{3,8}["'`]|\brgba?\(\s*\d/g;

/** The modules of a folder of the app, without the tests. */
function modules(folder: string): string[] {
  const dir = new URL(`../${folder}/`, import.meta.url);
  return readdirSync(dir)
    .filter((name) => /\.tsx?$/.test(name) && !/\.(test|fixture)\./.test(name))
    .map((name) => `${folder}/${name}`);
}

describe("the palette of the viewer", () => {
  it("has every color of the drawing of the view", () => {
    const found = [...modules("viewer"), ...modules("ui")]
      .filter((path) => path !== "viewer/palette.ts")
      .flatMap((path) => {
        const source = readFileSync(new URL(`../${path}`, import.meta.url), {
          encoding: "utf-8",
        });
        return [...source.matchAll(COLOR)].map((m) => `${path}: ${m[0]}`);
      });
    // the page background of a picture without one (white, as printed)
    expect(found).toEqual(['viewer/snapshot.ts: "#ffffff"']);
  });

  it("has a color of the light theme for every color of the dark one", () => {
    const keys = (theme: keyof typeof VIEW_COLORS) =>
      Object.keys(VIEW_COLORS[theme]).sort();
    expect(keys("light")).toEqual(keys("dark"));
    for (const [name, dark] of Object.entries(VIEW_COLORS.dark)) {
      const light = VIEW_COLORS.light[name as keyof typeof VIEW_COLORS.light];
      expect(light, name).not.toEqual(dark);
    }
  });
});
