// The brand of the build (#321, ADR 0020): a folder with a brand.json, given with
// BRAND_DIR (`BRAND_DIR=~/my-brand npm run build`, also `npm run dev`), else the
// default brand app/brand, which is FElupe Studio itself. The JSON schema
// brand.schema.json validates it, and an invalid brand fails the build.
//
// The plugin writes the brand into index.html: the title, the accent color and the
// brand as a JSON block, the one source of the brand in the app (src/brand.ts). The
// samples of a brand are the folder of its `samples` (#350). This module runs in
// Node (the config of Vite), not in the app.
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import Ajv2020 from "ajv/dist/2020";
import type { Plugin } from "vite";
import type { Brand } from "../brand";
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
  return value as Brand;
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
  const brand = readBrand(dir);
  const samples = env.SAMPLES_DIR
    ? resolve(home(env.SAMPLES_DIR))
    : brand.samples
      ? resolve(dir, brand.samples)
      : null;
  return { dir, brand, samples };
}

/**
 * The brand of the pages: without what only the build reads (the folder of the
 * samples and the schema of the file).
 */
export function pageBrand(value: Brand): Brand {
  const page = { ...value } as Brand & { $schema?: string };
  delete page.$schema;
  delete page.samples;
  return page;
}

const escapeHtml = (text: string) =>
  text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** The color of a text on the accent color: dark on a light one, else light. */
export function onAccent(accent: string): string {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const c = parseInt(accent.slice(i, i + 2), 16) / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return luminance > 0.18 ? "#0b1220" : "#ffffff";
}

/**
 * The CSS of the accent color of a brand: the variables of the theme, with a higher
 * specificity than those of the stylesheet, which comes later in the page.
 */
export function accentCss(accent: string): string {
  return (
    `:root:root { --color-accent: ${accent}; ` +
    `--color-accent-hover: color-mix(in srgb, ${accent} 85%, white); ` +
    `--color-accent-soft: color-mix(in srgb, ${accent} 18%, transparent); ` +
    `--color-on-accent: ${onAccent(accent)}; }`
  );
}

/** The plugin of Vite: the brand in the pages of the app. */
export function brand(value: Brand): Plugin {
  // the brand as JSON in a script block, safe in HTML
  const json = JSON.stringify(pageBrand(value)).replace(/</g, "\\u003c");
  return {
    name: "brand",
    transformIndexHtml: {
      order: "pre",
      handler(html, context) {
        const page = context.filename.endsWith("index.html")
          ? html.replace(
              /<title>[^<]*<\/title>/,
              `<title>${escapeHtml(value.name)}</title>`,
            )
          : html;
        return {
          html: page,
          tags: [
            {
              tag: "script",
              attrs: { type: "application/json", id: "brand" },
              children: json,
              injectTo: "head",
            },
            ...(value.accent
              ? [
                  {
                    tag: "style",
                    attrs: { id: "brand-accent" },
                    children: accentCss(value.accent),
                    injectTo: "head" as const,
                  },
                ]
              : []),
          ],
        };
      },
    },
  };
}
