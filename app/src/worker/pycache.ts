// The bytecode cache of the Pyodide worker (ADR 0017): Python writes the bytecode of
// the imported modules below a folder of IndexedDB (IDBFS) and reads it on the next
// start, instead of compiling the sources of NumPy, SciPy, FElupe, meshio and
// felupe_studio again. The cache is optional: without IndexedDB or with an error of
// it, the worker starts without it.

/** The folder of the cache in the file system of Pyodide, mounted from IndexedDB. */
export const CACHE = "/pycache";

/** The cache at the start: bytecode found, none yet, or not available. */
export type CacheState = "hit" | "empty" | "off";

/** The part of the file system of Emscripten that the cache uses. */
export interface CacheFS {
  filesystems: { IDBFS: unknown };
  mkdirTree(path: string): void;
  mount(type: unknown, options: object, mountpoint: string): unknown;
  syncfs(populate: boolean, callback: (error: unknown) => void): void;
  readdir(path: string): string[];
  stat(path: string): { mode: number };
  isDir(mode: number): boolean;
  unlink(path: string): void;
  rmdir(path: string): void;
}

/** A 53-bit hash of a string (cyrb53), as 14 hexadecimal digits. */
function hash(text: string): string {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 2654435761);
    h2 = Math.imul(h2 ^ c, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507);
  h1 ^= Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507);
  h2 ^= Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0))
    .toString(16)
    .padStart(14, "0");
}

/**
 * The key of the bytecode: the version of Pyodide, the wheels (their URLs with the
 * versions) and the sources of felupe_studio. Another version of any of them gets
 * another folder, so a `.pyc` file never belongs to another source.
 */
export function cacheKey(
  pyodide: string,
  wheels: string[],
  sources: Record<string, string>,
): string {
  const files = Object.keys(sources)
    .sort()
    .map((path) => [path, sources[path]]);
  return `${pyodide}-${hash(JSON.stringify({ wheels, files }))}`;
}

function sync(fs: CacheFS, populate: boolean): Promise<void> {
  return new Promise((resolve, reject) =>
    fs.syncfs(populate, (error) => (error ? reject(error) : resolve())),
  );
}

function removeTree(fs: CacheFS, path: string): void {
  if (fs.isDir(fs.stat(path).mode)) {
    for (const name of fs.readdir(path))
      if (name !== "." && name !== "..") removeTree(fs, `${path}/${name}`);
    fs.rmdir(path);
  } else fs.unlink(path);
}

/**
 * Mount the cache and read it from IndexedDB. The folders of other keys are
 * removed (from IndexedDB with the next {@link persist}).
 */
export async function openCache(
  fs: CacheFS,
  key: string,
  indexedDB: unknown = globalThis.indexedDB,
): Promise<CacheState> {
  if (!indexedDB) return "off";
  try {
    fs.mkdirTree(CACHE);
    fs.mount(fs.filesystems.IDBFS, {}, CACHE);
    await sync(fs, true);
    const names = fs.readdir(CACHE).filter((n) => n !== "." && n !== "..");
    for (const name of names)
      if (name !== key) removeTree(fs, `${CACHE}/${name}`);
    return names.includes(key) ? "hit" : "empty";
  } catch {
    return "off";
  }
}

/**
 * Write the cache back to IndexedDB, at most one write at a time: a request during
 * a write writes once more afterwards. Errors are ignored (e.g. a full quota).
 */
export function persister(fs: CacheFS): () => Promise<void> {
  let running: Promise<void> | undefined;
  let again = false;
  const write = async (): Promise<void> => {
    if (running) {
      again = true;
      return running;
    }
    running = (async () => {
      do {
        again = false;
        try {
          await sync(fs, false);
        } catch {
          // the cache is optional
        }
      } while (again);
    })();
    try {
      await running;
    } finally {
      running = undefined;
    }
  };
  return write;
}

/**
 * The Python of the worker that enables the cache below the folder of the key: the
 * sources of the packages and of felupe_studio get a fixed modification time.
 */
export function enableSource(home: string, key: string): string {
  return [
    // without the package: its __init__ would import modules before the cache
    "import importlib.util, sys, sysconfig",
    `spec = importlib.util.spec_from_file_location("felupe_studio_bytecode", "${home}/felupe_studio/bytecode.py")`,
    "bytecode = importlib.util.module_from_spec(spec)",
    "spec.loader.exec_module(bytecode)",
    'sys.modules["felupe_studio_bytecode"] = bytecode',
    `bytecode.fix_mtimes(sysconfig.get_paths()["purelib"], "${home}/felupe_studio")`,
    `bytecode.enable("${CACHE}/${key}")`,
    "del spec, bytecode",
  ].join("\n");
}

/**
 * The Python that fixes the modification times of the packages again, after a
 * wheel was loaded later (e.g. tensortrax), if the cache is enabled.
 */
export const REFIX_SOURCE = [
  "import sys, sysconfig",
  'if "felupe_studio_bytecode" in sys.modules:',
  '    sys.modules["felupe_studio_bytecode"].fix_mtimes(sysconfig.get_paths()["purelib"])',
].join("\n");
