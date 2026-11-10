// State of the file of a mesh in the properties panel, with a button to choose it.
import { useRef } from "preact/hooks";
import type { MeshImport } from "../core/commands";
import type { MeshFiles } from "../core/meshfiles";
import { useMeshFiles } from "./hooks";
import { Icon } from "./icons";

export function MeshFileStatus({
  command,
  files,
}: {
  command: MeshImport;
  files: MeshFiles;
}) {
  useMeshFiles(files);
  const input = useRef<HTMLInputElement>(null);
  const file = files.get(command.file);
  const status = file?.status;
  const info = status?.state === "ready" ? status.info : undefined;

  return (
    <div class="file-status">
      <div class="file-line">
        <strong>{command.file}</strong>
        {!file && <span class="warning">not loaded</span>}
        {status?.state === "reading" && <span class="muted">reading …</span>}
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
