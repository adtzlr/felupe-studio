import { useCallback, useEffect, useRef, useState } from "preact/hooks";
import { SUFFIX } from "../core/files";
import { fileNotes, MeshFiles } from "../core/meshfiles";
import { REGISTRY } from "../core/registry";
import type { RibbonItem } from "../core/ribbon";
import type { ModelStore } from "../core/store";
import type { PyodideClient } from "../worker/client";
import { CreateDialog } from "./CreateDialog";
import { Footer } from "./Footer";
import { Header } from "./Header";
import { useMeshFiles, useRuntime, useStore } from "./hooks";
import { ImportMeshDialog } from "./ImportMeshDialog";
import { Ribbon, type Workspace } from "./Ribbon";
import { Sidebar } from "./Sidebar";
import { Viewport } from "./Viewport";
import "./shell.css";

interface Props {
  store: ModelStore;
  client?: PyodideClient;
  /** Mesh files of the project; read with the client. */
  files?: MeshFiles;
  /** Save a file; the default downloads it in the browser. */
  download?: (name: string, text: string) => void;
}

function downloadFile(name: string, text: string) {
  const url = URL.createObjectURL(
    new Blob([text], { type: "application/json" }),
  );
  const link = Object.assign(document.createElement("a"), {
    href: url,
    download: name,
  });
  link.click();
  URL.revokeObjectURL(url);
}

const isEditable = (target: EventTarget | null) =>
  target instanceof HTMLElement &&
  (target.isContentEditable ||
    ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName));

const isProject = (file: File) =>
  file.name.endsWith(SUFFIX) || file.name.endsWith(".json");

export function App({
  store,
  client,
  files: given,
  download = downloadFile,
}: Props) {
  useStore(store);
  const [files] = useState(() => given ?? new MeshFiles());
  useMeshFiles(files);
  const runtime = useRuntime(client);
  const [workspace, setWorkspace] = useState<Workspace>("model");
  const [tab, setTab] = useState("mesh");
  const [fileName, setFileName] = useState(`untitled${SUFFIX}`);
  const [saved, setSaved] = useState(store.commands);
  const [error, setError] = useState<{ title: string; lines: string[] }>();
  const [importing, setImporting] = useState<{ file?: File }>();
  const [dragging, setDragging] = useState(false);
  const [selection, setSelection] = useState<string | undefined>();
  const [creating, setCreating] = useState<RibbonItem | undefined>();
  const [hidden, setHidden] = useState<ReadonlySet<string>>(new Set());
  // a selection that was removed (or renamed) is gone
  const selected = selection && store.get(selection) ? selection : undefined;
  const toggleVisible = (id: string) =>
    setHidden((current) => {
      const next = new Set(current);
      if (!next.delete(id)) next.add(id);
      return next;
    });
  const fileInput = useRef<HTMLInputElement>(null);

  // undo and redo with the keyboard, except while typing
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (creating || importing) return;
      if (!(event.ctrlKey || event.metaKey) || isEditable(event.target)) return;
      const key = event.key.toLowerCase();
      if (key === "z" && !event.shiftKey) store.undo();
      else if ((key === "z" && event.shiftKey) || key === "y") store.redo();
      else return;
      event.preventDefault();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [store, creating, importing]);

  // the project module (with the schema validator) is loaded on first use
  const openProject = useCallback(
    async (file: File) => {
      const { parse, ProjectError } = await import("../core/project");
      try {
        store.load(parse(await file.text()));
        setSelection(undefined);
        setHidden(new Set());
        setFileName(file.name);
        setSaved(store.commands);
        setError(undefined);
        return true;
      } catch (e) {
        const lines =
          e instanceof ProjectError
            ? [`${file.name}:`, ...e.errors]
            : [String(e)];
        setError({ title: "The project could not be opened.", lines });
        return false;
      }
    },
    [store],
  );

  /**
   * Open files from the Open button or a drop: a project file with its mesh files,
   * or mesh files to import.
   */
  const openFiles = useCallback(
    async (list: File[]) => {
      const projects = list.filter(isProject);
      const meshes = list.filter((file) => !isProject(file));
      if (projects.length > 1) {
        setError({
          title: "Open one project file at a time.",
          lines: projects.map((f) => f.name),
        });
        return;
      }
      if (projects.length === 1) {
        if (await openProject(projects[0])) await files.addFiles(meshes);
        return;
      }
      if (meshes.length === 1) {
        setImporting({ file: meshes[0] });
      } else if (meshes.length > 1) {
        await files.addFiles(meshes);
        setImporting({});
      }
    },
    [files, openProject],
  );

  const save = async () => {
    const { serialize } = await import("../core/project");
    download(fileName, serialize(store.document));
    setSaved(store.commands);
  };

  return (
    <div
      class={dragging ? "shell dragging" : "shell"}
      onDragOver={(event) => {
        if (!event.dataTransfer?.types.includes("Files")) return;
        event.preventDefault();
        setDragging(true);
      }}
      onDragLeave={(event) => {
        if (event.currentTarget === event.target) setDragging(false);
      }}
      onDrop={(event) => {
        event.preventDefault();
        setDragging(false);
        void openFiles([...(event.dataTransfer?.files ?? [])]);
      }}
    >
      <Header
        store={store}
        fileName={fileName}
        modified={store.commands !== saved}
        runtime={runtime}
        onOpen={() => fileInput.current?.click()}
        onSave={() => void save()}
      />
      <input
        ref={fileInput}
        type="file"
        multiple
        hidden
        data-testid="open-file"
        onChange={(event) => {
          const input = event.currentTarget;
          const list = [...(input.files ?? [])];
          input.value = "";
          void openFiles(list);
        }}
      />
      {error && (
        <div class="banner" role="alert">
          <div>
            <strong>{error.title}</strong>
            <ul>
              {error.lines.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
          </div>
          <button
            type="button"
            class="icon-button"
            aria-label="Dismiss"
            onClick={() => setError(undefined)}
          >
            ×
          </button>
        </div>
      )}
      <Ribbon
        store={store}
        workspace={workspace}
        tab={tab}
        onWorkspace={setWorkspace}
        onTab={setTab}
        onCreate={(item) =>
          item.type === "mesh.import" ? setImporting({}) : setCreating(item)
        }
      />
      <div class="body">
        <Sidebar
          store={store}
          files={files}
          notes={fileNotes(store.commands, files)}
          selected={selected}
          hidden={hidden}
          onSelect={setSelection}
          onToggleVisible={toggleVisible}
        />
        <Viewport
          store={store}
          files={files}
          hidden={hidden}
          selected={selected}
          onCreatePointSet={(preset) =>
            setCreating({
              id: "pointset.add",
              type: "pointset.add",
              label: REGISTRY["pointset.add"].label,
              preset,
            })
          }
        />
      </div>
      <Footer
        store={store}
        runtime={runtime}
        selected={selected}
        onSelect={setSelection}
        onOpen={(type) =>
          type === "mesh.import"
            ? setImporting({})
            : setCreating({
                id: type,
                type,
                label: REGISTRY[type].label,
                preset: {},
              })
        }
      />
      {importing && (
        <ImportMeshDialog
          store={store}
          files={files}
          initial={importing.file}
          onClose={() => setImporting(undefined)}
          onCreated={(name) => {
            setImporting(undefined);
            setSelection(name);
          }}
        />
      )}
      {creating && (
        <CreateDialog
          item={creating}
          store={store}
          onClose={() => setCreating(undefined)}
          onCreated={(name) => {
            setCreating(undefined);
            setSelection(name);
          }}
        />
      )}
    </div>
  );
}
