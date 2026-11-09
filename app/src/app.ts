export const APP_NAME = "FElupe Studio";

/** Render the placeholder start screen into the given root element. */
export function renderStart(root: HTMLElement, version: string): void {
  const heading = document.createElement("h1");
  heading.textContent = APP_NAME;

  const info = document.createElement("p");
  info.textContent = `Version ${version} – work in progress.`;

  root.replaceChildren(heading, info);
}

/** Return the version string shown in the UI. */
export function formatVersion(version: string, commit?: string): string {
  return commit ? `${version} (${commit.slice(0, 7)})` : version;
}
