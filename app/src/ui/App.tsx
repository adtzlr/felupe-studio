import { useCallback, useEffect, useRef, useState } from "preact/hooks";
import {
  type ContourSettings,
  loadContour,
  saveContour,
} from "../core/contour";
import {
  ARCHIVE_SUFFIX,
  exportName,
  isZip,
  mediaType,
  stemOf,
  SUFFIX,
} from "../core/files";
import { JobRunner, solveBlocker } from "../core/jobs";
import { type ResultView, substepsOf, viewOf } from "../core/results";
import {
  ariaKeys,
  dialogOpen,
  hint,
  isNavigating,
  isTyping,
  matches,
  type ShortcutId,
} from "../core/shortcuts";
import { type Sample, sampleFiles } from "../core/samples";
import type { Session, SessionStorage } from "../core/session";
import { fileNotes, MeshFiles, meshFileNames } from "../core/meshfiles";
import { duplicateBlocker } from "../core/duplicate";
import { REGISTRY } from "../core/registry";
import type { RibbonItem } from "../core/ribbon";
import type { ModelStore } from "../core/store";
import { SCHEMA_VERSION } from "../core/schema";
import type { UpdateWatcher } from "../updates";
import type { PyodideClient } from "../worker/client";
import { KINDS } from "../core/validate";
import { AboutDialog } from "./AboutDialog";
import { VISIBLE_KINDS } from "./Browser";
import type { MenuItem } from "./Menu";
import { CreateDialog } from "./CreateDialog";
import { Footer } from "./Footer";
import { type ExportItem, Header } from "./Header";
import { useJobs, useMedia, useMeshFiles, useRuntime, useStore } from "./hooks";
import { ImportMeshDialog } from "./ImportMeshDialog";
import { Inspector } from "./Inspector";
import { JobPanel } from "./JobPanel";
import type { Capture } from "../viewer/viewer";
import { CurveCard } from "./CurveCard";
import { NewProjectDialog } from "./NewProjectDialog";
import { SamplesDialog } from "./SamplesDialog";
import { ScriptView } from "./ScriptView";
import { ShortcutsDialog } from "./ShortcutsDialog";
import { useSession } from "./useSession";
import { ResultsControls } from "./ResultsControls";
import { usePlayer } from "./usePlayer";
import { ResultsView } from "./ResultsView";
import { Ribbon, type Workspace } from "./Ribbon";
import { Sidebar } from "./Sidebar";
import { Viewport } from "./Viewport";
import { Welcome } from "./Welcome";
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

const isProject = (file: File) =>
  file.name.endsWith(SUFFIX) || file.name.endsWith(".json");

/** A project archive (#149): named `.zip`, or a ZIP file by its first bytes. */
const isArchive = async (file: File) =>
  file.name.endsWith(".zip") ||
  isZip(new Uint8Array(await file.slice(0, 4).arrayBuffer()));

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
  const [jobs] = useState(() => client && new JobRunner(client));
  const run = useJobs(jobs);
  const finished = jobs?.results;
  const [resultView, setResultView] = useState<ResultView>();
  // a finished run shows its last substep, with the choices of the previous view
  useEffect(
    () => setResultView((previous) => finished && viewOf(finished, previous)),
    [finished],
  );
  // play the substeps (#141): the next one follows once the current one is shown
  const [shown, setShown] = useState<{ view: ResultView; ok: boolean }>();
  const substeps =
    finished && resultView ? substepsOf(finished, resultView.job) : 0;
  const notes = fileNotes(store.commands, files);
  const [workspace, setWorkspace] = useState<Workspace>("model");
  const player = usePlayer({
    enabled: workspace === "results" && run.state !== "running" && substeps > 1,
    substep: resultView?.substep ?? 0,
    total: substeps,
    shown: shown && shown.view === resultView ? shown.ok : undefined,
    onStep: (substep) => setResultView((view) => view && { ...view, substep }),
  });
  const [tab, setTab] = useState("mesh");
  // narrow windows show the browser and the properties as drawers (#131)
  const narrow = useMedia(NARROW);
  const [browserOpen, setBrowserOpen] = useState(false);
  // the script view replaces the viewport while its ribbon tab is open (#130)
  const scriptShown = workspace === "model" && tab === "script";
  const [fileName, setFileName] = useState(`untitled${SUFFIX}`);
  // the command list of the last saved or opened project file; none for a restored
  // session with unsaved changes
  const [saved, setSaved] = useState<typeof store.commands | undefined>(
    store.commands,
  );
  const modified = store.commands !== saved;
  // an error, or a note (`info`), e.g. of the files of an archive that were not used
  const [error, setError] = useState<{
    title: string;
    lines: string[];
    info?: boolean;
  }>();
  const [importing, setImporting] = useState<{ file?: File }>();
  const [dragging, setDragging] = useState(false);
  const [selection, setSelection] = useState<string | undefined>();
  // the properties panel on the right opens when an object is selected (#83)
  const [inspecting, setInspecting] = useState(false);
  const select = (id: string | undefined) => {
    setSelection(id);
    setInspecting(id !== undefined);
  };
  const [creating, setCreating] = useState<RibbonItem | undefined>();
  const [hidden, setHidden] = useState<ReadonlySet<string>>(new Set());
  // the settings of the contour of the results, kept in the browser (#139)
  const [contour, setContour] = useState<ContourSettings>(loadContour);
  const [shownRange, setShownRange] = useState<readonly [number, number]>();
  const changeContour = (settings: ContourSettings) => {
    setContour(settings);
    saveContour(settings);
  };
  // the nodes of the meshes in both workspaces (#91)
  const [showNodes, setShowNodes] = useState(false);
  const [update, setUpdate] = useState<"available" | "dismissed">();
  // a selection that was removed (or renamed) is gone
  const selected = selection && store.get(selection) ? selection : undefined;
  // the panel shows the properties of a selected object in the Model workspace
  const showInspector =
    inspecting && selected !== undefined && workspace === "model";
  const toggleVisible = (id: string) =>
    setHidden((current) => {
      const next = new Set(current);
      if (!next.delete(id)) next.add(id);
      return next;
    });
  const fileInput = useRef<HTMLInputElement>(null);

  // the keyboard shortcuts of the app (#129), with the state of the latest render
  const keys = useRef<(event: KeyboardEvent) => void>(undefined);
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => keys.current?.(event);
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  // a newer deployment of the app is offered once
  useEffect(() => updates?.(() => setUpdate("available")), [updates]);

  // the project module (with the schema validator) is loaded on first use; a project
  // replaces the mesh files of the previous one (#149)
  const openProject = useCallback(
    async (file: File, name = file.name) => {
      const { parse, ProjectError } = await import("../core/project");
      try {
        const document = parse(await file.text());
        files.clear();
        store.load(document);
        setSelection(undefined);
        setHidden(new Set());
        setFileName(name);
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
    [store, files],
  );

  // a project that replaces a model with unsaved changes is opened after asking
  const [opening, setOpening] = useState<{ files: File[]; name: string }>();

  /**
   * Open files from the Open button, a drop or a sample: a project file with its
   * mesh files, a project archive (#149), or mesh files to import. With unsaved
   * changes, a project is opened after asking (unless `confirmed`).
   */
  const openFiles = useCallback(
    async (list: File[], confirmed = false) => {
      // the files of the archives instead of the archives
      let opened: File[] = [];
      let archive: string | undefined;
      const ignored: string[] = [];
      for (const file of list) {
        if (!(await isArchive(file))) {
          opened.push(file);
          continue;
        }
        const { readArchive } = await import("../core/archive");
        try {
          const content = readArchive(new Uint8Array(await file.arrayBuffer()));
          if (content.project) {
            opened = [content.project, ...opened];
            archive = `${stemOf(file.name)}${ARCHIVE_SUFFIX}`;
          }
          opened.push(...content.files);
          ignored.push(...content.ignored);
        } catch (e) {
          setError({
            title: `${file.name} could not be opened.`,
            lines: [e instanceof Error ? e.message : String(e)],
          });
          return;
        }
      }
      const projects = opened.filter(isProject);
      const meshes = opened.filter((file) => !isProject(file));
      if (projects.length > 1) {
        setError({
          title: "Open one project file at a time.",
          lines: projects.map((f) => f.name),
        });
        return;
      }
      if (projects.length === 1) {
        const name = archive ?? projects[0].name;
        if (!confirmed && store.commands.length > 0 && modified) {
          setOpening({ files: list, name });
          return;
        }
        if (await openProject(projects[0], name)) {
          await files.addFiles(meshes);
          if (ignored.length) {
            setError({
              title: `Files of ${name} that the project does not use were not opened:`,
              lines: ignored,
              info: true,
            });
          }
        }
        return;
      }
      if (meshes.length === 1) {
        setImporting({ file: meshes[0] });
      } else if (meshes.length > 1) {
        await files.addFiles(meshes);
        setImporting({});
      }
    },
    [files, openProject, store, modified],
  );

  const restoreSession = async (restored: Session) => {
    const { parse } = await import("../core/project");
    store.load(parse(restored.project));
    setFileName(restored.fileName);
    setSaved(restored.modified ? undefined : store.commands);
    await files.addFiles(
      restored.files.map((f) => new File([f.data as BlobPart], f.name)),
    );
  };
  const kept = useSession(session, {
    store,
    files,
    fileName,
    modified,
    onRestore: restoreSession,
  });

  const [confirmNew, setConfirmNew] = useState(false);
  const newProject = () => {
    jobs?.forget();
    store.load({ schema_version: SCHEMA_VERSION as 3, commands: [] });
    files.clear();
    setFileName(`untitled${SUFFIX}`);
    setSaved(store.commands);
    setSelection(undefined);
    setHidden(new Set());
    setError(undefined);
    setConfirmNew(false);
  };

  const [samplesOpen, setSamplesOpen] = useState(false);
  const [help, setHelp] = useState<"about" | "shortcuts">();
  const openSample = async (sample: Sample) => {
    try {
      const list = await sampleFiles(
        sample,
        document.baseURI,
        fetchSample ?? ((...args) => fetch(...args)),
      );
      await openFiles(list, true);
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

  /** Save the project in its format: a project file or an archive (#149). */
  const save = async () => {
    const { serialize } = await import("../core/project");
    const project = serialize(store.document);
    if (!fileName.endsWith(ARCHIVE_SUFFIX)) {
      download(fileName, project);
      setSaved(store.commands);
      return;
    }
    const { writeArchive } = await import("../core/archive");
    const names = meshFileNames(store.commands);
    const missing = names.filter((name) => !files.dataOf(name));
    const archive = writeArchive({
      name: stemOf(fileName),
      project,
      files: names.flatMap((name) => {
        const data = files.dataOf(name);
        return data ? [{ name, data }] : [];
      }),
    });
    download(
      fileName,
      new Blob([archive], {
        type: mediaType(fileName),
      }),
    );
    setSaved(store.commands);
    if (missing.length) {
      setError({
        title: `${fileName} was saved without the mesh files that are not loaded:`,
        lines: missing,
        info: true,
      });
    }
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

  const exportResults = async (format: "vtu" | "xdmf" | "csv") => {
    if (!client || !finished || !resultView) return;
    const { job, substep } = resultView;
    const data = await client.exportResults(
      job,
      format,
      format === "vtu" ? substep : undefined,
    );
    const suffix =
      format === "vtu"
        ? `-${job}-${substep}.vtu`
        : format === "csv"
          ? `-${job}-points.csv`
          : `-${job}.xdmf`;
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
    ...(store.commands.some((c) => c.command === "point.add")
      ? [
          {
            id: "points",
            label: "Control points (CSV)",
            hint: resultView
              ? `Displacements and forces of the control points of all substeps of ${resultView.job}.`
              : "Displacements and forces of the control points of all substeps.",
            blocker: resultsBlocker,
            onSelect: () =>
              void exportResults("csv").catch(
                failed("The control points could not be exported."),
              ),
          },
        ]
      : []),
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

  const blocker = solveBlocker({
    commands: store.commands,
    issues: store.issues.length,
    notes: notes.size,
    runtime: runtime.state,
  });

  /** Delete the selected object, unless other objects use it. */
  const removeSelected = (name: string) => {
    const dependents = store.dependents(name);
    if (dependents.length > 0) {
      setError({
        title: `${name} cannot be deleted.`,
        lines: [`It is used by ${dependents.join(", ")}: delete these first.`],
      });
      return;
    }
    store.apply({ type: "remove", name });
    select(undefined);
  };

  /** Duplicate an object and select the copy (#138). */
  const duplicateObject = (name: string) => {
    const copy = store.duplicate(name);
    if (copy) select(copy);
  };

  /** Whether an object can be shown or hidden in the viewport. */
  const visible = (name: string) => {
    const command = store.get(name);
    return command !== undefined && VISIBLE_KINDS.has(KINDS[command.command]);
  };

  /** The items of the context menu of an object in the browser (#138). */
  const menuItems = (name: string): MenuItem[] => {
    const command = store.get(name);
    if (!command) return [];
    const dependents = store.dependents(name);
    const keys = (id: ShortcutId) => ({ text: hint(id), aria: ariaKeys(id) });
    const blocker = duplicateBlocker(command);
    return [
      {
        id: "duplicate",
        label: "Duplicate",
        shortcut: keys("duplicate"),
        ...(blocker ? { blocker } : {}),
        onSelect: () => duplicateObject(name),
      },
      {
        id: "rename",
        label: "Rename",
        shortcut: keys("rename"),
        onSelect: () => {
          select(name);
          renameSelected();
        },
      },
      ...(visible(name)
        ? [
            {
              id: "visibility",
              label: hidden.has(name) ? "Show" : "Hide",
              shortcut: keys("visibility"),
              onSelect: () => toggleVisible(name),
            },
          ]
        : []),
      {
        id: "delete",
        label: "Delete",
        shortcut: keys("delete"),
        ...(dependents.length
          ? { blocker: `Used by ${dependents.join(", ")}: delete these first.` }
          : {}),
        onSelect: () => removeSelected(name),
      },
    ];
  };

  /** Show the properties of the selected object with the focus on its name. */
  const renameSelected = () => {
    setInspecting(true);
    requestAnimationFrame(() => {
      const input = document.querySelector<HTMLInputElement>(
        '[aria-label="Properties"] #field-name',
      );
      input?.focus();
      input?.select();
    });
  };

  /** The previous or next substep, or the first or last one (from 1), in the results. */
  const moveSubstep = (to: "previous" | "next" | "first" | "last") => {
    if (!finished || !resultView) return;
    const last = substepsOf(finished, resultView.job);
    const substep = {
      previous: Math.max(1, resultView.substep - 1),
      next: Math.min(last, resultView.substep + 1),
      first: 1,
      last,
    }[to];
    setResultView({ ...resultView, substep });
  };

  keys.current = (event: KeyboardEvent) => {
    if (event.defaultPrevented || dialogOpen()) return;
    const is = (id: ShortcutId) => matches(event, id);
    const model = workspace === "model";
    const object = model && store.commands.some((c) => c.name === selected);
    // saving and solving also work while typing, e.g. in the properties
    if (is("save")) void save();
    else if (is("solve")) {
      if (!blocker && run.state !== "running") void solve();
    } else if (isTyping(event.target)) return;
    else if (is("open")) fileInput.current?.click();
    else if (is("undo")) store.undo();
    else if (is("redo")) store.redo();
    else if (is("help")) setHelp("shortcuts");
    else if (is("delete") && object) removeSelected(selected!);
    else if (is("rename") && object) renameSelected();
    else if (is("duplicate") && object) duplicateObject(selected!);
    else if (is("visibility") && object && visible(selected!))
      toggleVisible(selected!);
    else if (is("escape") && narrow && browserOpen) setBrowserOpen(false);
    else if (is("escape") && selected !== undefined) select(undefined);
    else if (isNavigating(event.target) || workspace !== "results") return;
    else if (is("substep-previous")) moveSubstep("previous");
    else if (is("substep-next")) moveSubstep("next");
    else if (is("substep-first")) moveSubstep("first");
    else if (is("substep-last")) moveSubstep("last");
    // Space on a button presses it
    else if (
      is("play") &&
      !(event.target as Element | null)?.closest?.("button, a, summary")
    )
      player.toggle();
    else return;
    event.preventDefault();
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
        modified={modified}
        onNew={() =>
          store.commands.length > 0 && modified
            ? setConfirmNew(true)
            : newProject()
        }
        onOpen={() => fileInput.current?.click()}
        onSamples={() => setSamplesOpen(true)}
        onSave={() => void save()}
        onShortcuts={() => setHelp("shortcuts")}
        onAbout={() => setHelp("about")}
        browserOpen={narrow && browserOpen}
        onBrowser={() => setBrowserOpen(!browserOpen)}
        exports={exports}
        solve={{
          blocker,
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
        <div
          class={error.info ? "banner info" : "banner"}
          role={error.info ? "status" : "alert"}
          aria-label={error.info ? "Note" : undefined}
        >
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
        script={
          <p class="ribbon-note muted">
            The FElupe script of the model, as it is exported, updated after
            every change. Select an object to highlight its lines, or click a
            line to select its object.
          </p>
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
            contour={contour}
            onContour={changeContour}
            currentRange={shownRange}
            player={player}
          />
        }
      />
      <div
        class={[
          "body",
          showInspector && "inspecting",
          narrow && browserOpen && "browser-open",
        ]
          .filter(Boolean)
          .join(" ")}
      >
        <Sidebar
          store={store}
          notes={notes}
          selected={selected}
          hidden={hidden}
          onSelect={(id) => {
            select(id);
            // the properties replace the browser drawer
            if (narrow) setBrowserOpen(false);
          }}
          onClose={narrow ? () => setBrowserOpen(false) : undefined}
          onToggleVisible={toggleVisible}
          menuItems={menuItems}
        />
        <div class="views">
          <ScriptView
            store={store}
            client={client}
            runtime={runtime}
            active={scriptShown}
            selected={selected}
            onSelect={select}
            onDownload={() =>
              void exportScript().catch(
                failed("The script could not be exported."),
              )
            }
          />
          <Viewport
            store={store}
            files={files}
            hidden={hidden}
            selected={selected}
            active={workspace === "model" && !scriptShown}
            capture={captureModel}
            showNodes={showNodes}
            onShowNodes={setShowNodes}
            onSelect={select}
            empty={
              store.commands.length === 0 ? (
                <Welcome
                  onImportMesh={() => setImporting({})}
                  onOpen={() => fileInput.current?.click()}
                  onOpenSample={openSample}
                />
              ) : undefined
            }
            onCreatePointSet={(preset) =>
              setCreating({
                id: "pointset.add",
                type: "pointset.add",
                label: REGISTRY["pointset.add"].label,
                preset,
              })
            }
            onCreateControlPoint={(preset) =>
              setCreating({
                id: "point.add",
                type: "point.add",
                label: REGISTRY["point.add"].label,
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
            showNodes={showNodes}
            onShowNodes={setShowNodes}
            commands={finished?.commands}
            contour={contour}
            onRange={setShownRange}
            ahead={player.ahead}
            onShown={(view, ok) => setShown({ view, ok })}
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
        {showInspector && (
          <Inspector
            store={store}
            files={files}
            notes={notes}
            selected={selected}
            onSelect={select}
            onClose={() => setInspecting(false)}
          />
        )}
      </div>
      <Footer
        store={store}
        runtime={runtime}
        kept={kept}
        selected={selected}
        onSelect={select}
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
      {confirmNew && (
        <NewProjectDialog
          fileName={fileName}
          onConfirm={newProject}
          onClose={() => setConfirmNew(false)}
        />
      )}
      {opening && (
        <NewProjectDialog
          fileName={fileName}
          opening={opening.name}
          onConfirm={() => {
            setOpening(undefined);
            void openFiles(opening.files, true);
          }}
          onClose={() => setOpening(undefined)}
        />
      )}
      {help === "about" && (
        <AboutDialog runtime={runtime} onClose={() => setHelp(undefined)} />
      )}
      {help === "shortcuts" && (
        <ShortcutsDialog onClose={() => setHelp(undefined)} />
      )}
      {samplesOpen && (
        <SamplesDialog
          modified={store.commands.length > 0 && modified}
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
            select(name);
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
            select(name);
          }}
        />
      )}
    </div>
  );
}
