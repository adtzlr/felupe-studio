export const APP_NAME = "FElupe Studio";

/** The repository of the app, its documentation and its issues. */
export const REPOSITORY = "https://github.com/adtzlr/felupe-studio";
export const LINKS = {
  guide: `${REPOSITORY}/blob/main/docs/guide.md`,
  reference: `${REPOSITORY}/blob/main/docs/reference.md`,
  issues: `${REPOSITORY}/issues/new`,
  license: `${REPOSITORY}/blob/main/LICENSE`,
  felupe: "https://felupe.readthedocs.io",
};

/** Return the version string shown in the UI. */
export function formatVersion(version: string, commit?: string): string {
  return commit ? `${version} (${commit.slice(0, 7)})` : version;
}
