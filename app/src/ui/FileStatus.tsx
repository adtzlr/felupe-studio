// State of the file of a mesh or a material in the properties panel, with a button
// to choose it: a mesh file, a script that makes a mesh with the parameters of the
// model and its error with the traceback of the script (#182), or the script of a
// material (ADR 0025): what it made with the parameters of the model, or its error
// (#423), and its template to download.
import { useRef, useState } from "preact/hooks";
import type { Command, MaterialScript } from "../core/commands";
import {
  type MeshCommand,
  type MeshFiles,
  materialStatus,
  meshStatus,
} from "../core/meshfiles";
import type { Save } from "../core/save";
import { saveTemplate } from "../core/templates";
import type { MaterialInfo } from "../worker/protocol";
import { useMeshFiles } from "./hooks";
import { Icon } from "./icons";

/** What the script of a material made, e.g. `umat: NeoHooke · no state variables`. */
export function madeMaterial({ type, statevars = 0 }: MaterialInfo): string {
  const variables =
    statevars === 0
      ? "no state variables"
      : `${statevars.toLocaleString("en")} state variable${statevars === 1 ? "" : "s"}`;
  return `umat: ${type} · ${variables}`;
}

export function FileStatus({
  command,
  commands,
  files,
  save,
}: {
  command: MeshCommand | MaterialScript;
  commands: readonly Command[];
  files: MeshFiles;
  /** Saves the template of the script of a material (#423). */
  save: Save;
}) {
  useMeshFiles(files);
  const input = useRef<HTMLInputElement>(null);
  const [saveError, setSaveError] = useState<string>();
  const file = files.get(command.file);
  const script = command.command !== "mesh.import";
  const material = command.command === "material.script";
  // the mesh of a file or a script, or the run of the script of a material
  const mesh = material ? undefined : meshStatus(command, commands, files);
  const run = material ? materialStatus(command, commands, files) : undefined;
  const status = mesh ?? run;
  const read = mesh?.state === "ready" ? mesh.info : undefined;
  const made = run?.state === "ready" ? run.info : undefined;

  // the template under the name of the file, to edit and choose it (#423)
  const downloadTemplate = async (material: MaterialScript) => {
    setSaveError(undefined);
    try {
      await saveTemplate(save, material.kind, material.file);
    } catch (error) {
      setSaveError(`The template was not saved: ${(error as Error).message}`);
    }
  };

  return (
    <div class="file-status">
      <div class="file-line">
        <strong>{command.file}</strong>
        {!file && <span class="warning">not loaded</span>}
        {status?.state === "reading" && (
          <span class="muted">
            {command.command === "mesh.script"
              ? "making the mesh …"
              : material && file?.status.state === "script"
                ? "running the script …"
                : "reading …"}
          </span>
        )}
        {read && (
          <span class="muted">
            {(read.solids ?? [])
              .map((s) => `${s.cells.toLocaleString("en")} ${s.cell_type}`)
              .join(", ")}{" "}
            cells · {read.points?.toLocaleString("en")} points
          </span>
        )}
        {made && <span class="muted">{madeMaterial(made)}</span>}
        {status?.state === "error" && (
          <span class="field-error">{status.message}</span>
        )}
      </div>
      {status?.state === "error" && status.traceback && (
        <details class="traceback">
          <summary>Traceback of the script</summary>
          <pre>{status.traceback}</pre>
        </details>
      )}
      <div class="file-actions">
        <button
          type="button"
          class="button"
          onClick={() => input.current?.click()}
        >
          <Icon name="open" size={14} />
          {file ? "Replace file…" : "Choose file…"}
        </button>
        {material && (
          <button
            type="button"
            class="button"
            title={`A minimal script of this kind, saved as ${command.file}: edit it, then choose it`}
            onClick={() => void downloadTemplate(command)}
          >
            <Icon name="export" size={14} />
            Download template
          </button>
        )}
      </div>
      {saveError && <span class="field-error">{saveError}</span>}
      <input
        ref={input}
        type="file"
        hidden
        accept={script ? ".py" : undefined}
        data-testid="mesh-file"
        onChange={async (event) => {
          const chosen = event.currentTarget.files?.[0];
          event.currentTarget.value = "";
          // the file is stored under the name the mesh references
          if (chosen)
            await files.add(
              command.file,
              new Uint8Array(await chosen.arrayBuffer()),
            );
        }}
      />
    </div>
  );
}
