// The project of the app (#312): its name and whether it is saved, opening files,
// archives and samples, saving it, a new project, and its session in the browser.
import { useCallback, useEffect, useRef, useState } from "preact/hooks";
import {
  ARCHIVE_SUFFIX,
  isZip,
  mediaType,
  stemOf,
  SUFFIX,
} from "../core/files";
import type { JobRunner } from "../core/jobs";
import { isScript, type MeshFiles, meshFileNames } from "../core/meshfiles";
import { REGISTRY } from "../core/registry";
import type { RibbonItem } from "../core/ribbon";
import { type Sample, sampleFiles } from "../core/samples";
import { SCHEMA_VERSION } from "../core/schema";
import type { Session, SessionStorage } from "../core/session";
import type { ModelStore } from "../core/store";
import type { RuntimeClient } from "../worker/client";
import { safeName } from "../worker/files";
import { parametersOf } from "./ParametersDialog";
import { useSession } from "./useSession";

/** An error, or a note (`info`), e.g. of the files of an archive that were not used. */
export interface Banner {
  title: string;
  lines: string[];
  info?: boolean;
}

interface Options {
  store: ModelStore;
  files: MeshFiles;
  client?: RuntimeClient;
  jobs?: JobRunner;
  session?: SessionStorage;
  download: (name: string, data: string | Blob) => void;
  fetchSample?: typeof fetch;
  /** A project was opened or started: the selection and the hidden objects go. */
  onReset: () => void;
  /** Mesh files to import: one file, or none after several files were kept. */
  onImport: (file?: File) => void;
  /** A command to create, e.g. a mesh script with a script that was opened alone. */
  onCreate: (item: RibbonItem) => void;
  /** The parameters of a project that is opened, before its meshes are made (#183). */
  onParameters: (project: string) => void;
}

const isProject = (file: File) =>
  file.name.endsWith(SUFFIX) || file.name.endsWith(".json");

/** A project archive (#149): named `.zip`, or a ZIP file by its first bytes. */
const isArchive = async (file: File) =>
  file.name.endsWith(".zip") ||
  isZip(new Uint8Array(await file.slice(0, 4).arrayBuffer()));

/**
 * The files of a list with the files of its archives instead of the archives
 * (#149): the project of an archive first, the name of the archive, and the files
 * of the archives that the project does not use.
 */
async function unpack(
  list: File[],
): Promise<
  { opened: File[]; archive?: string; ignored: string[] } | { error: Banner }
> {
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
      return {
        error: {
          title: `${file.name} could not be opened.`,
          lines: [e instanceof Error ? e.message : String(e)],
        },
      };
    }
  }
  return { opened, archive, ignored };
}

export function useProject(options: Options) {
  const { store, files, client, jobs, session, download, fetchSample } =
    options;
  // the callbacks of the latest render, e.g. for the memoized openFiles
  const latest = useRef(options);
  latest.current = options;

  const [fileName, setFileName] = useState(`untitled${SUFFIX}`);
  // the name of the last saved or opened project file: a renamed project is not
  // saved until it is saved under its new name (#205)
  const [savedName, setSavedName] = useState(fileName);
  // a new project is a project file until its first mesh file, then an archive
  // (#150); a project that was opened, restored or saved keeps its format
  const [fresh, setFresh] = useState(() => store.commands.length === 0);
  const meshCount = meshFileNames(store.commands).length;
  const meshesBefore = useRef(meshCount);
  useEffect(() => {
    const before = meshesBefore.current;
    meshesBefore.current = meshCount;
    if (!fresh || before > 0 || meshCount === 0) return;
    if (!fileName.endsWith(ARCHIVE_SUFFIX)) {
      // the format of a new project changes, it is not renamed (#205)
      const archive = `${stemOf(fileName)}${ARCHIVE_SUFFIX}`;
      if (savedName === fileName) setSavedName(archive);
      setFileName(archive);
    }
    setFresh(false);
  }, [meshCount]);
  // the command list of the last saved or opened project file; none for a restored
  // session with unsaved changes
  const [saved, setSaved] = useState<typeof store.commands | undefined>(
    store.commands,
  );
  const modified = store.commands !== saved || fileName !== savedName;
  const [error, setError] = useState<Banner>();
  const failed = (title: string) => (reason: unknown) =>
    setError({
      title,
      lines: [reason instanceof Error ? reason.message : String(reason)],
    });

  // the project module (with the schema validator) is loaded on first use; a project
  // replaces the mesh files of the previous one (#149)
  const openProject = useCallback(
    async (file: File, name = file.name) => {
      const { parse, ProjectError } = await import("../core/project");
      try {
        const document = parse(await file.text());
        files.clear();
        setFresh(false);
        store.load(document);
        latest.current.onReset();
        setFileName(name);
        setSavedName(name);
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

  /**
   * Open mesh files without a project: scripts that make meshes (#182) are kept,
   * and one alone is used by a new mesh script; other files are imported.
   */
  const openMeshFiles = async (meshes: File[]) => {
    const scripts = meshes.filter((file) => isScript(file.name));
    const others = meshes.filter((file) => !isScript(file.name));
    if (scripts.length) await files.addFiles(scripts);
    if (others.length === 1) {
      latest.current.onImport(others[0]);
    } else if (others.length > 1) {
      await files.addFiles(others);
      latest.current.onImport();
    } else if (scripts.length === 1) {
      latest.current.onCreate({
        id: "mesh.script",
        type: "mesh.script",
        label: REGISTRY["mesh.script"].label,
        preset: { file: safeName(scripts[0].name) },
      });
    }
  };

  // a project that replaces a model with unsaved changes is opened after asking
  const [opening, setOpening] = useState<{ files: File[]; name: string }>();

  /**
   * Open a project with its mesh files: with unsaved changes after asking (unless
   * `confirmed`), then its parameters, if it has any, before its meshes are made
   * (#183), and a note of the files of its archive that it does not use.
   */
  const openWithProject = async (
    file: File,
    {
      list,
      meshes,
      ignored,
      name,
      confirmed,
    }: {
      list: File[];
      meshes: File[];
      ignored: string[];
      name: string;
      confirmed: boolean;
    },
  ) => {
    if (!confirmed && store.commands.length > 0 && modified) {
      setOpening({ files: list, name });
      return;
    }
    if (!(await openProject(file, name))) return;
    // in the local runtime also its scripts, which run on this computer (#240)
    if (
      parametersOf(store.commands).length ||
      (client?.local && meshFileNames(store.commands).some(isScript))
    )
      latest.current.onParameters(name);
    await files.addFiles(meshes);
    if (ignored.length) {
      setError({
        title: `Files of ${name} that the project does not use were not opened:`,
        lines: ignored,
        info: true,
      });
    }
  };

  /**
   * Open files from the Open button, a drop or a sample: a project file with its
   * mesh files, a project archive (#149), or mesh files to import. With unsaved
   * changes, a project is opened after asking (unless `confirmed`); `name` is the
   * name of the project instead of the name of its file (e.g. of a sample).
   */
  const openFiles = useCallback(
    async (
      list: File[],
      {
        confirmed = false,
        name: given,
      }: { confirmed?: boolean; name?: string } = {},
    ) => {
      const unpacked = await unpack(list);
      if ("error" in unpacked) {
        setError(unpacked.error);
        return;
      }
      const { opened, archive, ignored } = unpacked;
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
        const name = given ?? archive ?? projects[0].name;
        await openWithProject(projects[0], {
          list,
          meshes,
          ignored,
          name,
          confirmed,
        });
        return;
      }
      await openMeshFiles(meshes);
    },
    [files, openProject, store, modified],
  );

  /** Open the project that was asked for, after the confirmation. */
  const confirmOpening = () => {
    if (!opening) return;
    setOpening(undefined);
    void openFiles(opening.files, { confirmed: true, name: opening.name });
  };

  const restoreSession = async (restored: Session) => {
    const { parse } = await import("../core/project");
    const document = parse(restored.project);
    setFresh(false);
    store.load(document);
    setFileName(restored.fileName);
    setSavedName(restored.fileName);
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
    setFresh(true);
    setFileName(`untitled${SUFFIX}`);
    setSavedName(`untitled${SUFFIX}`);
    setSaved(store.commands);
    latest.current.onReset();
    setError(undefined);
    setConfirmNew(false);
  };
  /** A new project, after asking if the model has unsaved changes. */
  const requestNew = () =>
    store.commands.length > 0 && modified ? setConfirmNew(true) : newProject();

  /** Open a sample: an archive with its mesh files (#150). */
  const openSample = async (sample: Sample) => {
    try {
      const list = await sampleFiles(
        sample,
        document.baseURI,
        fetchSample ?? ((...args) => fetch(...args)),
      );
      await openFiles(list, {
        confirmed: true,
        name: `${sample.id}${ARCHIVE_SUFFIX}`,
      });
    } catch (error) {
      failed("The sample could not be opened.")(error);
    }
  };

  /**
   * Save the project under a name in the format of its suffix: a project file or
   * an archive with the mesh files and optionally the script (#149, #150).
   */
  const saveProject = async (name: string, withScript = false) => {
    const { serialize } = await import("../core/project");
    const project = serialize(store.document);
    const commands = store.commands;
    if (!name.endsWith(ARCHIVE_SUFFIX)) {
      download(name, project);
    } else {
      let script: string | undefined;
      if (withScript && client) {
        try {
          script = await client.script(project);
        } catch (e) {
          failed("The script could not be made; the project was not saved.")(e);
          return;
        }
      }
      const { writeArchive } = await import("../core/archive");
      const names = meshFileNames(commands);
      const missing = names.filter((file) => !files.dataOf(file));
      const archive = writeArchive({
        name: stemOf(name),
        project,
        files: names.flatMap((file) => {
          const data = files.dataOf(file);
          return data ? [{ name: file, data }] : [];
        }),
        script,
      });
      download(name, new Blob([archive], { type: mediaType(name) }));
      if (missing.length) {
        setError({
          title: `${name} was saved without the mesh files that are not loaded:`,
          lines: missing,
          info: true,
        });
      }
    }
    setFileName(name);
    setSavedName(name);
    setFresh(false);
    setSaved(commands);
  };
  const save = () => saveProject(fileName);

  return {
    fileName,
    /** A new name without saving: the next save and the exports take it (#205). */
    rename: setFileName,
    modified,
    error,
    setError,
    failed,
    openFiles,
    opening,
    confirmOpening,
    cancelOpening: () => setOpening(undefined),
    kept,
    confirmNew,
    newProject,
    requestNew,
    cancelNew: () => setConfirmNew(false),
    openSample,
    saveProject,
    save,
  };
}

export type Project = ReturnType<typeof useProject>;
