// Import a mesh file: choose or drop the file, see what it contains, and create the
// mesh with its cell sets in one step.
import { useEffect, useState } from "preact/hooks";
import {
  type CellSetMode,
  defaultMode,
  describePlanned,
  meshSize,
  planImport,
  suggestMeshName,
  suggestScale,
} from "../core/importmesh";
import type { MeshFiles } from "../core/meshfiles";
import { fileTags } from "../core/meshinfo";
import type { ModelStore } from "../core/store";
import { unitOf, unitsOf, valueWithUnit } from "../core/units";
import { nameProblem } from "../core/validate";
import { safeName } from "../worker/files";
import type { MeshInfo } from "../worker/protocol";
import { Dialog } from "./Dialog";
import { FilePicker } from "./FilePicker";
import { useMeshFiles } from "./hooks";

interface Props {
  store: ModelStore;
  files: MeshFiles;
  /** A file to import right away, e.g. from a drop or the Open button. */
  initial?: File;
  onClose: () => void;
  onCreated: (name: string) => void;
}

const plural = (n: number, word: string) =>
  `${n.toLocaleString("en")} ${word}${n === 1 ? "" : "s"}`;
const range = (a: number, b: number) =>
  `${+a.toPrecision(4)} … ${+b.toPrecision(4)}`;

function Summary({ info }: { info: MeshInfo }) {
  const solids = info.solids ?? [];
  const min = [0, 1, 2].map((i) =>
    Math.min(...solids.map((s) => s.bounds[0][i])),
  );
  const max = [0, 1, 2].map((i) =>
    Math.max(...solids.map((s) => s.bounds[1][i])),
  );
  return (
    <dl class="summary">
      <dt>Cells</dt>
      <dd>
        {solids.map((s) => plural(s.cells, `${s.cell_type} cell`)).join(", ")} ·{" "}
        {plural(info.points ?? 0, "point")}
      </dd>
      {solids.length > 0 && (
        <>
          <dt>Bounds</dt>
          <dd>
            {["x", "y", "z"]
              .map((axis, i) => `${axis} ${range(min[i], max[i])}`)
              .join(", ")}
          </dd>
        </>
      )}
      {(info.unsupported?.length ?? 0) > 0 && (
        <>
          <dt>Not imported</dt>
          <dd>
            {info
              .unsupported!.map((u) => plural(u.cells, `${u.type} cell`))
              .join(", ")}{" "}
            (FElupe has no region for them)
          </dd>
        </>
      )}
      {(info.ignored?.length ?? 0) > 0 && (
        <>
          <dt>Ignored</dt>
          <dd>
            {info.ignored!.join(", ")} (lower-dimensional cells, e.g. faces)
          </dd>
        </>
      )}
    </dl>
  );
}

export function ImportMeshDialog({
  store,
  files,
  initial,
  onClose,
  onCreated,
}: Props) {
  useMeshFiles(files);
  const [fileName, setFileName] = useState<string | undefined>();
  const [name, setName] = useState("");
  const [mode, setMode] = useState<CellSetMode>({ mode: "all" });
  const [scaleText, setScaleText] = useState("1");
  const [defaultsFor, setDefaultsFor] = useState<string | undefined>();

  const choose = (picked: File[]) => {
    const [first] = picked;
    if (!first) return;
    // show the file right away; reading it may wait for Python
    setFileName(safeName(first.name));
    void files.addFiles([first]);
  };

  useEffect(() => {
    if (initial) choose([initial]);
    // only the file given when the dialog opens
  }, []);

  const file = fileName ? files.get(fileName) : undefined;
  const info = file?.status.state === "ready" ? file.status.info : undefined;

  // defaults once a file is read
  useEffect(() => {
    if (!info || defaultsFor === info.file) return;
    setDefaultsFor(info.file);
    setName(suggestMeshName(info.file, store.commands));
    setMode(defaultMode(info));
    setScaleText("1");
  }, [info, defaultsFor, store.commands]);

  const used = new Set(
    store.commands.flatMap((c) =>
      c.command === "mesh.import" ? [c.file] : [],
    ),
  );
  const unused = files.names.filter(
    (n) => !used.has(n) && files.get(n)?.status.state === "ready",
  );

  const nameError = !name
    ? "Required."
    : (nameProblem(name) ??
      (store.get(name) ? `The name '${name}' is already used.` : undefined));
  // the scale of the coordinates (#135), suggested for a mesh in other units
  const scale = Number(scaleText.trim());
  const scaleError =
    scaleText.trim() === "" || !Number.isFinite(scale)
      ? "A number is required."
      : scale <= 0
        ? "Must be greater than 0."
        : undefined;
  const units = unitsOf(store.commands);
  const size = info ? meshSize(info) : [0, 0, 0];
  const suggestion = suggestScale(size, units);
  const scaled = size.map(
    (x) => +(x * (scaleError ? 1 : scale)).toPrecision(4),
  );
  const planned =
    info && !nameError && !scaleError
      ? planImport(info, name, mode, store.commands, scale)
      : [];
  const plan = planned.length > 0 ? planned : undefined;
  const tags = info ? fileTags(info) : [];

  const submit = (event: Event) => {
    event.preventDefault();
    if (!plan) return;
    store.apply(plan.map((command) => ({ type: "add" as const, command })));
    onCreated(plan[0].name);
  };

  return (
    <Dialog title="Import mesh" subtitle="mesh.import" onClose={onClose}>
      {!fileName ? (
        <div class="import-start">
          <FilePicker
            label="Drop a mesh file here"
            hint="Any format meshio reads, e.g. VTK (.vtu, .vtk), Gmsh (.msh), Abaqus (.inp), XDMF, Medit, Exodus."
            onFiles={choose}
          />
          {unused.length > 0 && (
            <div class="loaded-files">
              <span class="muted">Or use a loaded file:</span>
              {unused.map((n) => (
                <button
                  key={n}
                  type="button"
                  class="link"
                  onClick={() => setFileName(n)}
                >
                  {n}
                </button>
              ))}
            </div>
          )}
          <div class="actions">
            <button type="button" class="button" onClick={onClose}>
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <form
          class="import-form"
          noValidate
          onSubmit={submit}
          aria-label="Import mesh"
        >
          <div class="file-line">
            <strong>{fileName}</strong>
            {file && (
              <span class="muted">{(file.size / 1024).toFixed(0)} KiB</span>
            )}
            <button
              type="button"
              class="link"
              onClick={() => setFileName(undefined)}
            >
              Choose another file
            </button>
          </div>
          {(!file || file.status.state === "reading") && (
            <p class="muted" role="status">
              Reading the file with meshio … The first file waits until Python
              is loaded.
            </p>
          )}
          {file?.status.state === "error" && (
            <p class="field-error" role="alert">
              {file.status.message}
            </p>
          )}
          {info && (
            <>
              <Summary info={info} />
              <div class="form-row-stack">
                <label for="import-name" class="form-label">
                  Name
                </label>
                <input
                  id="import-name"
                  type="text"
                  value={name}
                  autocomplete="off"
                  spellcheck={false}
                  aria-invalid={nameError ? true : undefined}
                  aria-describedby={nameError ? "import-name-error" : undefined}
                  onInput={(event) => setName(event.currentTarget.value)}
                />
                {nameError && (
                  <small id="import-name-error" class="field-error">
                    {nameError}
                  </small>
                )}
              </div>
              <div class="form-row-stack">
                <label for="import-scale" class="form-label">
                  Scale
                </label>
                <input
                  id="import-scale"
                  type="text"
                  inputMode="decimal"
                  value={scaleText}
                  autocomplete="off"
                  spellcheck={false}
                  aria-invalid={scaleError ? true : undefined}
                  aria-describedby="import-scale-hint"
                  onInput={(event) => setScaleText(event.currentTarget.value)}
                />
                {scaleError ? (
                  <small id="import-scale-hint" class="field-error">
                    {scaleError}
                  </small>
                ) : (
                  <small id="import-scale-hint" class="muted">
                    Multiplies the coordinates · size{" "}
                    {valueWithUnit(scaled.join(" × "), unitOf("length", units))}
                  </small>
                )}
                {suggestion && scale !== suggestion.scale && (
                  <p class="scale-suggestion" role="note">
                    {suggestion.reason}{" "}
                    <button
                      type="button"
                      class="link"
                      onClick={() => setScaleText(String(suggestion.scale))}
                    >
                      Scale by {suggestion.scale}
                    </button>
                  </p>
                )}
              </div>
              <fieldset class="choices">
                <legend class="form-label">Cell sets</legend>
                {tags.length > 0 && (
                  <label class="check">
                    <input
                      type="radio"
                      name="cellsets"
                      checked={mode.mode === "tag"}
                      onChange={() =>
                        setMode({ mode: "tag", tag: tags[0].name })
                      }
                    />
                    One per value of the cell tag
                  </label>
                )}
                {mode.mode === "tag" && (
                  <div class="choice-detail">
                    {tags.length > 1 && (
                      <select
                        aria-label="Cell tag"
                        value={mode.tag}
                        onChange={(event) =>
                          setMode({
                            mode: "tag",
                            tag: event.currentTarget.value,
                          })
                        }
                      >
                        {tags.map((t) => (
                          <option key={t.name} value={t.name}>
                            {t.name} ({plural(t.values.length, "value")})
                          </option>
                        ))}
                      </select>
                    )}
                    {tags.length === 1 && <code>{mode.tag}</code>}
                  </div>
                )}
                <label class="check">
                  <input
                    type="radio"
                    name="cellsets"
                    checked={mode.mode === "all"}
                    onChange={() => setMode({ mode: "all" })}
                  />
                  One with all cells
                </label>
                <label class="check">
                  <input
                    type="radio"
                    name="cellsets"
                    checked={mode.mode === "none"}
                    onChange={() => setMode({ mode: "none" })}
                  />
                  None, I create them later
                </label>
              </fieldset>
              {plan && (
                <div class="plan" aria-label="Will be created">
                  <span class="muted">Creates</span>
                  <ul>
                    {plan.map((c) => (
                      <li
                        key={c.name}
                        class={c.command === "mesh.import" ? "" : "nested"}
                      >
                        {c.command === "mesh.import" ? "mesh" : "cell set"}{" "}
                        <strong>{c.name}</strong>{" "}
                        <span class="muted">
                          {describePlanned(c, plan, info)}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </>
          )}
          <div class="actions">
            <button type="submit" class="button primary" disabled={!plan}>
              Import
            </button>
            <button type="button" class="button" onClick={onClose}>
              Cancel
            </button>
          </div>
        </form>
      )}
    </Dialog>
  );
}
