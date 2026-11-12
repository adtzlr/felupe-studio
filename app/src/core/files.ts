/** File name suffix of project files. */
export const SUFFIX = ".felupe.json";

/** File name suffix of project archives: the project with its mesh files (#148). */
export const ARCHIVE_SUFFIX = ".felupe.zip";

/** Whether the bytes are a ZIP file (its local file header or an empty archive). */
export function isZip(bytes: Uint8Array): boolean {
  return (
    bytes.length >= 4 &&
    bytes[0] === 0x50 &&
    bytes[1] === 0x4b &&
    ((bytes[2] === 3 && bytes[3] === 4) || (bytes[2] === 5 && bytes[3] === 6))
  );
}

/** The stem of a project file or archive, e.g. "bar" of "bar.felupe.zip". */
export function stemOf(project: string): string {
  for (const suffix of [SUFFIX, ARCHIVE_SUFFIX, ".json", ".zip"]) {
    if (project.endsWith(suffix)) return project.slice(0, -suffix.length);
  }
  return project;
}

/** The suffix of a project file or archive, e.g. ".felupe.zip" of "bar.felupe.zip". */
export const suffixOf = (project: string): string =>
  project.slice(stemOf(project).length);

/**
 * The problem of a name (the stem) of a project, if any (#205): it is not empty, has
 * none of the characters that file systems forbid and does not start with a dot.
 * With `script`, the name of the script of an archive is not the name of a mesh
 * script of the project (`meshFiles`), e.g. `bushing` with `bushing.py`.
 */
export function projectNameProblem(
  stem: string,
  {
    meshFiles = [],
    script = false,
  }: {
    meshFiles?: readonly string[];
    script?: boolean;
  } = {},
): string | undefined {
  const name = stem.trim();
  if (!name) return "Enter a name.";
  // eslint-disable-next-line no-control-regex
  if (/[\\/:*?"<>|\u0000-\u001f]/.test(name))
    return 'A name has none of the characters \\ / : * ? " < > |.';
  if (name.startsWith(".")) return "A name does not start with a dot.";
  if (script && meshFiles.includes(`${name}.py`))
    return `${name}.py is a mesh script of the project: the archive would have two files ${name}.py. Take another name or no script.`;
  return undefined;
}

/**
 * The name of an export of a project file or archive, e.g. "bar.py" of
 * "bar.felupe.json" or "bar.felupe.zip".
 */
export function exportName(project: string, suffix: string): string {
  return `${stemOf(project) || "untitled"}${suffix}`;
}

/** A size in bytes as text, e.g. "512 B", "31.4 kB" or "2.5 MB". */
export function formatBytes(bytes: number): string {
  if (bytes < 1000) return `${bytes} B`;
  const [value, unit] = bytes < 1e6 ? [bytes / 1e3, "kB"] : [bytes / 1e6, "MB"];
  return `${value < 10 ? value.toFixed(1) : Math.round(value)} ${unit}`;
}

/** The media types of the downloads, by extension. */
const TYPES: Record<string, string> = {
  ".json": "application/json",
  ".zip": "application/zip",
  ".csv": "text/csv",
  ".py": "text/x-python",
  ".png": "image/png",
  ".vtu": "application/xml",
  ".xdmf": "application/xml",
};

export const mediaType = (name: string): string =>
  TYPES[name.slice(name.lastIndexOf("."))] ?? "application/octet-stream";
