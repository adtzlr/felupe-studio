// The session of the app in the browser (#57): the current project (its text, file
// name and whether it has unsaved changes) and its mesh files, kept in IndexedDB so
// that a reload restores them. Only the last session is kept, and only in this
// browser. A full storage must not break the app: a failed write rejects, and the
// app keeps the project without its mesh files if they do not fit.

/** A mesh file of a session. */
export interface SessionFile {
  name: string;
  data: Uint8Array;
}

export interface Session {
  /** The text of the project file. */
  project: string;
  fileName: string;
  /** The project has changes that are not saved as a file. */
  modified: boolean;
  files: SessionFile[];
}

export interface SessionStorage {
  /** The last session, or none. */
  load(): Promise<Session | undefined>;
  /** Replace the last session; unchanged files are not written again. */
  save(session: Session): Promise<void>;
  clear(): Promise<void>;
}

/** The record of the session; the mesh files are records of their own. */
interface SessionRecord {
  project: string;
  fileName: string;
  modified: boolean;
  files: { name: string; size: number; hash: string }[];
  time: number;
}

const KEY = "current";

/** The SHA-256 hash of the content of a file, as hex digits. */
export async function hashOf(data: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", data as BufferSource);
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

const done = <T>(request: IDBRequest<T>) =>
  new Promise<T>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });

const finished = (transaction: IDBTransaction) =>
  new Promise<void>((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onabort = () =>
      reject(transaction.error ?? new Error("The storage was aborted."));
    transaction.onerror = () =>
      reject(transaction.error ?? new Error("The storage failed."));
  });

/** The session in IndexedDB: a store "session" and a store "files" (by name). */
export class IndexedDBSession implements SessionStorage {
  private database?: Promise<IDBDatabase>;

  constructor(
    private factory: IDBFactory = indexedDB,
    private name = "felupe-studio",
  ) {}

  private open(): Promise<IDBDatabase> {
    this.database ??= new Promise<IDBDatabase>((resolve, reject) => {
      const request = this.factory.open(this.name, 1);
      request.onupgradeneeded = () => {
        request.result.createObjectStore("session");
        request.result.createObjectStore("files");
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
      request.onblocked = () => reject(new Error("The storage is blocked."));
    });
    // a failed opening is tried again next time
    this.database.catch(() => (this.database = undefined));
    return this.database;
  }

  async load(): Promise<Session | undefined> {
    const db = await this.open();
    const transaction = db.transaction(["session", "files"], "readonly");
    const record = (await done(transaction.objectStore("session").get(KEY))) as
      SessionRecord | undefined;
    if (!record) return undefined;
    const files: SessionFile[] = [];
    for (const { name } of record.files) {
      const data = (await done(transaction.objectStore("files").get(name))) as
        Uint8Array | undefined;
      // a file that was not written (e.g. a full storage) is left out
      if (data) files.push({ name, data: new Uint8Array(data) });
    }
    return {
      project: record.project,
      fileName: record.fileName,
      modified: record.modified,
      files,
    };
  }

  async save(session: Session): Promise<void> {
    const hashes = await Promise.all(session.files.map((f) => hashOf(f.data)));
    const db = await this.open();
    const transaction = db.transaction(["session", "files"], "readwrite");
    const complete = finished(transaction);
    const sessions = transaction.objectStore("session");
    const files = transaction.objectStore("files");
    const previous = (await done(sessions.get(KEY))) as
      SessionRecord | undefined;
    const stored = new Map(previous?.files.map((f) => [f.name, f.hash]));
    session.files.forEach((file, i) => {
      if (stored.get(file.name) !== hashes[i]) files.put(file.data, file.name);
    });
    const names = new Set(session.files.map((f) => f.name));
    for (const name of stored.keys()) if (!names.has(name)) files.delete(name);
    sessions.put(
      {
        project: session.project,
        fileName: session.fileName,
        modified: session.modified,
        files: session.files.map((f, i) => ({
          name: f.name,
          size: f.data.byteLength,
          hash: hashes[i],
        })),
        time: Date.now(),
      } satisfies SessionRecord,
      KEY,
    );
    await complete;
  }

  async clear(): Promise<void> {
    const db = await this.open();
    const transaction = db.transaction(["session", "files"], "readwrite");
    const complete = finished(transaction);
    transaction.objectStore("session").clear();
    transaction.objectStore("files").clear();
    await complete;
  }
}

/**
 * Save a session; if it does not fit (e.g. a full storage), save the project without
 * its mesh files. Resolves with what was kept.
 */
export async function keep(
  storage: SessionStorage,
  session: Session,
): Promise<"all" | "project"> {
  try {
    await storage.save(session);
    return "all";
  } catch (error) {
    if (!session.files.length) throw error;
    await storage.save({ ...session, files: [] });
    return "project";
  }
}
