// State of the file of a mesh or a material in the properties panel, with a button
// to choose it: a mesh file, a script that makes a mesh with the parameters of the
// model and its error with the traceback of the script (#182), or the script of a
// material (ADR 0025), which the jobs run.
import { useRef } from "preact/hooks";
import type { Command, MaterialScript } from "../core/commands";
import {
  type MeshCommand,
  type MeshFiles,
  meshStatus,
} from "../core/meshfiles";
import { useMeshFiles } from "./hooks";
import { Icon } from "./icons";

export function FileStatus({
  command,
  commands,
  files,
}: {
  command: MeshCommand | MaterialScript;
  commands: readonly Command[];
  files: MeshFiles;
}) {
  useMeshFiles(files);
  const input = useRef<HTMLInputElement>(null);
  const file = files.get(command.file);
  const script = command.command !== "mesh.import";
  // the file of a material, or the mesh of a file or a script
  const status =
    command.command === "material.script"
      ? file?.status
      : meshStatus(command, commands, files);
  const info = status?.state === "ready" ? status.info : undefined;

  return (
    <div class="file-status">
      <div class="file-line">
        <strong>{command.file}</strong>
        {!file && <span class="warning">not loaded</span>}
        {status?.state === "reading" && (
          <span class="muted">
            {command.command === "mesh.script"
              ? "making the mesh …"
              : "reading …"}
          </span>
        )}
        {info && (
          <span class="muted">
            {(info.solids ?? [])
              .map((s) => `${s.cells.toLocaleString("en")} ${s.cell_type}`)
              .join(", ")}{" "}
            cells · {info.points?.toLocaleString("en")} points
          </span>
        )}
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
      <button
        type="button"
        class="button"
        onClick={() => input.current?.click()}
      >
        <Icon name="open" size={14} />
        {file ? "Replace file…" : "Choose file…"}
      </button>
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
