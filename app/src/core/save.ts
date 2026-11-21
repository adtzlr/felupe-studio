// Saving a file (#400): with the save dialog of the system where the browser has it
// (`showSaveFilePicker` of the File System Access API, in Chrome and Edge on the
// desktop), else as a download, as before. The dialog needs the click of the user,
// so it opens first; then the file is made, e.g. an archive with the script, and
// written into the chosen file.
import { ARCHIVE_SUFFIX, mediaType, SUFFIX } from "./files";

export type FileData = string | Blob;

/** A file chosen in the save dialog, as far as the app writes it. */
export interface SaveHandle {
  readonly name: string;
  createWritable(): Promise<{
    write(data: FileData): Promise<void>;
    close(): Promise<void>;
    abort(reason?: unknown): Promise<void>;
  }>;
}

export interface PickerOptions {
  /** The name of the file, which the dialog suggests. */
  suggestedName: string;
  /** The dialog opens in the folder of the last save with the same id. */
  id: string;
  types: { description: string; accept: Record<string, string[]> }[];
}

/** `window.showSaveFilePicker`, or a fake of the tests. */
export type SavePicker = (options: PickerOptions) => Promise<SaveHandle>;

/** The kind of a file: projects and exports keep their own last folders. */
export type SaveKind = "project" | "export";

export interface SaveRequest {
  /** The name of the file, suggested in the dialog or of the download. */
  name: string;
  kind: SaveKind;
  /** A file of an earlier save, written again without the dialog. */
  into?: SaveHandle;
}

/** A saved file: its name, and its handle unless it was downloaded. */
export interface Saved {
  name: string;
  handle?: SaveHandle;
}

/**
 * Save a file. `make` makes its content for the chosen name, after the dialog;
 * undefined if the dialog was cancelled. A file that cannot be made is not written:
 * the error of `make` is thrown.
 */
export type Save = (
  request: SaveRequest,
  make: (name: string) => FileData | Promise<FileData>,
) => Promise<Saved | undefined>;

/** The descriptions of the types of the files, by suffix. */
const DESCRIPTIONS: Record<string, string> = {
  [SUFFIX]: "Project file",
  [ARCHIVE_SUFFIX]: "Project archive",
  ".py": "Python script",
  ".xdmf": "XDMF results",
  ".vtu": "VTK unstructured grid",
  ".vtk": "VTK legacy",
  ".msh": "Gmsh mesh",
  ".inp": "Abaqus input",
  ".bdf": "Nastran bulk data",
  ".csv": "CSV table",
  ".png": "PNG picture",
};

/** The id of the dialog per kind, which keeps its last folder. */
export const PICKER_IDS: Record<SaveKind, string> = {
  project: "felupe-studio-projects",
  export: "felupe-studio-exports",
};

/** The options of the save dialog of a file: its name, its kind and its type. */
export function pickerOptions(name: string, kind: SaveKind): PickerOptions {
  const dot = name.lastIndexOf(".");
  const suffix =
    [SUFFIX, ARCHIVE_SUFFIX].find((s) => name.endsWith(s)) ??
    (dot > 0 ? name.slice(dot) : undefined);
  return {
    suggestedName: name,
    id: PICKER_IDS[kind],
    types: suffix
      ? [
          {
            description:
              DESCRIPTIONS[suffix] ?? `${suffix.slice(1).toUpperCase()} file`,
            accept: { [mediaType(name)]: [suffix] },
          },
        ]
      : [],
  };
}

/** Whether an error is the *Cancel* of the dialog. */
const cancelled = (error: unknown) =>
  (error as { name?: unknown } | null)?.name === "AbortError";

/** Saving with the save dialog of `picker`, if any, else with `download`. */
export function saver({
  picker,
  download,
}: {
  picker?: SavePicker;
  download: (name: string, data: FileData) => void;
}): Save {
  return async ({ name, kind, into }, make) => {
    let handle = into;
    if (!handle) {
      if (!picker) {
        download(name, await make(name));
        return { name };
      }
      try {
        handle = await picker(pickerOptions(name, kind));
      } catch (error) {
        if (cancelled(error)) return undefined;
        throw error;
      }
    }
    // made before it is opened: a file that cannot be made is not written
    const data = await make(handle.name);
    const writable = await handle.createWritable();
    try {
      await writable.write(data);
      await writable.close();
    } catch (error) {
      await writable.abort(error).catch(() => {});
      throw error;
    }
    return { name: handle.name, handle };
  };
}

/** The save dialog of the browser, if it has one. */
export function systemPicker(): SavePicker | undefined {
  const browser = globalThis as { showSaveFilePicker?: SavePicker };
  const picker = browser.showSaveFilePicker;
  return typeof picker === "function"
    ? (options) => picker.call(globalThis, options)
    : undefined;
}
