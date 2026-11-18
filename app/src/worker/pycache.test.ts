import { describe, expect, it, vi } from "vitest";
import {
  CACHE,
  type CacheFS,
  REFIX_SOURCE,
  cacheKey,
  enableSource,
  openCache,
  persister,
} from "./pycache";

const DIR = 0o040000;

/** A file system of paths, with the stored state of IndexedDB. */
function fakeFS(stored: string[] = [], fail = false) {
  const files = new Set<string>();
  const dirs = new Set<string>(["/"]);
  const fs: CacheFS & { files: Set<string>; dirs: Set<string> } = {
    files,
    dirs,
    filesystems: { IDBFS: "IDBFS" },
    mkdirTree: (path) => void dirs.add(path),
    mount: vi.fn(),
    syncfs: vi.fn((populate: boolean, callback: (e: unknown) => void) => {
      if (fail) return callback(new Error("QuotaExceededError"));
      if (populate)
        for (const path of stored) {
          const parts = path.split("/");
          for (let i = 2; i < parts.length; i++)
            dirs.add(parts.slice(0, i).join("/"));
          files.add(path);
        }
      setTimeout(() => callback(null), 0);
    }),
    readdir: (path) => {
      const names = new Set<string>();
      for (const p of [...files, ...dirs])
        if (p.startsWith(`${path}/`))
          names.add(p.slice(path.length + 1).split("/")[0]);
      return [".", "..", ...names];
    },
    stat: (path) => ({ mode: dirs.has(path) ? DIR : 0o100000 }),
    isDir: (mode) => (mode & DIR) === DIR,
    unlink: (path) => void files.delete(path),
    rmdir: (path) => void dirs.delete(path),
  };
  return fs;
}

describe("cacheKey", () => {
  const sources = { "a.py": "x = 1", "b.py": "y = 2" };
  const key = cacheKey(
    "314.0.7",
    ["wheels/felupe-12.1.0-py3-none-any.whl"],
    sources,
  );

  it("starts with the version of Pyodide and is stable", () => {
    expect(key).toMatch(/^314\.0\.7-[0-9a-f]{14}$/);
    expect(
      cacheKey("314.0.7", ["wheels/felupe-12.1.0-py3-none-any.whl"], {
        "b.py": "y = 2",
        "a.py": "x = 1",
      }),
    ).toBe(key);
  });

  it("changes with a wheel or a source", () => {
    const wheel = ["wheels/felupe-12.2.0-py3-none-any.whl"];
    expect(cacheKey("314.0.7", wheel, sources)).not.toBe(key);
    const source = { ...sources, "b.py": "y = 3" };
    expect(
      cacheKey("314.0.7", ["wheels/felupe-12.1.0-py3-none-any.whl"], source),
    ).not.toBe(key);
  });
});

describe("openCache", () => {
  it("is off without IndexedDB", async () => {
    const fs = fakeFS();
    expect(await openCache(fs, "k", undefined)).toBe("off");
    expect(fs.mount).not.toHaveBeenCalled();
  });

  it("is empty at the first start", async () => {
    const fs = fakeFS();
    expect(await openCache(fs, "k", {})).toBe("empty");
    expect(fs.mount).toHaveBeenCalledWith("IDBFS", {}, CACHE);
  });

  it("is a hit with the folder of the key, and removes the other keys", async () => {
    const fs = fakeFS([
      `${CACHE}/k/lib/numpy/__pycache__/__init__.cpython-314.pyc`,
      `${CACHE}/old/lib/numpy/__pycache__/__init__.cpython-314.pyc`,
    ]);
    expect(await openCache(fs, "k", {})).toBe("hit");
    expect([...fs.files]).toEqual([
      `${CACHE}/k/lib/numpy/__pycache__/__init__.cpython-314.pyc`,
    ]);
    expect(fs.readdir(CACHE)).toEqual([".", "..", "k"]);
  });

  it("is off if IndexedDB fails", async () => {
    expect(await openCache(fakeFS([], true), "k", {})).toBe("off");
  });
});

describe("persister", () => {
  it("writes once at a time, and once more for a request during a write", async () => {
    const fs = fakeFS();
    const persist = persister(fs);
    await Promise.all([persist(), persist(), persist()]);
    // the first write, and one more for the requests during it
    expect(fs.syncfs).toHaveBeenCalledTimes(2);
    expect(fs.syncfs).toHaveBeenCalledWith(false, expect.any(Function));
    await persist();
    expect(fs.syncfs).toHaveBeenCalledTimes(3);
  });

  it("ignores errors, e.g. a full quota", async () => {
    await expect(persister(fakeFS([], true))()).resolves.toBeUndefined();
  });
});

describe("the Python of the cache", () => {
  it("loads the helper without the package and enables the folder of the key", () => {
    const source = enableSource("/home/pyodide", "314.0.7-abc");
    expect(source).toContain(
      'spec_from_file_location("felupe_studio_bytecode", "/home/pyodide/felupe_studio/bytecode.py")',
    );
    expect(source).toContain(
      'bytecode.fix_mtimes(sysconfig.get_paths()["purelib"], "/home/pyodide/felupe_studio")',
    );
    expect(source).toContain(`bytecode.enable("${CACHE}/314.0.7-abc")`);
    expect(source).not.toContain("import felupe_studio");
    expect(REFIX_SOURCE).toContain(
      'if "felupe_studio_bytecode" in sys.modules:',
    );
  });
});
