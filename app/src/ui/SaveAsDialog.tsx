// Save the project as a project file or a project archive with another name (#150):
// the format with one line about what it contains, for an archive the script and a
// summary of the mesh files with their sizes (missing ones are listed).
import { useState } from "preact/hooks";
import type { Command } from "../core/commands";
import {
  ARCHIVE_SUFFIX,
  formatBytes,
  projectNameProblem,
  stemOf,
  SUFFIX,
} from "../core/files";
import { type MeshFiles, meshFileNames } from "../core/meshfiles";
import { Dialog } from "./Dialog";

export type ProjectFormat = "file" | "archive";

export interface SaveChoice {
  /** The file name with the suffix of the format. */
  name: string;
  /** Include the FElupe script in the archive. */
  script: boolean;
}

interface Props {
  fileName: string;
  commands: readonly Command[];
  files: MeshFiles;
  /** The script can be made (Python is ready). */
  scriptAvailable: boolean;
  onSave: (choice: SaveChoice) => void;
  onClose: () => void;
}

const FORMATS: { id: ProjectFormat; label: string; hint: string }[] = [
  {
    id: "file",
    label: `Project file (${SUFFIX})`,
    hint: "The commands as text, e.g. for version control. Keep the mesh files next to it.",
  },
  {
    id: "archive",
    label: `Project archive (${ARCHIVE_SUFFIX})`,
    hint: "One file with the project and its mesh files, to open it anywhere in one step.",
  },
];

/** The format of a project by the suffix of its name. */
export const formatOf = (fileName: string): ProjectFormat =>
  fileName.endsWith(ARCHIVE_SUFFIX) ? "archive" : "file";

export function SaveAsDialog({
  fileName,
  commands,
  files,
  scriptAvailable,
  onSave,
  onClose,
}: Props) {
  const [stem, setStem] = useState(stemOf(fileName) || "untitled");
  const [format, setFormat] = useState<ProjectFormat>(formatOf(fileName));
  const [script, setScript] = useState(false);
  const name = stem.trim();
  // the script of an archive is not a mesh script of the project (#205)
  const nameError = projectNameProblem(name, {
    meshFiles: meshFileNames(commands),
    script: format === "archive" && script && scriptAvailable,
  });
  const meshes = meshFileNames(commands).map((file) => ({
    file,
    size: files.dataOf(file)?.byteLength,
  }));
  const missing = meshes.filter((m) => m.size === undefined);
  const total = meshes.reduce((sum, m) => sum + (m.size ?? 0), 0);
  const suffix = format === "archive" ? ARCHIVE_SUFFIX : SUFFIX;

  const save = (event: Event) => {
    event.preventDefault();
    if (nameError) return;
    onSave({
      name: `${name}${suffix}`,
      script: format === "archive" && script && scriptAvailable,
    });
  };

  return (
    <Dialog title="Save project as" onClose={onClose}>
      <form class="save-as" onSubmit={save}>
        <div class="form-row-stack">
          <label for="save-name" class="form-label">
            Name
          </label>
          <div class="name-with-suffix">
            <input
              id="save-name"
              type="text"
              value={stem}
              autocomplete="off"
              spellcheck={false}
              aria-invalid={nameError ? true : undefined}
              aria-describedby="save-name-hint"
              onInput={(event) => setStem(event.currentTarget.value)}
            />
            <span class="muted">{suffix}</span>
          </div>
          <small
            id="save-name-hint"
            class={nameError ? "field-error" : "muted"}
          >
            {nameError ?? `Saved as ${name}${suffix}`}
          </small>
        </div>
        <fieldset class="choices">
          <legend class="form-label">Format</legend>
          {FORMATS.map((f) => (
            <label key={f.id} class="check">
              <input
                type="radio"
                name="format"
                checked={format === f.id}
                onChange={() => setFormat(f.id)}
              />
              <span>
                {f.label}
                <small class="muted">{f.hint}</small>
              </span>
            </label>
          ))}
        </fieldset>
        {format === "archive" && (
          <>
            <label class="check">
              <input
                type="checkbox"
                checked={script && scriptAvailable}
                disabled={!scriptAvailable}
                onChange={(event) => setScript(event.currentTarget.checked)}
              />
              <span>
                Include the Python script{" "}
                <small class="muted">
                  {scriptAvailable
                    ? `${name || "untitled"}.py runs with FElupe in the unpacked folder`
                    : "once Python is ready"}
                </small>
              </span>
            </label>
            <div class="plan" aria-label="Mesh files">
              <span class="muted">
                {meshes.length
                  ? `Mesh files · ${formatBytes(total)}`
                  : "No mesh files"}
              </span>
              {meshes.length > 0 && (
                <ul>
                  {meshes.map((m) => (
                    <li key={m.file}>
                      {m.file}{" "}
                      <span class={m.size === undefined ? "warning" : "muted"}>
                        {m.size === undefined
                          ? "not loaded"
                          : formatBytes(m.size)}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            {missing.length > 0 && (
              <p class="scale-suggestion" role="note">
                The archive lacks the mesh files that are not loaded. Choose
                them in the properties of their meshes first, or save anyway.
              </p>
            )}
          </>
        )}
        <div class="actions">
          <button type="button" class="button" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" class="button primary" disabled={!!nameError}>
            Save
          </button>
        </div>
      </form>
    </Dialog>
  );
}
