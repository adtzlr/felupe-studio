/** File name suffix of project files. */
export const SUFFIX = ".felupe.json";

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
  ".csv": "text/csv",
  ".py": "text/x-python",
  ".png": "image/png",
};

export const mediaType = (name: string): string =>
  TYPES[name.slice(name.lastIndexOf("."))] ?? "application/octet-stream";
