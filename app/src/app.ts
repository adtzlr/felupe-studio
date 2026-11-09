export const APP_NAME = "FElupe Studio";

/** Render the placeholder start screen into the given root element. */
export function renderStart(root: HTMLElement, version: string): void {
  const heading = document.createElement("h1");
  heading.textContent = APP_NAME;

  const info = document.createElement("p");
  info.textContent = `Version ${version} – work in progress.`;

  const spike = document.createElement("p");
  const link = document.createElement("a");
  link.href = "./spike.html";
  link.textContent = "Pyodide benchmark";
  spike.append(link);

  root.replaceChildren(heading, info, spike);
}

/** Return the version string shown in the UI. */
export function formatVersion(version: string, commit?: string): string {
  return commit ? `${version} (${commit.slice(0, 7)})` : version;
}

/** Append a status line for the Python runtime and return it. */
export function renderRuntime(root: HTMLElement, text: string): HTMLElement {
  const status = document.createElement("p");
  status.setAttribute("role", "status");
  status.textContent = text;
  root.append(status);
  return status;
}
