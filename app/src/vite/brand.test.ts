import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import commands from "../../../python/felupe_studio/commands.schema.json";
import type { Brand } from "../brand";
import { THEME_COLORS, themeScript } from "../core/theme";
import {
  accentCss,
  brand,
  brandAccents,
  BrandError,
  brandOptions,
  contrast,
  lightAccent,
  manifest,
  onAccent,
  pngSize,
  readBrand,
  softAlpha,
} from "./brand";
import schema from "./brand.schema.json";
import { readSamples } from "./samples";

const APP = resolve(__dirname, "../..");
const REPOSITORY = "https://github.com/adtzlr/felupe-studio";

const LOGO = readFileSync(join(APP, "brand", "logo.svg"));
const ICON = readFileSync(join(APP, "brand", "icon-192.png"));

/** A brand folder with a brand.json, a logo and other files. */
function folder(value: unknown, files: Record<string, Buffer | string> = {}) {
  const dir = mkdtempSync(join(tmpdir(), "brand-"));
  writeFileSync(
    join(dir, "brand.json"),
    typeof value === "string" ? value : JSON.stringify(value),
  );
  for (const [name, data] of Object.entries({ "logo.svg": LOGO, ...files }))
    writeFileSync(join(dir, name), data);
  return dir;
}

const acme: Brand = {
  brand_version: 1,
  name: "ACME FEM",
  short_name: "ACME",
  logo: "logo.svg",
  storage: "acme",
  accent: "#ffcc00",
  links: {
    help: "https://fem.acme.example/help",
    issues: "mailto:fem@acme.example",
    source: "https://gitlab.acme.example/fem/brand",
  },
};

describe("the default brand (ADR 0020)", () => {
  it("is FElupe Studio with the values of today", () => {
    const options = brandOptions({}, APP);
    expect(options.dir).toBe(join(APP, "brand"));
    expect(options.brand).toMatchObject({
      name: "FElupe Studio",
      short_name: "FElupe Studio",
      links: {
        help: `${REPOSITORY}/blob/main/docs/guide.md`,
        documentation: `${REPOSITORY}/blob/main/docs/reference.md`,
        issues: `${REPOSITORY}/issues/new`,
        source: REPOSITORY,
      },
    });
    // the accent color of the theme, the names of the storage of today and the
    // samples of upstream
    expect(options.brand.accent).toBeUndefined();
    expect(options.brand.storage).toBe("felupe-studio");
    expect(options.samples).toBe(join(APP, "samples"));
  });

  it("takes the samples of SAMPLES_DIR (#350)", () => {
    expect(brandOptions({ SAMPLES_DIR: "/my/samples" }, APP).samples).toBe(
      "/my/samples",
    );
  });
});

describe("a brand folder (ADR 0020)", () => {
  it("has the example brand of upstream as a valid brand", () => {
    // brands/example, which CI builds and checks in a browser (ADR 0020)
    const dir = resolve(APP, "../brands/example");
    const options = brandOptions({ BRAND_DIR: dir }, APP);
    expect(options.brand).toMatchObject({
      name: "Example Lab FEM",
      storage: "example-lab",
      pyodide: "self-hosted",
    });
    expect(readSamples(options.samples!).map((s) => s.id)).toEqual([
      "rubber-pad",
      "rubber-strip",
    ]);
  });

  it("is BRAND_DIR, with its samples or none", () => {
    const dir = folder({ ...acme, samples: "samples" });
    const options = brandOptions({ BRAND_DIR: dir }, APP);
    expect(options.brand.name).toBe("ACME FEM");
    expect(options.samples).toBe(join(dir, "samples"));
    const none = folder(acme);
    expect(brandOptions({ BRAND_DIR: none }, APP).samples).toBeNull();
  });

  it("says what BRAND_DIR is if it has no brand.json (#379)", () => {
    const empty = mkdtempSync(join(tmpdir(), "brand-"));
    const fails = () => brandOptions({ BRAND_DIR: join(empty, "brand") }, APP);
    expect(fails).toThrow(BrandError);
    expect(fails).toThrow(
      `The brand of ${join(empty, "brand")}: it has no brand.json. BRAND_DIR ` +
        "is the folder that holds the brand.json of the brand. The CI files of " +
        "a brand set it from BRAND_FOLDER, the folder of brand.json in the " +
        'repository of the brand ("." for its root).',
    );
  });

  it("is the root of a repository with BRAND_FOLDER '.' (#379)", () => {
    // the CI files of a brand: BRAND_DIR=<repository>/<BRAND_FOLDER>
    const dir = folder({ ...acme, samples: "samples" });
    const options = brandOptions({ BRAND_DIR: `${dir}/.` }, APP);
    expect(options.dir).toBe(dir);
    expect(options.brand.name).toBe("ACME FEM");
    expect(options.samples).toBe(join(dir, "samples"));
  });

  it("is the whole configuration of a deployment", () => {
    expect(() =>
      brandOptions({ BRAND_DIR: folder(acme), SAMPLES_DIR: "/my" }, APP),
    ).toThrow("SAMPLES_DIR is not used with BRAND_DIR");
  });

  it("fails the build with a clear message", () => {
    const empty = mkdtempSync(join(tmpdir(), "brand-"));
    expect(() => readBrand(empty)).toThrow(BrandError);
    expect(() => readBrand(empty)).toThrow(`The brand of ${empty}: it has no`);
    expect(() => readBrand(folder("{name"))).toThrow("is not valid JSON");
    expect(() => readBrand(folder({ ...acme, brand_version: 2 }))).toThrow(
      "brand.json has brand_version 2, but this version of FElupe Studio reads 1.",
    );
    // a brand inherits no identity: the links of FElupe Studio are not defaults
    const links: Partial<Brand["links"]> = { ...acme.links };
    delete links.source;
    expect(() => readBrand(folder({ ...acme, links }))).toThrow(
      "/links: must have required property 'source'",
    );
    expect(() => readBrand(folder({ ...acme, theme: "dark" }))).toThrow(
      "must NOT have additional properties",
    );
    expect(() => readBrand(folder({ ...acme, accent: "yellow" }))).toThrow(
      "/accent: must match pattern",
    );
    expect(() => readBrand(folder({ ...acme, storage: "ACME FEM" }))).toThrow(
      "/storage: must match pattern",
    );
    const noStorage: Partial<Brand> = { ...acme };
    delete noStorage.storage;
    expect(() => readBrand(folder(noStorage))).toThrow(
      "must have required property 'storage'",
    );
    expect(() =>
      readBrand(
        folder({ ...acme, links: { ...acme.links, help: "javascript:x" } }),
      ),
    ).toThrow("/links/help: must match pattern");
    expect(() => readBrand(folder({ ...acme, pyodide: "local" }))).toThrow(
      "/pyodide: must be equal to one of the allowed values",
    );
  });

  it("has the units of the model settings", () => {
    const units = commands.$defs.ModelSettings.properties.units.properties;
    const defaults = schema.properties.defaults.properties.units.properties;
    expect(defaults.length.enum).toEqual(units.length.enum);
    expect(defaults.force.enum).toEqual(units.force.enum);
    const brand = readBrand(
      folder({ ...acme, defaults: { units: { length: "m", force: "kN" } } }),
    );
    expect(brand.defaults?.units).toEqual({ length: "m", force: "kN" });
  });
});

describe("the plugin of the brand", () => {
  const transform = (value: Brand, filename = "/app/index.html") => {
    const hook = brand({ dir: "/acme", brand: value }).transformIndexHtml as {
      handler: (
        html: string,
        context: { filename: string },
      ) => {
        html: string;
        tags: { tag: string; attrs: object; children: string }[];
      };
    };
    return hook.handler(
      "<html><head><title>FElupe Studio</title></head></html>",
      { filename },
    );
  };

  it("writes the brand into the page", () => {
    const { html, tags } = transform({ ...acme, name: "ACME <FEM> & Co" });
    expect(html).toContain("<title>ACME &lt;FEM&gt; &amp; Co</title>");
    const block = tags.find((t) => t.tag === "script")!;
    expect(block.attrs).toEqual({ type: "application/json", id: "brand" });
    // safe in HTML: no end of the script in the JSON
    expect(block.children).not.toContain("<");
    expect(JSON.parse(block.children).name).toBe("ACME <FEM> & Co");
    // what only the build reads stays out of the page
    const withSamples = { ...acme, samples: "samples", $schema: "x" };
    const page = JSON.parse(transform(withSamples).tags[0].children);
    expect(page).not.toHaveProperty("samples");
    expect(page).not.toHaveProperty("$schema");
    // the app loads Pyodide from where the brand says
    const selfHosted = { ...acme, pyodide: "self-hosted" as const };
    expect(JSON.parse(transform(selfHosted).tags[0].children).pyodide).toBe(
      "self-hosted",
    );
    const style = tags.find((t) => t.tag === "style")!;
    expect(style.children).toContain("--color-accent: #ffcc00;");
    expect(style.children).toContain("--color-on-accent: #0b1220;");
    // the benchmark keeps its title
    expect(transform(acme, "/app/spike.html").html).toContain(
      "<title>FElupe Studio</title>",
    );
  });

  it("sets the theme before the first paint (#375)", () => {
    const { tags } = transform(acme);
    const script = tags.find(
      (t) => t.tag === "script" && "id" in t.attrs && t.attrs.id === "theme",
    )!;
    expect(script.attrs).toEqual({ id: "theme" });
    // the stored choice with the storage prefix of the brand
    expect(script.children).toContain('localStorage.getItem("acme.theme")');
    expect(script.children).toBe(themeScript("acme.theme"));
    // after the theme color, which it sets too
    const names = tags.map((t) => ("name" in t.attrs ? t.attrs.name : t.tag));
    expect(names.indexOf("theme-color")).toBeLessThan(tags.indexOf(script));
    // the accent of the brand in the dark theme, a darker one in the light theme
    const style = tags.find((t) => t.tag === "style")!.children.split("\n");
    expect(style).toHaveLength(2);
    expect(style[0]).toMatch(/^:root:root:not\(\[data-theme="light"\]\) \{/);
    expect(style[0]).toContain("--color-accent: #ffcc00;");
    expect(style[1]).toMatch(/^:root:root\[data-theme="light"\] \{/);
    expect(style[1]).toContain(`--color-accent: ${lightAccent("#ffcc00")};`);
  });

  it("starts in the theme of the brand (#375)", () => {
    const light = { ...acme, defaults: { theme: "light" as const } };
    const { tags } = transform(light);
    const script = tags.find(
      (t) => t.tag === "script" && "id" in t.attrs && t.attrs.id === "theme",
    )!;
    expect(script.children).toBe(themeScript("acme.theme", "light"));
    // the theme color of the page and the manifest in the light theme
    const meta = tags.find((t) => t.tag === "meta")!;
    expect(meta.attrs).toEqual({ name: "theme-color", content: "#e9ecf1" });
    expect(manifest(light)).toMatchObject({
      theme_color: THEME_COLORS.light.bar,
      background_color: THEME_COLORS.light.background,
    });
    // dark for System, as a manifest has one theme color
    const system = { ...acme, defaults: { theme: "system" as const } };
    expect(manifest(system)).toMatchObject({ theme_color: "#171a21" });
    expect(() =>
      readBrand(folder({ ...acme, defaults: { theme: "sepia" } })),
    ).toThrow("/defaults/theme: must be equal to one of the allowed values");
  });

  it("darkens the accent of a brand for the light theme (#375)", () => {
    // a light accent: the first darker shade with 4.5:1 on the light surfaces
    for (const accent of ["#ffcc00", "#f08c3a", "#5aa9ff", "#22c55e"]) {
      const light = lightAccent(accent);
      expect(contrast(light, "#d5e3f6")).toBeGreaterThanOrEqual(4.5);
      expect(contrast(light, accent)).toBeGreaterThan(1);
    }
    // a dark one as it is
    expect(lightAccent("#0b3d91")).toBe("#0b3d91");
    // accent_light instead, or only in the light theme
    expect(brandAccents({ ...acme, accent_light: "#7a5c00" })).toEqual({
      dark: "#ffcc00",
      light: "#7a5c00",
    });
    expect(
      brandAccents({ ...acme, accent: undefined, accent_light: "#7a5c00" }),
    ).toEqual({ light: "#7a5c00" });
    expect(brandAccents({ ...acme, accent: undefined })).toEqual({});
    expect(() =>
      readBrand(folder({ ...acme, accent_light: "dark yellow" })),
    ).toThrow("/accent_light: must match pattern");
  });

  it("keeps the colors of the theme without an accent", () => {
    const { tags } = transform({ ...acme, accent: undefined });
    expect(tags.some((t) => t.tag === "style")).toBe(false);
  });

  it("writes readable text on the accent color", () => {
    expect(onAccent("#ffcc00")).toBe("#0b1220");
    expect(onAccent("#5aa9ff")).toBe("#0b1220");
    expect(onAccent("#0b3d91")).toBe("#ffffff");
    expect(accentCss("#0b3d91")).toContain(
      "--color-accent-soft: rgba(11, 61, 145, 0.18);",
    );
    // hovered lighter in the dark theme, darker in the light one
    expect(accentCss("#0b3d91")).toContain("--color-accent-hover: #305aa2;");
    expect(accentCss("#0b3d91", "light")).toContain(
      "--color-accent-hover: #09347b;",
    );
    // a tint no darker (light) or lighter (dark) than that of FElupe Studio, so the
    // text on a selected line keeps its contrast
    expect(accentCss("#0b3d91", "light")).toContain(
      "--color-accent-soft: rgba(11, 61, 145, 0.1);",
    );
    expect(softAlpha("#0b60c4", "light")).toBe(0.12);
    expect(softAlpha("#5aa9ff", "dark")).toBe(0.18);
    expect(softAlpha("#ffcc00", "dark")).toBeLessThan(0.18);
    expect(softAlpha("#000000", "light")).toBeLessThan(0.12);
  });

  it("links the logo, the icons and the manifest", () => {
    const { tags } = transform({
      ...acme,
      icons: { "192": "a.png", "512": "b.png" },
    });
    const links = tags
      .filter((t) => t.tag === "link")
      .map((t) => t.attrs as { rel: string; href: string });
    expect(links).toEqual([
      { rel: "icon", href: "brand/logo.svg", type: "image/svg+xml" },
      { rel: "apple-touch-icon", href: "brand/icon-192.png" },
      { rel: "manifest", href: "manifest.webmanifest" },
    ]);
    // the page knows the URL of the logo, not the files of the brand folder
    const page = JSON.parse(tags[0].children);
    expect(page.logo).toBe("brand/logo.svg");
    expect(page).not.toHaveProperty("icons");
    // without icons, no icon for the home screen
    const plain = transform(acme).tags.filter((t) => t.tag === "link");
    expect(plain.map((t) => (t.attrs as { rel: string }).rel)).toEqual([
      "icon",
      "manifest",
    ]);
  });

  it("copies the logo and the icons and writes the manifest", () => {
    const icons = { "192": "icon-192.png", "512": "icon-512.png" };
    const dir = folder(
      { ...acme, icons },
      {
        "icon-192.png": ICON,
        "icon-512.png": readFileSync(join(APP, "brand", "icon-512.png")),
      },
    );
    const value = readBrand(dir);
    const plugin = brand({ dir, brand: value });
    const emitted: { fileName: string; source: unknown }[] = [];
    (plugin.generateBundle as (this: unknown) => void).call({
      emitFile: (file: { fileName: string; source: unknown }) =>
        emitted.push(file),
    });
    expect(emitted.map((f) => f.fileName)).toEqual([
      "brand/logo.svg",
      "brand/icon-192.png",
      "brand/icon-512.png",
      "manifest.webmanifest",
    ]);
    expect(JSON.parse(String(emitted.at(-1)!.source))).toEqual({
      name: "ACME FEM",
      short_name: "ACME",
      start_url: ".",
      scope: ".",
      display: "standalone",
      background_color: "#1b1f27",
      theme_color: "#171a21",
      icons: [
        { src: "brand/logo.svg", sizes: "any", type: "image/svg+xml" },
        { src: "brand/icon-192.png", sizes: "192x192", type: "image/png" },
        { src: "brand/icon-512.png", sizes: "512x512", type: "image/png" },
      ],
    });
    expect(manifest(acme)).toHaveProperty("icons", [
      { src: "brand/logo.svg", sizes: "any", type: "image/svg+xml" },
    ]);
  });

  it("checks the logo and the icons", () => {
    expect(() => readBrand(folder({ ...acme, logo: "missing.svg" }))).toThrow(
      "it has no logo missing.svg.",
    );
    expect(() =>
      readBrand(
        folder({ ...acme, logo: "logo.svg" }, { "logo.svg": "<html>" }),
      ),
    ).toThrow("the logo logo.svg is no SVG.");
    const icons = { "192": "small.png", "512": "large.png" };
    expect(() => readBrand(folder({ ...acme, icons }))).toThrow(
      "it has no icon small.png.",
    );
    expect(() =>
      readBrand(
        folder({ ...acme, icons }, { "small.png": ICON, "large.png": ICON }),
      ),
    ).toThrow("the icon large.png has 192 × 192 px instead of 512 × 512 px.");
    expect(() =>
      readBrand(
        folder({ ...acme, icons }, { "small.png": LOGO, "large.png": ICON }),
      ),
    ).toThrow("the icon small.png is no PNG.");
    expect(pngSize(ICON)).toEqual([192, 192]);
  });
});
