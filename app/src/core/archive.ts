// Project archives (#148, ADR 0007): one ZIP file `<name>.felupe.zip` with the
// project file `<name>.felupe.json` and the mesh files under the names of their
// `mesh.import`, optionally with the FElupe script `<name>.py`, so the unpacked folder
// runs as is. No results and no manifest: the project file is the manifest. Loaded
// on demand (with fflate in a chunk of its own).
import { unzipSync, zipSync } from "fflate";
import { SUFFIX } from "./files";

export class ArchiveError extends Error {}

/** A file of an archive: its name in the archive and its content. */
export interface ArchiveEntry {
  name: string;
  data: Uint8Array;
}

/** The content of an archive, as files to open like several files. */
export interface Archive {
  /** The stem of the project file (e.g. `bar` of `bar.felupe.json`), if any. */
  name?: string;
  /** The project file; without it, the files are mesh files to import. */
  project?: File;
  /** The files the project uses (all files without a project). */
  files: File[];
  /** The FElupe script `<name>.py` of the project, if the archive has it. */
  script?: File;
  /** Files of the archive that the project does not use. */
  ignored: string[];
}

// a fixed time of all entries (the earliest of ZIP files, in local time like the
// time fields of ZIP), so the same project gives the same archive
const MTIME = new Date(1980, 0, 1);

/** The path of an entry, checked: relative, without `..`, with `/` only. */
function checked(path: string): string {
  const name = path.replace(/\\/g, "/");
  if (name.startsWith("/") || /^[a-z]:/i.test(name)) {
    throw new ArchiveError(`The archive has an absolute path: ${path}`);
  }
  const parts = name.split("/");
  if (parts.some((part) => part === "..")) {
    throw new ArchiveError(`The archive has a path outside of it: ${path}`);
  }
  // e.g. ./bar.vtu
  return parts.filter((part) => part !== ".").join("/");
}

/** The mesh files of a project file (`file` of `mesh.import`). */
function meshFilesOf(text: string): Set<string> | undefined {
  try {
    const document = JSON.parse(text) as { commands?: unknown };
    if (!Array.isArray(document.commands)) return undefined;
    return new Set(
      document.commands.flatMap((command: unknown) => {
        const c = command as Record<string, unknown> | null;
        // the files of imported meshes and of scripts that make meshes (#182)
        return (c?.command === "mesh.import" || c?.command === "mesh.script") &&
          typeof c.file === "string"
          ? [c.file]
          : [];
      }),
    );
  } catch {
    // not JSON: opening the project reports it
    return undefined;
  }
}

/**
 * A project archive: the project file, the script (optional) and the mesh files,
 * the same bytes for the same content (fixed times, sorted mesh files).
 */
export function writeArchive({
  name,
  project,
  files,
  script,
}: {
  /** The stem of the files, e.g. `bar`. */
  name: string;
  /** The text of the project file. */
  project: string;
  files: readonly ArchiveEntry[];
  /** The text of the FElupe script. */
  script?: string;
}): Uint8Array<ArrayBuffer> {
  const text = new TextEncoder();
  const entries: Record<string, Uint8Array> = {};
  const add = (path: string, data: Uint8Array) => {
    const key = checked(path);
    if (key in entries) {
      throw new ArchiveError(`The archive would have two files ${key}.`);
    }
    entries[key] = data;
  };
  add(`${name}${SUFFIX}`, text.encode(project));
  if (script !== undefined) add(`${name}.py`, text.encode(script));
  for (const file of [...files].sort((a, b) =>
    a.name < b.name ? -1 : a.name > b.name ? 1 : 0,
  )) {
    add(file.name, file.data);
  }
  return zipSync(entries, { level: 6, mtime: MTIME });
}

/**
 * The project and its files of an archive. An archive that a user zipped is
 * accepted: one top-level folder is stripped, `__MACOSX/`, hidden files and
 * folders are skipped. Unsafe paths and two project files are errors.
 */
export function readArchive(bytes: Uint8Array): Archive {
  let unzipped: Record<string, Uint8Array>;
  try {
    unzipped = unzipSync(bytes);
  } catch (error) {
    const reason = error instanceof Error ? ` (${error.message})` : "";
    throw new ArchiveError(`This is not a ZIP file${reason}.`);
  }
  // the files, without folders, hidden files and the resources of macOS
  let entries = Object.entries(unzipped)
    .map(([path, data]) => ({ path: checked(path), data }))
    .filter(
      ({ path }) =>
        !path.endsWith("/") &&
        !path.split("/").some((part) => part.startsWith(".")) &&
        !path.startsWith("__MACOSX/"),
    );
  // one top-level folder of all files is stripped
  const top = entries[0]?.path.split("/")[0];
  if (
    entries.length &&
    entries.every(({ path }) => path.startsWith(`${top}/`))
  ) {
    entries = entries.map((e) => ({
      ...e,
      path: e.path.slice(top!.length + 1),
    }));
  }

  const projects = entries.filter(
    ({ path }) => !path.includes("/") && path.endsWith(SUFFIX),
  );
  if (projects.length > 1) {
    throw new ArchiveError(
      `The archive has more than one project file: ${projects.map((p) => p.path).join(", ")}.`,
    );
  }
  const file = ({ path, data }: { path: string; data: Uint8Array }) =>
    new File([data as Uint8Array<ArrayBuffer>], path);
  const [project] = projects;
  if (!project) {
    return { files: entries.map(file), ignored: [] };
  }

  const name = project.path.slice(0, -SUFFIX.length);
  const used = meshFilesOf(new TextDecoder().decode(project.data));
  const rest = entries.filter((e) => e !== project);
  // a script of the model's meshes may have the name of the FElupe script (#182)
  const script = used?.has(`${name}.py`)
    ? undefined
    : rest.find(({ path }) => path === `${name}.py`);
  const others = rest.filter((e) => e !== script);
  const uses = (path: string) => !used || used.has(path);
  return {
    name,
    project: file(project),
    files: others.filter(({ path }) => uses(path)).map(file),
    ...(script ? { script: file(script) } : {}),
    ignored: others.filter(({ path }) => !uses(path)).map(({ path }) => path),
  };
}
