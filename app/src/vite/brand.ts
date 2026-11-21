// The brand of the build (#321, ADR 0020): a folder with a brand.json, given with
// BRAND_DIR (`BRAND_DIR=~/my-brand npm run build`, also `npm run dev`), else the
// default brand app/brand, which is FElupe Studio itself. The JSON schema
// brand.schema.json validates it, and an invalid brand fails the build.
//
// The plugin writes the brand into index.html: the title, the accent colors of the
// themes, the theme before the first paint and the brand as a JSON block, the one
// source of the brand in the app (src/brand.ts). The samples of a brand are the
// folder of its `samples` (#350). This module runs in Node (the config of Vite), not
// in the app.
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import Ajv2020 from "ajv/dist/2020";
import type { Plugin } from "vite";
import type { Brand } from "../brand";
import {
  DEFAULT_THEME,
  type Theme,
  THEME_COLORS,
  THEME_KEY,
  themeScript,
} from "../core/theme";
import schema from "./brand.schema.json";

export const BRAND_FILE = "brand.json";
/** The version of the schema of brand.json that this build reads. */
export const BRAND_VERSION = 1;

/** A brand breaks the rules; the message says how. */
export class BrandError extends Error {}

const home = (path: string) => path.replace(/^~(?=$|[\\/])/, homedir());

let validator: ReturnType<Ajv2020["compile"]> | undefined;

/** The messages of the schema of brand.json for a brand (empty if valid). */
export function brandErrors(value: unknown): string[] {
  validator ??= new Ajv2020({ allErrors: true }).compile(schema);
  if (validator(value)) return [];
  return (validator.errors ?? []).map(
    (e) => `${e.instancePath || "(brand)"}: ${e.message ?? "is invalid"}`,
  );
}

/** The brand of a folder, checked. Throws a `BrandError` with a clear message. */
export function readBrand(dir: string): Brand {
  const path = join(dir, BRAND_FILE);
  const fail = (message: string): never => {
    throw new BrandError(`The brand of ${dir}: ${message}`);
  };
  if (!existsSync(path)) fail(`it has no ${BRAND_FILE}.`);
  let value: unknown;
  try {
    value = JSON.parse(readFileSync(path, "utf-8"));
  } catch (error) {
    fail(`${BRAND_FILE} is not valid JSON: ${(error as Error).message}.`);
  }
  const version = (value as { brand_version?: unknown } | null)?.brand_version;
  if (typeof version === "number" && version !== BRAND_VERSION)
    fail(
      `${BRAND_FILE} has brand_version ${version}, but this version of ` +
        `FElupe Studio reads ${BRAND_VERSION}.`,
    );
  const errors = brandErrors(value);
  if (errors.length) fail(`${BRAND_FILE} is invalid: ${errors.join("; ")}.`);
  checkFiles(dir, value as Brand, fail);
  return value as Brand;
}

/** The width and the height of a PNG (of its header), or undefined if it is none. */
export function pngSize(data: Buffer): [number, number] | undefined {
  const signature = "89504e470d0a1a0a";
  if (data.length < 24 || data.subarray(0, 8).toString("hex") !== signature)
    return undefined;
  return [data.readUInt32BE(16), data.readUInt32BE(20)];
}

/** The files of a brand, checked: its logo (SVG) and its icons (PNG). */
function checkFiles(
  dir: string,
  value: Brand,
  fail: (message: string) => never,
): void {
  const logo = join(dir, value.logo);
  if (!existsSync(logo)) fail(`it has no logo ${value.logo}.`);
  if (!/<svg[\s>]/.test(readFileSync(logo, "utf-8").slice(0, 4096)))
    fail(`the logo ${value.logo} is no SVG.`);
  for (const [size, file] of Object.entries(value.icons ?? {})) {
    const path = join(dir, file);
    if (!existsSync(path)) fail(`it has no icon ${file}.`);
    const found = pngSize(readFileSync(path));
    if (!found) return fail(`the icon ${file} is no PNG.`);
    if (found[0] !== Number(size) || found[1] !== Number(size))
      fail(
        `the icon ${file} has ${found[0]} × ${found[1]} px instead of ` +
          `${size} × ${size} px.`,
      );
  }
}

/** The brand of a build and the folder of its samples. */
export interface BrandOptions {
  dir: string;
  brand: Brand;
  /** The folder of the samples: of SAMPLES_DIR, of the brand, or none. */
  samples: string | null;
}

/**
 * The brand of a build from the environment: BRAND_DIR, else `brand/` of the app
 * (`root`). SAMPLES_DIR beside BRAND_DIR is an error, so the brand folder is the
 * whole configuration of a deployment; with the default brand it sets the samples.
 */
export function brandOptions(
  env: Record<string, string | undefined>,
  root: string,
): BrandOptions {
  if (env.BRAND_DIR && env.SAMPLES_DIR)
    throw new BrandError(
      "SAMPLES_DIR is not used with BRAND_DIR: the samples of a brand are the " +
        `folder of its ${BRAND_FILE} (samples).`,
    );
  const dir = env.BRAND_DIR
    ? resolve(home(env.BRAND_DIR))
    : resolve(root, "brand");
  // the folder of another brand without brand.json, e.g. a wrong BRAND_FOLDER (#379)
  if (env.BRAND_DIR && !existsSync(join(dir, BRAND_FILE)))
    throw new BrandError(
      `The brand of ${dir}: it has no ${BRAND_FILE}. BRAND_DIR is the folder ` +
        `that holds the ${BRAND_FILE} of the brand. The CI files of a brand set ` +
        `it from BRAND_FOLDER, the folder of ${BRAND_FILE} in the repository ` +
        `of the brand ("." for its root).`,
    );
  const brand = readBrand(dir);
  const samples = env.SAMPLES_DIR
    ? resolve(home(env.SAMPLES_DIR))
    : brand.samples
      ? resolve(dir, brand.samples)
      : null;
  return { dir, brand, samples };
}

/** The folder of the files of the brand in the build: its logo and its icons. */
export const BRAND_FOLDER = "brand";
/** The manifest of the app, for an installed app. */
export const MANIFEST = "manifest.webmanifest";
/**
 * The theme of the manifest and of the theme color of the page before its script
 * runs: of the default of the brand (#375), dark for System, as a manifest has one.
 */
const manifestTheme = (value: Brand): Theme =>
  (value.defaults?.theme ?? DEFAULT_THEME) === "light" ? "light" : "dark";

/** The files that the build copies: their names in the build and their paths. */
export function brandFiles(dir: string, value: Brand): [string, string][] {
  return [
    [`${BRAND_FOLDER}/logo.svg`, join(dir, value.logo)],
    ...Object.entries(value.icons ?? {}).map(
      ([size, file]): [string, string] => [
        `${BRAND_FOLDER}/icon-${size}.png`,
        join(dir, file),
      ],
    ),
  ];
}

/**
 * The manifest of the app of a brand: its names, its icons and the colors of its
 * default theme.
 */
export function manifest(value: Brand): object {
  const colors = THEME_COLORS[manifestTheme(value)];
  return {
    name: value.name,
    short_name: value.short_name,
    start_url: ".",
    scope: ".",
    display: "standalone",
    background_color: colors.background,
    theme_color: colors.bar,
    icons: [
      { src: `${BRAND_FOLDER}/logo.svg`, sizes: "any", type: "image/svg+xml" },
      ...Object.keys(value.icons ?? {}).map((size) => ({
        src: `${BRAND_FOLDER}/icon-${size}.png`,
        sizes: `${size}x${size}`,
        type: "image/png",
      })),
    ],
  };
}

/**
 * The brand of the pages: without what only the build reads (the folder of the
 * samples, the icons and the schema of the file), with the URL of its logo.
 */
export function pageBrand(value: Brand): Brand {
  const page = { ...value } as Brand & { $schema?: string };
  delete page.$schema;
  delete page.samples;
  delete page.icons;
  page.logo = `${BRAND_FOLDER}/logo.svg`;
  return page;
}

const escapeHtml = (text: string) =>
  text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

type Rgb = [number, number, number];

/** The channels of a color `#rrggbb`. */
const channels = (color: string): Rgb =>
  [1, 3, 5].map((i) => parseInt(color.slice(i, i + 2), 16)) as Rgb;

/** A color `#rrggbb` of channels. */
const hex = (rgb: Rgb): string =>
  `#${rgb.map((c) => Math.round(c).toString(16).padStart(2, "0")).join("")}`;

/** A part `t` of the way from one color to another, like `color-mix()` in sRGB. */
const mix = (from: Rgb, to: Rgb, t: number): Rgb =>
  from.map((c, i) => c + (to[i] - c) * t) as Rgb;

/** The relative luminance of a color `#rrggbb` (WCAG 2). */
function luminance(color: string): number {
  const [r, g, b] = channels(color).map((c) => {
    const s = c / 255;
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** The contrast ratio of two colors `#rrggbb` (WCAG 2). */
export function contrast(a: string, b: string): number {
  const [high, low] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (high + 0.05) / (low + 0.05);
}

/** The color of a text on the accent color: dark on a light one, else light. */
export function onAccent(accent: string): string {
  return luminance(accent) > 0.18 ? "#0b1220" : "#ffffff";
}

/**
 * The darkest surface of the light theme with text in the accent color, the token
 * `--color-selected` of shell.css (`tokens.test.ts` checks the accents of brands on
 * every surface).
 */
const LIGHT_SURFACE = "#d5e3f6";

/**
 * The accent of the light theme from the accent of a brand (#375): the accent itself
 * or, if it is too light, the first darker shade (towards black) with a contrast of
 * 4.5:1 on the light surfaces, e.g. a dark orange of an orange.
 */
export function lightAccent(accent: string): string {
  const rgb = channels(accent);
  for (let step = 0; step <= 50; step++) {
    const shade = hex(mix(rgb, [0, 0, 0], step / 50));
    if (contrast(shade, LIGHT_SURFACE) >= 4.5) return shade;
  }
  return "#000000";
}

/**
 * The accents of FElupe Studio and the alphas of their soft tints, the tokens of
 * shell.css (`tokens.test.ts`).
 */
export const UPSTREAM_ACCENTS: Readonly<
  Record<Theme, { readonly accent: string; readonly soft: number }>
> = {
  dark: { accent: "#5aa9ff", soft: 0.18 },
  light: { accent: "#0b60c4", soft: 0.12 },
};

/**
 * The alpha of the soft tint of an accent, e.g. of a selected line: that of FElupe
 * Studio, or less, so the tint on the bar is no lighter in the dark theme and no
 * darker in the light one than that of FElupe Studio, and the text on it keeps its
 * contrast, also with a very light or a very dark accent.
 */
export function softAlpha(accent: string, theme: Theme): number {
  const bar = THEME_COLORS[theme].bar;
  // how much a tint lightens the bar (dark) or darkens it (light)
  const sign = theme === "dark" ? -1 : 1;
  const shift = (color: string, alpha: number) =>
    sign *
    (luminance(bar) -
      luminance(hex(mix(channels(bar), channels(color), alpha))));
  const upstream = UPSTREAM_ACCENTS[theme];
  const limit = shift(upstream.accent, upstream.soft);
  let percent = Math.round(upstream.soft * 100);
  while (percent > 2 && shift(accent, percent / 100) > limit) percent--;
  return percent / 100;
}

/**
 * The variables of the accent color of a brand in a theme, as colors: hovered
 * lighter in the dark theme and darker in the light one, and a soft tint.
 */
export function accentTokens(
  accent: string,
  theme: Theme,
): Record<string, string> {
  const rgb = channels(accent);
  const dark = theme === "dark";
  const hover = mix(rgb, dark ? [255, 255, 255] : [0, 0, 0], 0.15);
  return {
    "--color-accent": accent,
    "--color-accent-hover": hex(hover),
    "--color-accent-soft": `rgba(${rgb.join(", ")}, ${softAlpha(accent, theme)})`,
    "--color-on-accent": onAccent(accent),
  };
}

/**
 * The CSS of the accent color of a brand in a theme, with a higher specificity than
 * the tokens of the stylesheet, which comes later in the page.
 */
export function accentCss(accent: string, theme: Theme = "dark"): string {
  const selector =
    theme === "dark"
      ? ':root:root:not([data-theme="light"])'
      : ':root:root[data-theme="light"]';
  const tokens = Object.entries(accentTokens(accent, theme))
    .map(([name, color]) => `${name}: ${color};`)
    .join(" ");
  return `${selector} { ${tokens} }`;
}

/**
 * The accents of a brand per theme: `accent` in the dark theme, `accent_light` in the
 * light one, else a darker shade of `accent` (`lightAccent()`). A theme without one
 * keeps the accent of FElupe Studio.
 */
export function brandAccents(value: Brand): Partial<Record<Theme, string>> {
  const light =
    value.accent_light ?? (value.accent && lightAccent(value.accent));
  return {
    ...(value.accent ? { dark: value.accent } : {}),
    ...(light ? { light } : {}),
  };
}

/** The tags of the brand in the head of a page. */
function headTags(value: Brand) {
  // the brand as JSON in a script block, safe in HTML
  const json = JSON.stringify(pageBrand(value)).replace(/</g, "\\u003c");
  const link = (rel: string, href: string, type?: string) => ({
    tag: "link",
    attrs: { rel, href, ...(type ? { type } : {}) },
    injectTo: "head" as const,
  });
  const accents = Object.entries(brandAccents(value)) as [Theme, string][];
  return [
    {
      tag: "script",
      attrs: { type: "application/json", id: "brand" },
      children: json,
      injectTo: "head" as const,
    },
    link("icon", `${BRAND_FOLDER}/logo.svg`, "image/svg+xml"),
    ...(value.icons
      ? [link("apple-touch-icon", `${BRAND_FOLDER}/icon-192.png`)]
      : []),
    link("manifest", MANIFEST),
    {
      tag: "meta",
      attrs: {
        name: "theme-color",
        content: THEME_COLORS[manifestTheme(value)].bar,
      },
      injectTo: "head" as const,
    },
    // the theme of the stored choice, else of the brand, before the first paint,
    // and the theme color above (#375)
    {
      tag: "script",
      attrs: { id: "theme" },
      children: themeScript(
        `${value.storage}.${THEME_KEY}`,
        value.defaults?.theme ?? DEFAULT_THEME,
      ),
      injectTo: "head" as const,
    },
    ...(accents.length
      ? [
          {
            tag: "style",
            attrs: { id: "brand-accent" },
            children: accents
              .map(([theme, accent]) => accentCss(accent, theme))
              .join("\n"),
            injectTo: "head" as const,
          },
        ]
      : []),
  ];
}

const TYPES: Record<string, string> = {
  svg: "image/svg+xml",
  png: "image/png",
  webmanifest: "application/manifest+json",
};

/**
 * The plugin of Vite: the brand in the pages of the app, its logo and its icons in
 * `brand/` and the manifest, in the build and in dev.
 */
export function brand({
  dir,
  brand: value,
}: Pick<BrandOptions, "dir" | "brand">): Plugin {
  const files = brandFiles(dir, value);
  const manifestText = JSON.stringify(manifest(value), null, 2) + "\n";
  return {
    name: "brand",
    transformIndexHtml: {
      // after Vite: the links of the brand are files of the build, not of the source
      order: "post",
      handler(html, context) {
        const page = context.filename.endsWith("index.html")
          ? html.replace(
              /<title>[^<]*<\/title>/,
              `<title>${escapeHtml(value.name)}</title>`,
            )
          : html;
        return { html: page, tags: headTags(value) };
      },
    },
    generateBundle() {
      for (const [fileName, path] of files)
        this.emitFile({ type: "asset", fileName, source: readFileSync(path) });
      this.emitFile({
        type: "asset",
        fileName: MANIFEST,
        source: manifestText,
      });
    },
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        const path = decodeURIComponent((request.url ?? "").split("?")[0]);
        const name = path.replace(
          /^.*?\/(?=(brand\/|manifest\.webmanifest$))/,
          "",
        );
        const file = files.find(([fileName]) => fileName === name);
        if (!file && name !== MANIFEST) return next();
        const extension = name.split(".").pop() ?? "";
        if (TYPES[extension])
          response.setHeader("Content-Type", TYPES[extension]);
        response.end(file ? readFileSync(file[1]) : manifestText);
      });
    },
  };
}
