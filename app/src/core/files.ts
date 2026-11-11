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

/** The name of an export of a project file, e.g. "bar.py" of "bar.felupe.json". */
export function exportName(project: string, suffix: string): string {
  const stem = project.endsWith(SUFFIX)
    ? project.slice(0, -SUFFIX.length)
    : project.replace(/\.json$/, "");
  return `${stem || "untitled"}${suffix}`;
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
