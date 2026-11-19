import { type Brand, currentBrand, UPSTREAM } from "./brand";

function required(): Brand {
  const found = currentBrand();
  if (!found) throw new Error("The app has no brand (ADR 0020).");
  return found;
}

/** The brand of the app (ADR 0020). */
export const BRAND: Brand = required();

/** The brand is FElupe Studio itself, not a brand based on it. */
export const IS_UPSTREAM = BRAND.name === UPSTREAM;

/** The name of the app: that of its brand. */
export const APP_NAME = BRAND.name;

/**
 * The upstream project: its repository, its license and FElupe. They are the
 * identity of FElupe Studio, the same in every brand (ADR 0020).
 */
export const REPOSITORY = "https://github.com/adtzlr/felupe-studio";

/** The links of the app: those of its brand, and of the upstream project. */
export const LINKS = {
  guide: BRAND.links.help,
  tutorial: BRAND.links.tutorial,
  reference: BRAND.links.documentation,
  issues: BRAND.links.issues,
  source: BRAND.links.source,
  license: `${REPOSITORY}/blob/main/LICENSE`,
  felupe: "https://felupe.readthedocs.io",
};

/** Return the version string shown in the UI. */
export function formatVersion(version: string, commit?: string): string {
  return commit ? `${version} (${commit.slice(0, 7)})` : version;
}
