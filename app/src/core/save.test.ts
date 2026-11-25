import { afterEach, describe, expect, it, vi } from "vitest";
import {
  type FileData,
  pickerOptions,
  type SaveHandle,
  saver,
  systemPicker,
} from "./save";

/** A file of a fake save dialog, which records what is written into it. */
function handle(name: string, fail?: Error) {
  const written: FileData[] = [];
  const abort = vi.fn(async () => {});
  const file: SaveHandle = {
    name,
    createWritable: vi.fn(async () => ({
      write: async (data: FileData) => {
        if (fail) throw fail;
        written.push(data);
      },
      close: async () => {},
      abort,
    })),
  };
  return { file, written, abort };
}

const cancel = () =>
  new DOMException("The user aborted a request.", "AbortError");

describe("the options of the save dialog (#400)", () => {
  it("suggest the name, keep a folder per kind and name the type", () => {
    expect(pickerOptions("bushing.felupe.zip", "project")).toEqual({
      suggestedName: "bushing.felupe.zip",
      id: "felupe-studio-projects",
      types: [
        {
          description: "Project archive",
          accept: { "application/zip": [".felupe.zip"] },
        },
      ],
    });
    expect(pickerOptions("bushing.felupe.json", "project").types).toEqual([
      {
        description: "Project file",
        accept: { "application/json": [".felupe.json"] },
      },
    ]);
    const exported = pickerOptions("bushing-radial-9.vtu", "export");
    expect(exported.id).toBe("felupe-studio-exports");
    expect(exported.types).toEqual([
      {
        description: "VTK unstructured grid",
        accept: { "application/xml": [".vtu"] },
      },
    ]);
    expect(pickerOptions("bushing.py", "export").types[0].description).toBe(
      "Python script",
    );
    expect(pickerOptions("radial.csv", "export").types[0].accept).toEqual({
      "text/csv": [".csv"],
    });
    // a mesh of Nastran, and a suffix without a description
    expect(pickerOptions("b-mesh.bdf", "export").types).toEqual([
      {
        description: "Nastran bulk data",
        accept: { "application/octet-stream": [".bdf"] },
      },
    ]);
    expect(pickerOptions("a.dat", "export").types[0].description).toBe(
      "DAT file",
    );
    expect(pickerOptions("README", "export").types).toEqual([]);
  });
});

describe("saving a file (#400)", () => {
  it("downloads the file without a save dialog", async () => {
    const download = vi.fn();
    const make = vi.fn(() => "text");
    const save = saver({ download });
    expect(await save({ name: "a.py", kind: "export" }, make)).toEqual({
      name: "a.py",
    });
    expect(make).toHaveBeenCalledWith("a.py");
    expect(download).toHaveBeenCalledWith("a.py", "text");
  });

  it("asks first, then makes the file for the chosen name and writes it", async () => {
    const chosen = handle("spring.felupe.zip");
    const picker = vi.fn(async () => chosen.file);
    const download = vi.fn();
    const make = vi.fn(async (name: string) => new Blob([name]));
    const save = saver({ picker, download });
    const saved = await save(
      { name: "untitled.felupe.zip", kind: "project" },
      make,
    );
    expect(picker).toHaveBeenCalledWith(
      pickerOptions("untitled.felupe.zip", "project"),
    );
    // the dialog before the file is made, e.g. the script of an archive
    expect(picker.mock.invocationCallOrder[0]).toBeLessThan(
      make.mock.invocationCallOrder[0],
    );
    expect(make).toHaveBeenCalledWith("spring.felupe.zip");
    expect(await (chosen.written[0] as Blob).text()).toBe("spring.felupe.zip");
    expect(saved).toEqual({ name: "spring.felupe.zip", handle: chosen.file });
    expect(download).not.toHaveBeenCalled();
  });

  it("writes into a file of an earlier save without the dialog", async () => {
    const chosen = handle("spring.felupe.json");
    const picker = vi.fn();
    const save = saver({ picker, download: vi.fn() });
    const saved = await save(
      { name: "spring.felupe.json", kind: "project", into: chosen.file },
      () => "{}",
    );
    expect(picker).not.toHaveBeenCalled();
    expect(chosen.written).toEqual(["{}"]);
    expect(saved?.handle).toBe(chosen.file);
  });

  it("saves nothing and has no error after Cancel", async () => {
    const make = vi.fn(() => "text");
    const download = vi.fn();
    const save = saver({
      picker: async () => {
        throw cancel();
      },
      download,
    });
    expect(await save({ name: "a.py", kind: "export" }, make)).toBeUndefined();
    expect(make).not.toHaveBeenCalled();
    expect(download).not.toHaveBeenCalled();
  });

  it("throws the other errors of the dialog", async () => {
    const save = saver({
      picker: async () => {
        throw new TypeError("Invalid type: .felupe");
      },
      download: vi.fn(),
    });
    await expect(
      save({ name: "a.py", kind: "export" }, () => "text"),
    ).rejects.toThrow("Invalid type");
  });

  it("ignores a save while the dialog of another one is open", async () => {
    const chosen = handle("a.py");
    let choose: (file: SaveHandle) => void = () => {};
    const picker = vi.fn(
      () => new Promise<SaveHandle>((resolve) => (choose = resolve)),
    );
    const download = vi.fn();
    const save = saver({ picker, download });
    // e.g. a double click: the browser would refuse the second dialog
    const first = save({ name: "a.py", kind: "export" }, () => "text");
    expect(
      await save({ name: "a.py", kind: "export" }, () => "text"),
    ).toBeUndefined();
    choose(chosen.file);
    expect(await first).toEqual({ name: "a.py", handle: chosen.file });
    expect(picker).toHaveBeenCalledTimes(1);
    expect(download).not.toHaveBeenCalled();
    // the next save asks again
    const next = save({ name: "b.py", kind: "export" }, () => "text");
    await vi.waitFor(() => expect(picker).toHaveBeenCalledTimes(2));
    choose(chosen.file);
    await next;
  });
  it("does not write a file that cannot be made", async () => {
    const chosen = handle("bushing.felupe.zip");
    const save = saver({ picker: async () => chosen.file, download: vi.fn() });
    await expect(
      save({ name: "bushing.felupe.zip", kind: "project" }, async () => {
        throw new Error("The script failed.");
      }),
    ).rejects.toThrow("The script failed.");
    expect(chosen.file.createWritable).not.toHaveBeenCalled();
    expect(chosen.written).toEqual([]);
  });

  it("aborts a file that cannot be written", async () => {
    const full = new DOMException("The disk is full.", "QuotaExceededError");
    const chosen = handle("a.vtu", full);
    const save = saver({ picker: async () => chosen.file, download: vi.fn() });
    await expect(
      save({ name: "a.vtu", kind: "export" }, () => "<VTKFile/>"),
    ).rejects.toThrow("The disk is full.");
    expect(chosen.abort).toHaveBeenCalledWith(full);
  });
});

describe("a save dialog that the browser refuses (#439)", () => {
  const refused = () =>
    new DOMException(
      "The request is not allowed by the user agent or the platform in the current context.",
      "NotAllowedError",
    );

  it("downloads the file, and the next ones without the dialog", async () => {
    const picker = vi.fn(async (): Promise<SaveHandle> => {
      throw refused();
    });
    const download = vi.fn();
    const onRefused = vi.fn();
    const save = saver({ picker, download, onRefused });
    expect(
      await save({ name: "radial.csv", kind: "export" }, () => "x,y"),
    ).toEqual({ name: "radial.csv" });
    expect(download).toHaveBeenCalledWith("radial.csv", "x,y");
    expect(onRefused).toHaveBeenCalledTimes(1);
    // the next save downloads at once, and tells it no more
    expect(
      await save({ name: "spring.felupe.json", kind: "project" }, () => "{}"),
    ).toEqual({ name: "spring.felupe.json" });
    expect(download).toHaveBeenLastCalledWith("spring.felupe.json", "{}");
    expect(picker).toHaveBeenCalledTimes(1);
    expect(onRefused).toHaveBeenCalledTimes(1);
  });

  it("downloads a file of a dialog without the click of the user", async () => {
    const chosen = handle("b.py");
    const picker = vi
      .fn<() => Promise<SaveHandle>>()
      .mockRejectedValueOnce(
        new DOMException(
          "Must be handling a user gesture to show a file picker.",
          "SecurityError",
        ),
      )
      .mockResolvedValueOnce(chosen.file);
    const download = vi.fn();
    const onRefused = vi.fn();
    const save = saver({ picker, download, onRefused });
    expect(await save({ name: "a.py", kind: "export" }, () => "text")).toEqual({
      name: "a.py",
    });
    expect(download).toHaveBeenCalledWith("a.py", "text");
    expect(onRefused).not.toHaveBeenCalled();
    // the dialog stays: the next click opens it
    expect(await save({ name: "b.py", kind: "export" }, () => "text")).toEqual({
      name: "b.py",
      handle: chosen.file,
    });
  });
});

describe("the file of an earlier save (#439)", () => {
  /** A file of an earlier save with the permission of the browser to write. */
  function earlier(
    permission: "granted" | "prompt",
    asked: "granted" | "denied",
  ) {
    const chosen = handle("spring.felupe.json");
    const file: SaveHandle = {
      ...chosen.file,
      queryPermission: vi.fn(async () => permission),
      requestPermission: vi.fn(async () => asked),
    };
    return { ...chosen, file };
  }

  it("is written into while the app may", async () => {
    const chosen = earlier("granted", "denied");
    const save = saver({ picker: vi.fn(), download: vi.fn() });
    await save(
      { name: "spring.felupe.json", kind: "project", into: chosen.file },
      () => "{}",
    );
    expect(chosen.written).toEqual(["{}"]);
    expect(chosen.file.requestPermission).not.toHaveBeenCalled();
  });

  it("asks for the permission again before the file is made", async () => {
    const chosen = earlier("prompt", "granted");
    const make = vi.fn(() => "{}");
    const save = saver({ picker: vi.fn(), download: vi.fn() });
    await save(
      { name: "spring.felupe.json", kind: "project", into: chosen.file },
      make,
    );
    expect(chosen.file.requestPermission).toHaveBeenCalledWith({
      mode: "readwrite",
    });
    // while the click of the user still counts
    expect(
      vi.mocked(chosen.file.requestPermission!).mock.invocationCallOrder[0],
    ).toBeLessThan(make.mock.invocationCallOrder[0]);
    expect(chosen.written).toEqual(["{}"]);
  });

  it("is saved with the dialog again without the permission", async () => {
    const chosen = earlier("prompt", "denied");
    const other = handle("spring-2.felupe.json");
    const picker = vi.fn(async () => other.file);
    const save = saver({ picker, download: vi.fn() });
    const saved = await save(
      { name: "spring.felupe.json", kind: "project", into: chosen.file },
      () => "{}",
    );
    expect(picker).toHaveBeenCalledWith(
      pickerOptions("spring.felupe.json", "project"),
    );
    expect(saved).toEqual({ name: "spring-2.felupe.json", handle: other.file });
    expect(chosen.written).toEqual([]);
    expect(other.written).toEqual(["{}"]);
  });
});

describe("the save dialog of the browser (#400)", () => {
  afterEach(() => {
    delete (globalThis as { showSaveFilePicker?: unknown }).showSaveFilePicker;
  });

  it("is found by feature detection", async () => {
    expect(systemPicker()).toBeUndefined();
    const chosen = handle("a.py");
    const browser = globalThis as { showSaveFilePicker?: unknown };
    browser.showSaveFilePicker = vi.fn(async function (this: unknown) {
      // called as a method of the window
      expect(this).toBe(globalThis);
      return chosen.file;
    });
    const picker = systemPicker()!;
    expect(await picker(pickerOptions("a.py", "export"))).toBe(chosen.file);
    expect(browser.showSaveFilePicker).toHaveBeenCalledWith(
      pickerOptions("a.py", "export"),
    );
  });
});
