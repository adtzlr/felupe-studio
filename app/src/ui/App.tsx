import { useCallback, useEffect, useRef, useState } from "preact/hooks";
import { SUFFIX } from "../core/files";
import type { RibbonItem } from "../core/ribbon";
import type { ModelStore } from "../core/store";
import type { PyodideClient } from "../worker/client";
import { CreateDialog } from "./CreateDialog";
import { Footer } from "./Footer";
import { Header } from "./Header";
import { useRuntime, useStore } from "./hooks";
import { Ribbon, type Workspace } from "./Ribbon";
import { Sidebar } from "./Sidebar";
import { Viewport } from "./Viewport";
import "./shell.css";

interface Props {
  store: ModelStore;
  client?: PyodideClient;
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

export function App({ store, client, download = downloadFile }: Props) {
  useStore(store);
  const runtime = useRuntime(client);
  const [workspace, setWorkspace] = useState<Workspace>("model");
  const [tab, setTab] = useState("mesh");
  const [fileName, setFileName] = useState(`untitled${SUFFIX}`);
  const [saved, setSaved] = useState(store.commands);
  const [error, setError] = useState<string[]>([]);
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
      if (creating) return;
      if (!(event.ctrlKey || event.metaKey) || isEditable(event.target)) return;
      const key = event.key.toLowerCase();
      if (key === "z" && !event.shiftKey) store.undo();
      else if ((key === "z" && event.shiftKey) || key === "y") store.redo();
      else return;
      event.preventDefault();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [store, creating]);

  // the project module (with the schema validator) is loaded on first use
  const open = useCallback(
    async (file: File) => {
      const { parse, ProjectError } = await import("../core/project");
      try {
        store.load(parse(await file.text()));
        setSelection(undefined);
        setHidden(new Set());
        setFileName(file.name);
        setSaved(store.commands);
        setError([]);
      } catch (e) {
        setError(
          e instanceof ProjectError
            ? [`${file.name}:`, ...e.errors]
            : [String(e)],
        );
      }
    },
    [store],
  );

  const save = async () => {
    const { serialize } = await import("../core/project");
    download(fileName, serialize(store.document));
    setSaved(store.commands);
  };

  return (
    <div class="shell">
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
        accept={`${SUFFIX},.json`}
        hidden
        data-testid="open-file"
        onChange={(event) => {
          const input = event.currentTarget;
          const file = input.files?.[0];
          if (file) void open(file);
          input.value = "";
        }}
      />
      {error.length > 0 && (
        <div class="banner" role="alert">
          <div>
            <strong>The project could not be opened.</strong>
            <ul>
              {error.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
          </div>
          <button
            type="button"
            class="icon-button"
            aria-label="Dismiss"
            onClick={() => setError([])}
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
        onCreate={setCreating}
      />
      <div class="body">
        <Sidebar
          store={store}
          selected={selected}
          hidden={hidden}
          onSelect={setSelection}
          onToggleVisible={toggleVisible}
        />
        <Viewport />
      </div>
      <Footer store={store} runtime={runtime} />
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
