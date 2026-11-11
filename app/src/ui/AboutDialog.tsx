// Help ▸ About (#126): the versions of the app and of the Python packages, the load
// time, the license and the links of the project.
import { APP_NAME, formatVersion, LINKS, REPOSITORY } from "../app";
import { Dialog } from "./Dialog";
import type { Runtime } from "./hooks";

interface Props {
  runtime: Runtime;
  onClose: () => void;
}

/** The version of a wheel of the app, e.g. "5.3.5" of "wheels/meshio-5.3.5-py3…". */
export function wheelVersion(
  name: string,
  wheels: string[] = [...__WHEELS__, ...Object.values(__LAZY_WHEELS__)],
): string | undefined {
  for (const wheel of wheels) {
    const file = wheel.split("/").pop() ?? "";
    const [package_, version] = file.split("-");
    if (package_ === name) return version;
  }
  return undefined;
}

export function AboutDialog({ runtime, onClose }: Props) {
  const ready = runtime.state === "ready" ? runtime.ready : undefined;
  const rows: [string, string | undefined][] = [
    ["FElupe", ready?.versions.felupe ?? __FELUPE_VERSION__],
    ["Python", ready?.versions.python],
    ["Pyodide", ready?.versions.pyodide ?? __PYODIDE_VERSION__],
    ["NumPy", ready?.versions.numpy],
    ["SciPy", ready?.versions.scipy],
    ["meshio", wheelVersion("meshio")],
    ["tensortrax", wheelVersion("tensortrax")],
  ];
  return (
    <Dialog
      title={APP_NAME}
      subtitle={`Version ${formatVersion(__APP_VERSION__)}`}
      onClose={onClose}
    >
      <div class="about">
        <p>
          A clickable GUI for FElupe that runs entirely in the browser. Every
          object of a model is a FElupe object; nothing is uploaded.
        </p>
        <dl class="summary" aria-label="Versions">
          {rows.map(([name, version]) => (
            <>
              <dt>{name}</dt>
              <dd>{version ?? "…"}</dd>
            </>
          ))}
          <dt>Load time</dt>
          <dd>
            {runtime.state === "ready"
              ? `${runtime.seconds.toFixed(1)} s`
              : runtime.state === "loading"
                ? "Python is loading …"
                : "Python could not be loaded"}
          </dd>
        </dl>
        <p class="muted">
          Licensed under{" "}
          <a href={LINKS.license} target="_blank" rel="noopener">
            GPL-3.0-or-later
          </a>
          , like FElupe.
        </p>
        <ul class="about-links">
          <li>
            <a href={REPOSITORY} target="_blank" rel="noopener">
              Source code
            </a>
          </li>
          <li>
            <a href={LINKS.felupe} target="_blank" rel="noopener">
              FElupe documentation
            </a>
          </li>
          <li>
            <a href="./spike.html" target="_blank" rel="noopener">
              Pyodide benchmark
            </a>
          </li>
        </ul>
      </div>
    </Dialog>
  );
}
