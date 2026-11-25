// Saving a file (#400): with the save dialog of the system where the browser has it
// (`showSaveFilePicker` of the File System Access API, in Chrome and Edge on the
// desktop), else as a download, as before. The dialog needs the click of the user,
// so it opens first; then the file is made, e.g. an archive with the script, and
// written into the chosen file.
//
// A browser can have the dialog and still refuse it (#439): Chrome and Edge reject
// it with a NotAllowedError if the site setting *File editing* or a policy blocks
// the editing of files. Then the file is downloaded, and so are the next ones.
import { ARCHIVE_SUFFIX, mediaType, SUFFIX } from "./files";

export type FileData = string | Blob;

/** The permission of the browser to write into a file of the save dialog. */
type Permission = "granted" | "denied" | "prompt";

/** A file chosen in the save dialog, as far as the app writes it. */
export interface SaveHandle {
  readonly name: string;
  createWritable(): Promise<{
    write(data: FileData): Promise<void>;
    close(): Promise<void>;
    abort(reason?: unknown): Promise<void>;
  }>;
  /** Whether the app may still write into the file, e.g. after a time in the
   * background (Chrome, Edge). */
  queryPermission?(descriptor: { mode: "readwrite" }): Promise<Permission>;
  /** Ask the user to let the app write into the file again. */
  requestPermission?(descriptor: { mode: "readwrite" }): Promise<Permission>;
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
 * undefined if the dialog was cancelled, or if the dialog of another save is open.
 * A file that cannot be made is not written: the error of `make` is thrown.
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

/** Whether an error is a DOMException of this name, e.g. an AbortError. */
const named = (error: unknown, name: string) =>
  (error as { name?: unknown } | null)?.name === name;

/**
 * Whether the app may write into a file of an earlier save: the browser may have
 * taken the permission back, e.g. after a time in the background, and asks again.
 * Asked before the file is made, while the click of the user still counts.
 */
async function writable(handle: SaveHandle): Promise<boolean> {
  const mode = { mode: "readwrite" } as const;
  try {
    if (!handle.queryPermission) return true;
    if ((await handle.queryPermission(mode)) === "granted") return true;
    return (await handle.requestPermission?.(mode)) === "granted";
  } catch {
    return false;
  }
}

/**
 * Saving with the save dialog of `picker`, if any, else with `download`.
 *
 * - A browser that refuses the dialog (a NotAllowedError, #439) gets a download, and
 *   the next files too: `onRefused` is called once.
 * - A dialog without the click of the user (a SecurityError) also gets a download.
 * - A save while the dialog of another one is open is ignored, e.g. of a double
 *   click: the browser would refuse a second dialog.
 * - A file of an earlier save that the app may not write into anymore is saved
 *   with the dialog again.
 */
export function saver({
  picker,
  download,
  onRefused,
}: {
  picker?: SavePicker;
  download: (name: string, data: FileData) => void;
  onRefused?: () => void;
}): Save {
  // the dialog, until the browser refuses it
  let dialog = picker;
  // whether the dialog of a save is open
  let open = false;
  return async ({ name, kind, into }, make) => {
    let handle = into && (await writable(into)) ? into : undefined;
    if (!handle && dialog) {
      if (open) return undefined;
      open = true;
      try {
        handle = await dialog(pickerOptions(name, kind));
      } catch (error) {
        if (named(error, "AbortError")) return undefined;
        if (named(error, "NotAllowedError")) {
          dialog = undefined;
          onRefused?.();
        } else if (!named(error, "SecurityError")) throw error;
      } finally {
        open = false;
      }
    }
    if (!handle) {
      download(name, await make(name));
      return { name };
    }
    // made before it is opened: a file that cannot be made is not written
    const data = await make(handle.name);
    const stream = await handle.createWritable();
    try {
      await stream.write(data);
      await stream.close();
    } catch (error) {
      await stream.abort(error).catch(() => {});
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
