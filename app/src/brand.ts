// The brand of the app (#321, ADR 0020): its name, its links, its welcome text and
// its defaults. The build writes it into index.html as a JSON block, the one source
// of the brand in the app; without a page (the tests in Node), the brand of the
// build (`__BRAND__`). The default brand is FElupe Studio itself (app/brand).
//
// The identity of FElupe Studio is no brand: the upstream project, its license and
// the header of the generated script are constants of the code (app.ts).

export interface Brand {
  brand_version: 1;
  name: string;
  short_name: string;
  /** The logo (SVG): in brand.json relative to the brand folder, in the page its URL. */
  logo: string;
  /** The icons of the manifest (PNG of 192 and 512 px); the build copies them. */
  icons?: { "192": string; "512": string };
  /** The prefix of the browser storage, e.g. `felupe-studio` (see storageKey). */
  storage: string;
  /** The accent color, `#rrggbb` (the build sets the variables of the theme). */
  accent?: string;
  /** The text below the title of the welcome panel. */
  welcome?: string;
  links: {
    help: string;
    documentation?: string;
    tutorial?: string;
    issues: string;
    source: string;
  };
  /** The folder of the samples, relative to the brand folder (the build reads it). */
  samples?: string;
  defaults?: {
    /** The units of the model settings of a new model (#132). */
    units?: { length: "mm" | "m"; force: "N" | "kN" };
  };
}

/** The name of the upstream project, which a brand is based on. */
export const UPSTREAM = "FElupe Studio";

/**
 * The brand of the page (its JSON block), else of the build; undefined where
 * neither is, e.g. in the config of Vite.
 */
export function currentBrand(): Brand | undefined {
  const block =
    typeof document === "undefined" ? null : document.getElementById("brand");
  if (block?.textContent) return JSON.parse(block.textContent) as Brand;
  return typeof __BRAND__ === "object" ? __BRAND__ : undefined;
}

/** The name of the app: of its brand, else of FElupe Studio (the config of Vite). */
export const appName = (): string => currentBrand()?.name ?? UPSTREAM;

/** The storage prefix of FElupe Studio, with the names of the storage of today. */
export const UPSTREAM_STORAGE = "felupe-studio";

/**
 * The prefix of the browser storage of the app (ADR 0020): of its brand, so that two
 * brands on one origin keep their data apart.
 */
export const storagePrefix = (): string =>
  currentBrand()?.storage ?? UPSTREAM_STORAGE;

/** A key of localStorage or sessionStorage, e.g. `felupe-studio.curve`. */
export const storageKey = (name: string): string =>
  `${storagePrefix()}.${name}`;

/**
 * The folder of the bytecode cache in IndexedDB (ADR 0017): `/pycache` of FElupe
 * Studio, `/<prefix>-pycache` of another brand.
 */
export function bytecodeCache(prefix = storagePrefix()): string {
  return prefix === UPSTREAM_STORAGE ? "/pycache" : `/${prefix}-pycache`;
}
