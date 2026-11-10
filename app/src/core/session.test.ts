import { IDBFactory, IDBObjectStore } from "fake-indexeddb";
import { describe, expect, it, vi } from "vitest";
import {
  hashOf,
  IndexedDBSession,
  keep,
  type Session,
  type SessionStorage,
} from "./session";

const bytes = (...values: number[]) => new Uint8Array(values);

const session = (files: Session["files"]): Session => ({
  project: '{"schema_version": 1, "commands": []}',
  fileName: "bar.felupe.json",
  modified: true,
  files,
});

describe("session", () => {
  it("hashes the content of files", async () => {
    expect(await hashOf(bytes())).toBe(
      "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    );
    expect(await hashOf(bytes(1))).not.toBe(await hashOf(bytes(2)));
  });

  it("keeps the last session with its mesh files", async () => {
    const factory = new IDBFactory();
    const storage = new IndexedDBSession(factory);
    expect(await storage.load()).toBeUndefined();

    await storage.save(
      session([
        { name: "bar.vtu", data: bytes(1, 2, 3) },
        { name: "plate.msh", data: bytes(4) },
      ]),
    );
    // a new page (a new connection) restores it
    const restored = await new IndexedDBSession(factory).load();
    expect(restored).toEqual(
      session([
        { name: "bar.vtu", data: bytes(1, 2, 3) },
        { name: "plate.msh", data: bytes(4) },
      ]),
    );

    // a file that is not in the session any more is removed, a changed one written
    await storage.save({
      ...session([{ name: "bar.vtu", data: bytes(9) }]),
      modified: false,
    });
    expect(await storage.load()).toEqual({
      ...session([{ name: "bar.vtu", data: bytes(9) }]),
      modified: false,
    });
    const keys = await new Promise<IDBValidKey[]>((resolve) => {
      const request = factory.open("felupe-studio", 1);
      request.onsuccess = () => {
        const all = request.result
          .transaction("files")
          .objectStore("files")
          .getAllKeys();
        all.onsuccess = () => resolve(all.result);
      };
    });
    expect(keys).toEqual(["bar.vtu"]);

    await storage.clear();
    expect(await storage.load()).toBeUndefined();
  });

  it("does not write unchanged files again", async () => {
    const storage = new IndexedDBSession(new IDBFactory());
    const files = [{ name: "bar.vtu", data: bytes(1, 2, 3) }];
    await storage.save(session(files));
    const put = vi.spyOn(IDBObjectStore.prototype, "put");
    await storage.save({ ...session(files), fileName: "renamed.felupe.json" });
    // only the record of the session
    expect(put).toHaveBeenCalledTimes(1);
    put.mockRestore();
    expect((await storage.load())?.fileName).toBe("renamed.felupe.json");
  });

  it("keeps the project without its files if they do not fit", async () => {
    const saved: Session[] = [];
    const full: SessionStorage = {
      load: async () => undefined,
      clear: async () => {},
      save: async (s) => {
        if (s.files.length)
          throw new DOMException("full", "QuotaExceededError");
        saved.push(s);
      },
    };
    const files = [{ name: "bar.vtu", data: bytes(1) }];
    expect(await keep(full, session(files))).toBe("project");
    expect(saved).toEqual([session([])]);
    expect(await keep(full, session([]))).toBe("all");
    const broken: SessionStorage = {
      ...full,
      save: async () => {
        throw new Error("blocked");
      },
    };
    await expect(keep(broken, session([]))).rejects.toThrow("blocked");
  });
});
