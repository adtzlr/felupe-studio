export const APP_NAME = "FElupe Studio";

/** Return the version string shown in the UI. */
export function formatVersion(version: string, commit?: string): string {
  return commit ? `${version} (${commit.slice(0, 7)})` : version;
}
