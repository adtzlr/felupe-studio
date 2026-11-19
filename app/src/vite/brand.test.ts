import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import commands from "../../../python/felupe_studio/commands.schema.json";
import type { Brand } from "../brand";
import {
  accentCss,
  brand,
  BrandError,
  brandOptions,
  onAccent,
  readBrand,
} from "./brand";
import schema from "./brand.schema.json";

const APP = resolve(__dirname, "../..");
const REPOSITORY = "https://github.com/adtzlr/felupe-studio";

/** A brand folder with a brand.json. */
function folder(value: unknown): string {
  const dir = mkdtempSync(join(tmpdir(), "brand-"));
  writeFileSync(
    join(dir, "brand.json"),
    typeof value === "string" ? value : JSON.stringify(value),
  );
  return dir;
}

const acme: Brand = {
  brand_version: 1,
  name: "ACME FEM",
  short_name: "ACME",
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
    // the accent color of the theme and the samples of upstream
    expect(options.brand.accent).toBeUndefined();
    expect(options.samples).toBe(join(APP, "samples"));
  });

  it("takes the samples of SAMPLES_DIR (#350)", () => {
    expect(brandOptions({ SAMPLES_DIR: "/my/samples" }, APP).samples).toBe(
      "/my/samples",
    );
  });
});

describe("a brand folder (ADR 0020)", () => {
  it("is BRAND_DIR, with its samples or none", () => {
    const dir = folder({ ...acme, samples: "samples" });
    const options = brandOptions({ BRAND_DIR: dir }, APP);
    expect(options.brand.name).toBe("ACME FEM");
    expect(options.samples).toBe(join(dir, "samples"));
    const none = folder(acme);
    expect(brandOptions({ BRAND_DIR: none }, APP).samples).toBeNull();
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
    expect(() =>
      readBrand(
        folder({ ...acme, links: { ...acme.links, help: "javascript:x" } }),
      ),
    ).toThrow("/links/help: must match pattern");
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
    const hook = brand(value).transformIndexHtml as {
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
    const style = tags.find((t) => t.tag === "style")!;
    expect(style.children).toContain("--color-accent: #ffcc00;");
    expect(style.children).toContain("--color-on-accent: #0b1220;");
    // the benchmark keeps its title
    expect(transform(acme, "/app/spike.html").html).toContain(
      "<title>FElupe Studio</title>",
    );
  });

  it("keeps the colors of the theme without an accent", () => {
    const { tags } = transform({ ...acme, accent: undefined });
    expect(tags.map((t) => t.tag)).toEqual(["script"]);
  });

  it("writes readable text on the accent color", () => {
    expect(onAccent("#ffcc00")).toBe("#0b1220");
    expect(onAccent("#5aa9ff")).toBe("#0b1220");
    expect(onAccent("#0b3d91")).toBe("#ffffff");
    expect(accentCss("#0b3d91")).toContain(
      "--color-accent-soft: color-mix(in srgb, #0b3d91 18%, transparent);",
    );
  });
});
