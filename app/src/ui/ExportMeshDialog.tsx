// Export a mesh of the project as a file of another format (#230): the name of the
// file and the format, with what reads it. The mesh is the one of the model, e.g.
// the mesh of a script with the values of the parameters; the file has its solid
// cells with their tags, in 3D.
import { useState } from "preact/hooks";
import { projectNameProblem } from "../core/files";
import { MESH_FORMATS, type MeshFormat } from "../worker/protocol";
import { Dialog } from "./Dialog";

export interface MeshExport {
  /** The file name with the extension of the format. */
  name: string;
  format: MeshFormat;
}

interface Props {
  /** The name of the mesh in the model. */
  mesh: string;
  /** The name of the file without its extension, e.g. "bushing-sleeves". */
  stem: string;
  /** The format chosen first, e.g. the one of the last export. */
  format?: MeshFormat;
  /** What the export contains, e.g. "made by bushing.py with 6 parameters". */
  source: string;
  onExport: (choice: MeshExport) => void;
  onClose: () => void;
}

export function ExportMeshDialog({
  mesh,
  stem: initialStem,
  format: initialFormat = "vtu",
  source,
  onExport,
  onClose,
}: Props) {
  const [stem, setStem] = useState(initialStem);
  const [format, setFormat] = useState<MeshFormat>(initialFormat);
  const name = stem.trim();
  const nameError = projectNameProblem(name);

  const submit = (event: Event) => {
    event.preventDefault();
    if (nameError) return;
    onExport({ name: `${name}.${format}`, format });
  };

  return (
    <Dialog title={`Export mesh ${mesh}`} subtitle={source} onClose={onClose}>
      <form class="save-as" onSubmit={submit}>
        <div class="form-row-stack">
          <label for="export-mesh-name" class="form-label">
            Name
          </label>
          <div class="name-with-suffix">
            <input
              id="export-mesh-name"
              type="text"
              value={stem}
              autocomplete="off"
              spellcheck={false}
              aria-invalid={nameError ? true : undefined}
              aria-describedby="export-mesh-name-hint"
              onInput={(event) => setStem(event.currentTarget.value)}
            />
            <span class="muted">.{format}</span>
          </div>
          <small
            id="export-mesh-name-hint"
            class={nameError ? "field-error" : "muted"}
          >
            {nameError ?? `Downloaded as ${name}.${format}`}
          </small>
        </div>
        <fieldset class="choices">
          <legend class="form-label">Format</legend>
          {MESH_FORMATS.map((f) => (
            <label key={f.format} class="check">
              <input
                type="radio"
                name="mesh-format"
                checked={format === f.format}
                onChange={() => setFormat(f.format)}
              />
              <span>
                {f.label}
                <small class="muted">{f.hint}</small>
              </span>
            </label>
          ))}
        </fieldset>
        <p class="muted">
          The solid cells with their tags and the points in 3D (z = 0 of a 2D
          mesh), written by meshio.
        </p>
        <div class="actions">
          <button type="button" class="button" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" class="button primary" disabled={!!nameError}>
            Export
          </button>
        </div>
      </form>
    </Dialog>
  );
}
