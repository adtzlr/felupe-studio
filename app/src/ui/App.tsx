import { useCallback, useEffect, useRef, useState } from "preact/hooks";
import { exportName, mediaType, SUFFIX } from "../core/files";
import { JobRunner, solveBlocker } from "../core/jobs";
import { type ResultView, viewOf } from "../core/results";
import { type Sample, sampleFiles } from "../core/samples";
import { fileNotes, MeshFiles } from "../core/meshfiles";
import { REGISTRY } from "../core/registry";
import type { RibbonItem } from "../core/ribbon";
import type { ModelStore } from "../core/store";
import type { UpdateWatcher } from "../updates";
import type { PyodideClient } from "../worker/client";
import { CreateDialog } from "./CreateDialog";
import { Footer } from "./Footer";
import { Header } from "./Header";
import { useJobs, useMeshFiles, useRuntime, useStore } from "./hooks";
import { ImportMeshDialog } from "./ImportMeshDialog";
import { JobPanel } from "./JobPanel";
import type { Capture } from "../viewer/viewer";
import { CurveCard } from "./CurveCard";
import { SamplesDialog } from "./SamplesDialog";
import type { ExportItem } from "./ExportMenu";
import { ResultsControls } from "./ResultsControls";
import { ResultsView } from "./ResultsView";
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
  download?: (name: string, data: string | Blob) => void;
  /** Reports a newer deployment of the app (see updates.ts). */
  updates?: UpdateWatcher;
  /** Reload the page; the default reloads the browser window. */
  reload?: () => void;
  /** Fetch the files of the samples; the default is the fetch of the browser. */
  fetchSample?: typeof fetch;
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
  updates,
  reload = () => window.location.reload(),
  fetchSample,
}: Props) {
  useStore(store);
  const [files] = useState(() => given ?? new MeshFiles());
  useMeshFiles(files);
  const runtime = useRuntime(client);
  const [jobs] = useState(() => client && new JobRunner(client));
  const run = useJobs(jobs);
  const finished = jobs?.results;
  const [resultView, setResultView] = useState<ResultView>();
  // a finished run shows its last substep, with the choices of the previous view
  useEffect(
    () => setResultView((previous) => finished && viewOf(finished, previous)),
    [finished],
  );
  const notes = fileNotes(store.commands, files);
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
  const [update, setUpdate] = useState<"available" | "dismissed">();
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

  // a newer deployment of the app is offered once
  useEffect(() => updates?.(() => setUpdate("available")), [updates]);

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

  const [samplesOpen, setSamplesOpen] = useState(false);
  const openSample = async (sample: Sample) => {
    try {
      const list = await sampleFiles(
        sample,
        document.baseURI,
        fetchSample ?? ((...args) => fetch(...args)),
      );
      await openFiles(list);
      setSamplesOpen(false);
    } catch (error) {
      setSamplesOpen(false);
      failed("The sample could not be opened.")(error);
    }
  };

  const solve = async () => {
    if (!jobs) return;
    const { serialize } = await import("../core/project");
    await jobs.solve(store.commands, serialize(store.document));
  };

  const save = async () => {
    const { serialize } = await import("../core/project");
    download(fileName, serialize(store.document));
    setSaved(store.commands);
  };

  const captureModel = useRef<Capture>({}).current;
  const captureResults = useRef<Capture>({}).current;
  const failed = (title: string) => (reason: unknown) =>
    setError({
      title,
      lines: [reason instanceof Error ? reason.message : String(reason)],
    });

  const exportScript = async () => {
    if (!client) return;
    const { serialize } = await import("../core/project");
    const text = await client.script(serialize(store.document));
    download(exportName(fileName, ".py"), text);
  };

  const exportPicture = async () => {
    const results = workspace === "results" && resultView;
    const capture = results ? captureResults : captureModel;
    const png = await capture.current?.();
    if (!png) throw new Error("The view shows nothing yet.");
    const suffix = results
      ? `-${resultView.job}-${resultView.substep}.png`
      : ".png";
    download(exportName(fileName, suffix), png);
  };

  const exportResults = async (format: "vtu" | "xdmf") => {
    if (!client || !finished || !resultView) return;
    const { job, substep } = resultView;
    const data = await client.exportResults(
      job,
      format,
      format === "vtu" ? substep : undefined,
    );
    const suffix = format === "vtu" ? `-${job}-${substep}.vtu` : `-${job}.xdmf`;
    const name = exportName(fileName, suffix);
    download(name, new Blob([data as BlobPart], { type: mediaType(name) }));
  };
  const resultsBlocker =
    run.state === "running"
      ? "Wait until the jobs have run."
      : !finished || !resultView
        ? "Solve the model first."
        : undefined;

  const exports: ExportItem[] = [
    {
      id: "script",
      label: "Python script",
      hint: "The FElupe script of the model; it reads the mesh files from its folder.",
      blocker: !client
        ? "Python is not available."
        : store.issues.length
          ? "Fix the issues of the model first."
          : run.state === "running"
            ? "Wait until the jobs have run."
            : runtime.state === "loading"
              ? "Python is still loading."
              : runtime.state === "error"
                ? "Python could not be loaded."
                : undefined,
      onSelect: () =>
        void exportScript().catch(failed("The script could not be exported.")),
    },
    {
      id: "xdmf",
      label: "Results of the job (XDMF)",
      hint: resultView
        ? `All substeps of ${resultView.job}: displacements, strains and stresses, for ParaView.`
        : "All substeps of the job, for ParaView.",
      blocker: resultsBlocker,
      onSelect: () =>
        void exportResults("xdmf").catch(
          failed("The results could not be exported."),
        ),
    },
    {
      id: "vtu",
      label: "Results of the substep (VTU)",
      hint: resultView
        ? `Substep ${resultView.substep} of ${resultView.job} (as shown in the Results workspace).`
        : "The substep shown in the Results workspace.",
      blocker: resultsBlocker,
      onSelect: () =>
        void exportResults("vtu").catch(
          failed("The results could not be exported."),
        ),
    },
    {
      id: "picture",
      label: "Picture of the view",
      hint: "A PNG of the 3D view with its scalar bar, legend and axes.",
      onSelect: () =>
        void exportPicture().catch(
          failed("The picture could not be exported."),
        ),
    },
  ];

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
        onOpen={() => fileInput.current?.click()}
        onSamples={() => setSamplesOpen(true)}
        onSave={() => void save()}
        exports={exports}
        solve={{
          blocker: solveBlocker({
            commands: store.commands,
            issues: store.issues.length,
            notes: notes.size,
            runtime: runtime.state,
          }),
          running: run.state === "running",
          onSolve: () => void solve(),
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
          void openFiles(list);
        }}
      />
      {update === "available" && (
        <div class="banner info" role="status" aria-label="Update">
          <div>
            <strong>A new version of FElupe Studio is available.</strong>{" "}
            {store.commands.length > 0
              ? "Save your project first; after the reload, open it again with its mesh files."
              : "Reload the page to use it."}
          </div>
          <div class="banner-actions">
            <button type="button" class="button" onClick={() => reload()}>
              Reload
            </button>
            <button
              type="button"
              class="icon-button"
              aria-label="Dismiss the update"
              onClick={() => setUpdate("dismissed")}
            >
              ×
            </button>
          </div>
        </div>
      )}
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
        results={
          <ResultsControls
            store={store}
            results={
              finished && resultView
                ? { run: finished, view: resultView }
                : undefined
            }
            running={run.state === "running"}
            onChange={setResultView}
          />
        }
      />
      <div class="body">
        <Sidebar
          store={store}
          files={files}
          notes={notes}
          selected={selected}
          hidden={hidden}
          onSelect={setSelection}
          onToggleVisible={toggleVisible}
          onSamples={() => setSamplesOpen(true)}
        />
        <div class="views">
          <Viewport
            store={store}
            files={files}
            hidden={hidden}
            selected={selected}
            active={workspace === "model"}
            capture={captureModel}
            onCreatePointSet={(preset) =>
              setCreating({
                id: "pointset.add",
                type: "pointset.add",
                label: REGISTRY["pointset.add"].label,
                preset,
              })
            }
          />
          <ResultsView
            source={client}
            view={finished && resultView}
            generation={jobs?.generation ?? 0}
            active={workspace === "results"}
            running={run.state === "running"}
            capture={captureResults}
          >
            {finished && resultView?.curve && (
              <CurveCard
                run={finished}
                view={resultView}
                onChange={setResultView}
                download={download}
              />
            )}
          </ResultsView>
        </div>
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
      {samplesOpen && (
        <SamplesDialog
          modified={store.commands.length > 0 && store.commands !== saved}
          onOpen={openSample}
          onClose={() => setSamplesOpen(false)}
        />
      )}
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
