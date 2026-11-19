import { useEffect, useRef, useState } from "preact/hooks";
import { mediaType } from "../core/files";
import { JobRunner, solveBlocker } from "../core/jobs";
import {
  faceSetNotes,
  fileNotes,
  makeMeshes,
  MeshFiles,
} from "../core/meshfiles";
import { symmetryNotes } from "../core/symmetry";
import type { Sample } from "../core/samples";
import type { ModelStore } from "../core/store";
import type { SessionStorage } from "../core/session";
import type { UpdateWatcher } from "../updates";
import type { RuntimeClient } from "../worker/client";
import { hasAgent } from "../agent/connection";
import { ErrorBanner, UpdateBanner } from "./Banners";
import { Dialogs, useDialogs } from "./Dialogs";
import { Footer } from "./Footer";
import { Header } from "./Header";
import {
  useCapabilities,
  useMedia,
  useMeshFiles,
  useRuntime,
  useStore,
} from "./hooks";
import { Inspector } from "./Inspector";
import { JobPanel } from "./JobPanel";
import { ResultsPane, ResultsRibbon } from "./ResultsPane";
import { Ribbon, type Workspace } from "./Ribbon";
import { ScriptView } from "./ScriptView";
import { Sidebar } from "./Sidebar";
import { useAppAgent } from "./useAgent";
import { useExports } from "./useExports";
import { useProject } from "./useProject";
import { useResults } from "./useResults";
import { objectMenu, useSelection } from "./useSelection";
import { useShortcuts } from "./useShortcuts";
import { Viewport } from "./Viewport";
import { Welcome } from "./Welcome";
import "./shell.css";

interface Props {
  store: ModelStore;
  client?: RuntimeClient;
  /** Mesh files of the project; read with the client. */
  files?: MeshFiles;
  /** Save a file; the default downloads it in the browser. */
  download?: (name: string, data: string | Blob) => void;
  /** Reports a newer deployment of the app (see updates.ts). */
  updates?: UpdateWatcher;
  /** Reload the page; the default reloads the browser window. */
  reload?: () => void;
  /** Fetch the files of the samples; the default is the fetch of the browser. */
  fetchSample?: typeof fetch;
  /** Keeps the session in the browser, so that a reload restores it (#57). */
  session?: SessionStorage;
}

function downloadFile(name: string, data: string | Blob) {
  const url = URL.createObjectURL(
    typeof data === "string"
      ? new Blob([data], { type: mediaType(name) })
      : data,
  );
  const link = Object.assign(document.createElement("a"), {
    href: url,
    download: name,
  });
  link.click();
  URL.revokeObjectURL(url);
}

/** The windows in which the browser and the properties are drawers (#131). */
export const NARROW = "(max-width: 1000px)";

/**
 * The app (#312): it composes the state of its concerns (the project, the run and
 * the results, the selection, the exports, the dialogs, the agent bridge and the
 * shortcuts) and its layout.
 */
export function App({
  store,
  client,
  files: given,
  download = downloadFile,
  updates,
  reload = () => window.location.reload(),
  fetchSample,
  session,
}: Props) {
  useStore(store);
  const [files] = useState(() => given ?? new MeshFiles());
  useMeshFiles(files);
  const runtime = useRuntime(client);
  useCapabilities(store, runtime);
  const [jobs] = useState(() => client && new JobRunner(client));
  const [workspace, setWorkspace] = useState<Workspace>("model");
  const results = useResults({ store, jobs, workspace });
  const { run } = results;
  const dialogs = useDialogs();
  const project = useProject({
    store,
    files,
    client,
    jobs,
    session,
    download,
    fetchSample,
    // after the render, when `selection` below is there
    onReset: () => selection.reset(),
    onImport: dialogs.importMesh,
    onCreate: dialogs.setCreating,
    onParameters: (name) =>
      dialogs.setParameters({ project: name, opening: true }),
  });
  const { fileName, modified } = project;
  const selection = useSelection(store, workspace, project.setError);
  const { selected, select } = selection;
  const exports = useExports({
    store,
    files,
    client,
    runtime,
    results,
    project,
    workspace,
    download,
  });
  // the meshes of scripts with the parameters of the model, made in the worker
  // (#182), after the parameters of an opened project are set (#183)
  useEffect(() => {
    if (!dialogs.parameters?.opening) makeMeshes(store.commands, files);
  }, [store.commands, files, files.revision, dialogs.parameters]);
  // notes about the mesh files, and about face sets on cells without faces (#142),
  // and about repeated symmetry planes, which do not block Solve (#186)
  const meshNotes = fileNotes(store.commands, files);
  const faceNotes = faceSetNotes(store.commands, files);
  const notes = new Map([...meshNotes, ...faceNotes]);
  for (const note of symmetryNotes(store.resolved)) {
    notes.set(note.name, [...(notes.get(note.name) ?? []), note.message]);
  }
  const [tab, setTab] = useState("mesh");
  // narrow windows show the browser and the properties as drawers (#131)
  const narrow = useMedia(NARROW);
  const [browserOpen, setBrowserOpen] = useState(false);
  // the script view replaces the viewport while its ribbon tab is open (#130)
  const scriptShown = workspace === "model" && tab === "script";
  const [dragging, setDragging] = useState(false);
  // the nodes of the meshes in both workspaces (#91)
  const [showNodes, setShowNodes] = useState(false);
  const [update, setUpdate] = useState<"available" | "dismissed">();
  const fileInput = useRef<HTMLInputElement>(null);
  const openFile = () => fileInput.current?.click();

  // a newer deployment of the app is offered once
  useEffect(() => updates?.(() => setUpdate("available")), [updates]);

  const openSample = async (sample: Sample) => {
    await project.openSample(sample);
    dialogs.setSamplesOpen(false);
  };

  // a click in the browser in the Results workspace (#196): a job with results
  // shows them, another object its properties in the Model workspace
  const selectInBrowser = (id: string | undefined) => {
    select(id);
    if (workspace !== "results" || id === undefined) return;
    if (!results.showJob(id)) setWorkspace("model");
  };

  const blocker = solveBlocker({
    commands: store.commands,
    // a face set on cells without faces is an issue of the model (#142)
    issues: store.issues.length + faceNotes.size,
    notes: meshNotes.size,
    runtime: runtime.state,
  });

  // the agent bridge of felupe-studio serve --agent (#258)
  const [agentAvailable] = useState(() => Boolean(client?.local) && hasAgent());
  const agent = useAppAgent({
    store,
    files,
    client,
    jobs,
    notes,
    modified,
    openSample,
    blocker,
    results,
    selection,
    workspace,
    setWorkspace,
    picture: exports.picture,
  });

  const object =
    workspace === "model" && store.commands.some((c) => c.name === selected)
      ? selected
      : undefined;
  useShortcuts({
    object,
    visible: object !== undefined && selection.visible(object),
    selected: selected !== undefined,
    drawer: narrow && browserOpen,
    results: workspace === "results",
    canSolve: !blocker && run.state !== "running",
    save: () => void project.save(),
    saveAs: () => dialogs.setSavingAs(true),
    solve: () => void results.solve(),
    open: openFile,
    undo: () => store.undo(),
    redo: () => store.redo(),
    help: () => dialogs.setHelp("shortcuts"),
    remove: selection.remove,
    rename: selection.rename,
    duplicate: selection.duplicate,
    toggleVisible: selection.toggleVisible,
    closeDrawer: () => setBrowserOpen(false),
    deselect: () => select(undefined),
    moveSubstep: results.moveSubstep,
    play: () => results.player.toggle(),
  });

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
        void project.openFiles([...(event.dataTransfer?.files ?? [])]);
      }}
    >
      <Header
        store={store}
        fileName={fileName}
        modified={modified}
        onNew={project.requestNew}
        onOpen={openFile}
        onSamples={() => dialogs.setSamplesOpen(true)}
        onSave={() => void project.save()}
        onSaveAs={() => dialogs.setSavingAs(true)}
        // a new name without saving: the next save and the exports take it (#205)
        onRename={project.rename}
        onShortcuts={() => dialogs.setHelp("shortcuts")}
        onAbout={() => dialogs.setHelp("about")}
        agent={
          agentAvailable
            ? {
                connected: agent.state.state === "connected",
                onConnect: agent.connect,
                onDisconnect: agent.disconnect,
              }
            : undefined
        }
        browserOpen={narrow && browserOpen}
        onBrowser={() => setBrowserOpen(!browserOpen)}
        exports={exports.exports}
        solve={{
          blocker,
          running: run.state === "running",
          onSolve: () => void results.solve(),
          onCancel: () => jobs?.cancel(),
        }}
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
          void project.openFiles(list);
        }}
      />
      {update === "available" && (
        <UpdateBanner
          project={store.commands.length > 0}
          onReload={() => reload()}
          onDismiss={() => setUpdate("dismissed")}
        />
      )}
      {project.error && (
        <ErrorBanner
          banner={project.error}
          onDismiss={() => project.setError(undefined)}
        />
      )}
      <Ribbon
        store={store}
        workspace={workspace}
        tab={tab}
        onWorkspace={setWorkspace}
        onTab={setTab}
        onCreate={(item) =>
          item.type === "mesh.import"
            ? dialogs.importMesh()
            : dialogs.setCreating(item)
        }
        script={
          <p class="ribbon-note muted">
            The FElupe script of the model, as it is exported, updated after
            every change. Select an object to highlight its lines, or click a
            line to select its object.
          </p>
        }
        results={<ResultsRibbon store={store} results={results} />}
      />
      <div
        class={[
          "body",
          selection.showInspector && "inspecting",
          narrow && browserOpen && "browser-open",
        ]
          .filter(Boolean)
          .join(" ")}
      >
        <Sidebar
          store={store}
          notes={notes}
          selected={selected}
          hidden={selection.hidden}
          onSelect={(id) => {
            selectInBrowser(id);
            // the properties replace the browser drawer
            if (narrow) setBrowserOpen(false);
          }}
          onClose={narrow ? () => setBrowserOpen(false) : undefined}
          onToggleVisible={selection.toggleVisible}
          menuItems={(name) =>
            objectMenu(store, selection, name, {
              exportBlocker: exports.meshBlocker,
              onExportMesh: dialogs.setExportingMesh,
              onParameters: () =>
                dialogs.setParameters({ project: fileName, opening: false }),
            })
          }
        />
        <div class="views">
          <ScriptView
            store={store}
            client={client}
            runtime={runtime}
            active={scriptShown}
            selected={selected}
            onSelect={select}
            onDownload={exports.scriptExport}
          />
          <Viewport
            store={store}
            files={files}
            hidden={selection.hidden}
            selected={selected}
            active={workspace === "model" && !scriptShown}
            capture={exports.captureModel}
            showNodes={showNodes}
            onShowNodes={setShowNodes}
            onSelect={select}
            empty={
              store.commands.length === 0 ? (
                <Welcome
                  onImportMesh={() => dialogs.importMesh()}
                  onOpen={openFile}
                  onOpenSample={openSample}
                  local={client?.local}
                />
              ) : undefined
            }
            onCreatePointSet={(preset) =>
              dialogs.create("pointset.add", preset)
            }
            onCreateFaceSet={(preset) => dialogs.create("faceset.add", preset)}
            onCreateControlPoint={(preset) =>
              dialogs.create("point.add", preset)
            }
          />
          <ResultsPane
            client={client}
            jobs={jobs}
            results={results}
            active={workspace === "results"}
            capture={exports.captureResults}
            showNodes={showNodes}
            onShowNodes={setShowNodes}
            download={download}
          />
          <JobPanel
            run={run}
            store={store}
            onDismiss={() => jobs?.dismiss()}
            onShowResults={
              workspace === "results"
                ? undefined
                : () => {
                    setWorkspace("results");
                    jobs?.dismiss();
                  }
            }
            onShowLive={
              workspace === "results" || !results.liveOn
                ? undefined
                : () => setWorkspace("results")
            }
          />
        </div>
        {selection.showInspector && (
          <Inspector
            store={store}
            files={files}
            notes={notes}
            selected={selected}
            onSelect={select}
            onClose={selection.closeInspector}
          />
        )}
      </div>
      <Footer
        store={store}
        runtime={runtime}
        kept={project.kept}
        agent={
          agentAvailable
            ? { state: agent.state, onDisconnect: agent.disconnect }
            : undefined
        }
        selected={selected}
        onSelect={select}
        onOpen={(type) =>
          type === "mesh.import" ? dialogs.importMesh() : dialogs.create(type)
        }
      />
      <Dialogs
        dialogs={dialogs}
        store={store}
        files={files}
        client={client}
        runtime={runtime}
        project={project}
        exports={exports}
        script={agent.script}
        onOpenSample={openSample}
        onSelect={select}
      />
    </div>
  );
}
