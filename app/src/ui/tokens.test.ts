// The styles use the design tokens of the :root block only (#125), with a light
// value of every color in the block of the light theme (#375). The colors of the
// view (`VIEW_COLORS`) are checked against the background of the view of each theme.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { THEME_COLORS } from "../core/theme";
import { VIEW_COLORS } from "../viewer/palette";
import { accentTokens, lightAccent, UPSTREAM_ACCENTS } from "../vite/brand";

// read as a file: CSS modules are empty in the tests
const source = readFileSync(new URL("./shell.css", import.meta.url), "utf-8");
const css = source.replace(/\/\*[\s\S]*?\*\//g, "");

/** A block of tokens: where it is in the stylesheet, and its tokens. */
function block(selector: string) {
  const start = css.indexOf(`${selector} {`);
  const end = css.indexOf("}", start) + 1;
  const tokens = new Map(
    [...css.slice(start, end).matchAll(/(--[\w-]+):\s*([^;]+);/g)].map(
      (m): [string, string] => [m[1], m[2].trim()],
    ),
  );
  return { start, end, tokens };
}

const dark = block(":root");
const light = block(':root[data-theme="light"]');
const rest =
  css.slice(0, dark.start) +
  css.slice(dark.end, light.start) +
  css.slice(light.end);

const defined = new Set(dark.tokens.keys());
const used = new Set([...css.matchAll(/var\((--[\w-]+)\)/g)].map((m) => m[1]));

/** The values of a property outside the token blocks. */
function values(property: string): string[] {
  const pattern = new RegExp(`(?:^|[\\s;{])${property}:\\s*([^;]+);`, "g");
  return [...rest.matchAll(pattern)].map((m) => m[1].trim());
}

const COLOR = /#[0-9a-fA-F]{3,8}\b|\brgba?\(/;

type Rgba = [number, number, number, number];

/** The channels of a color of a token: #rrggbb or rgba(). */
function rgba(value: string): Rgba {
  const hex = /^#([0-9a-f]{6})$/i.exec(value);
  if (hex)
    return [0, 2, 4]
      .map((i) => parseInt(hex[1].slice(i, i + 2), 16))
      .concat(1) as Rgba;
  const parts = /^rgba?\(([^)]*)\)$/.exec(value);
  if (!parts) throw new Error(`no color: ${value}`);
  const [r, g, b, a = 1] = parts[1].split(",").map(Number);
  return [r, g, b, a];
}

/** A color over an opaque one. */
const over = (top: Rgba, below: Rgba): Rgba => [
  ...([0, 1, 2].map((i) => top[i] * top[3] + below[i] * (1 - top[3])) as [
    number,
    number,
    number,
  ]),
  1,
];

/** The relative luminance (WCAG 2). */
function luminance([r, g, b]: Rgba): number {
  const linear = (c: number) => {
    const s = c / 255;
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b);
}

/** The contrast ratio of two opaque colors (WCAG 2). */
function contrast(a: Rgba, b: Rgba): number {
  const [high, low] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (high + 0.05) / (low + 0.05);
}

const THEMES = {
  dark: dark.tokens,
  light: new Map([...dark.tokens, ...light.tokens]),
};

/** The opaque surfaces of the app. */
const SURFACES = [
  "bar",
  "bg",
  "surface-sunken",
  "surface",
  "raised",
  "view",
  "hover",
  "selected",
  "active",
];

/** The contrast of the text and the markers of the tokens of a theme (WCAG AA). */
function expectContrast(tokens: ReadonlyMap<string, string>) {
  const color = (name: string) => rgba(tokens.get(`--color-${name}`)!);
  const pairs: [string, Rgba, string, Rgba][] = [];
  const add = (texts: string[], surfaces: [string, Rgba][]) => {
    for (const text of texts)
      for (const [name, surface] of surfaces)
        pairs.push([text, color(text), name, surface]);
  };
  const opaque = (names: string[]): [string, Rgba][] =>
    names.map((name) => [name, color(name)]);
  // the texts of the app on its surfaces, and over the viewport
  const panel = over(color("overlay"), color("view"));
  add(
    ["text", "text-secondary", "text-muted", "accent", "warning", "error"],
    [...opaque(SURFACES), ["overlay", panel]],
  );
  add(
    ["accent"],
    [["accent-soft", over(color("accent-soft"), color("surface"))]],
  );
  add(["on-accent"], opaque(["accent", "accent-hover"]));
  add(["text", "error"], opaque(["error-surface"]));
  add(["text"], opaque(["info-surface"]));
  // the script view (#130): its lines on the bar, hovered and selected
  const code = [...tokens.keys()]
    .filter((name) => name.startsWith("--color-code-"))
    .map((name) => name.slice("--color-".length));
  expect(code).toHaveLength(6);
  add(
    [...code, "text", "text-muted"],
    [
      ...opaque(["bar", "hover"]),
      ["selected line", over(color("accent-soft"), color("bar"))],
    ],
  );
  const low = pairs
    .map(([text, t, surface, s]) => [text, surface, contrast(t, s)] as const)
    .filter(([, , ratio]) => ratio < 4.5);
  expect(low).toEqual([]);
  // the markers of the minimum and the maximum (#140) on the view, as graphics
  for (const marker of ["min", "max"])
    for (const surface of [color("view"), panel])
      expect(contrast(color(marker), surface)).toBeGreaterThanOrEqual(3);
}

describe("design tokens", () => {
  it("has no colors outside the token blocks", () => {
    expect(rest.length).toBeGreaterThan(10000);
    expect(rest.match(/#[0-9a-fA-F]{3,8}\b/g)).toBeNull();
    expect(rest.match(/\brgba?\(/g)).toBeNull();
  });

  it("uses tokens for type, shapes, depth and stacking", () => {
    for (const v of values("font-size"))
      expect(v).toMatch(/^var\(--text-[\w-]+\)$|em$/);
    for (const v of values("font-weight")) expect(v).toMatch(/^var\(--weight-/);
    for (const v of values("border-radius"))
      expect(v).toMatch(/^var\(--radius-|^50%$/);
    for (const v of values("box-shadow"))
      expect(v).toMatch(/^(var\(--[\w-]+\)|none)$/);
    for (const v of values("z-index")) expect(v).toMatch(/^var\(--z-/);
  });

  it("uses the spacing scale for gaps, margins and paddings", () => {
    const properties = ["gap", "margin", "padding"].flatMap((p) => [
      p,
      ...["top", "right", "bottom", "left"].map((side) => `${p}-${side}`),
    ]);
    // a hairline, a negative offset or a relative length is fine, and so is a
    // safe area of a phone (#378)
    const length =
      /^(0|auto|1px|-\d+px|\d+(vh|vw|%)|var\(--space-\d+\)|var\(--safe-(top|right|bottom|left)\))$/;
    for (const property of properties) {
      for (const value of values(property)) {
        // the parts of the value, split at the spaces outside of parentheses
        const parts = value.match(
          /(?:[^\s(]+|\([^()]*(?:\([^()]*\)[^()]*)*\))+/g,
        );
        for (const part of parts ?? []) {
          // a sum or a maximum of them, e.g. a padding and a safe area
          const combined = /^(?:calc|max)\((.*)\)$/.exec(part);
          for (const term of combined
            ? combined[1].split(/\s*[+,]\s*/)
            : [part])
            expect(term).toMatch(length);
        }
      }
    }
  });

  it("has a light value of every color of the dark theme (#375)", () => {
    const colors = [...dark.tokens]
      .filter(([, value]) => COLOR.test(value))
      .map(([name]) => name);
    expect(colors.length).toBeGreaterThan(30);
    expect([...light.tokens.keys()].sort()).toEqual(colors.sort());
    expect(css.slice(light.start, light.end)).toContain("color-scheme: light;");
  });

  it.each(Object.entries(THEMES))(
    "keeps the contrast of the text in the %s theme (WCAG AA)",
    (_, tokens) => expectContrast(tokens),
  );

  // the accent of a brand in the light theme: as it is, or a darker shade (#375)
  it.each(["#ffcc00", "#f08c3a", "#5aa9ff", "#22c55e", "#0b3d91", "#e66767"])(
    "keeps the contrast of the text with the accent %s of a brand in the light theme",
    (accent) =>
      expectContrast(
        new Map([
          ...THEMES.light,
          ...Object.entries(accentTokens(lightAccent(accent), "light")),
        ]),
      ),
  );

  it.each(Object.entries(THEMES))(
    "has the accent of FElupe Studio for the accents of brands in the %s theme",
    (theme, tokens) => {
      const { accent } = UPSTREAM_ACCENTS[theme as keyof typeof THEMES];
      const brand = accentTokens(accent, theme as keyof typeof THEMES);
      expect(tokens.get("--color-accent")).toBe(accent);
      expect(tokens.get("--color-accent-soft")).toBe(
        brand["--color-accent-soft"],
      );
    },
  );

  it.each(Object.entries(THEMES))(
    "has the theme colors of the page of the %s theme (#375)",
    (theme, tokens) => {
      expect(THEME_COLORS[theme as keyof typeof THEME_COLORS]).toEqual({
        bar: tokens.get("--color-bar"),
        background: tokens.get("--color-bg"),
      });
    },
  );

  it.each(Object.entries(THEMES))(
    "keeps the colors of the view apart from its background in the %s theme (#375)",
    (theme, tokens) => {
      const colors = VIEW_COLORS[theme as keyof typeof VIEW_COLORS];
      const view = rgba(tokens.get("--color-view")!);
      // drawn on the background: at least 3:1, like other graphics (WCAG 1.4.11);
      // the ghost of results is translucent and faint by design
      const drawn = {
        highlight: colors.highlight,
        marker: colors.marker,
        force: colors.force,
        control: colors.control,
        rigid: colors.rigid,
        other: colors.other,
        construction: colors.construction,
        ...colors.extremes,
      };
      const low = Object.entries(drawn)
        .map(([name, value]) => [name, contrast(rgba(value), view)] as const)
        .filter(([, ratio]) => ratio < 3);
      expect(low).toEqual([]);
      // the markers of the extremes in the colors of their labels (#140)
      expect(colors.extremes).toEqual({
        min: tokens.get("--color-min"),
        max: tokens.get("--color-max"),
      });
    },
  );

  it("defines every token that is used, and uses every token", () => {
    const external = [...used].filter((name) => name.startsWith("--fv-"));
    expect([...used].filter((name) => !defined.has(name))).toEqual(external);
    expect([...defined].filter((name) => !used.has(name))).toEqual([]);
  });
});
