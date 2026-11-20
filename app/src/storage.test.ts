// The storage of the default brand (ADR 0020): the names of today, so the settings
// and the sessions of existing users stay and nothing is migrated.
import { IDBFactory } from "fake-indexeddb";
import { describe, expect, it, vi } from "vitest";
import { bytecodeCache, storageKey, storagePrefix } from "./brand";
import { IndexedDBSession } from "./core/session";
import { workerUrl } from "./service-worker";
import { CACHE } from "./worker/pycache";
import { TOKEN_KEY } from "./worker/local";

describe("the storage of FElupe Studio, the default brand", () => {
  it("has the names of today", async () => {
    expect(storagePrefix()).toBe("felupe-studio");
    expect(storageKey("curve")).toBe("felupe-studio.curve");
    expect(TOKEN_KEY).toBe("felupe-studio.token");
    expect(bytecodeCache()).toBe("/pycache");
    expect(bytecodeCache()).toBe(CACHE);
    expect(workerUrl("https://adtzlr.github.io/felupe-studio/")).toBe(
      "https://adtzlr.github.io/felupe-studio/sw.js",
    );
    const factory = new IDBFactory();
    const open = vi.spyOn(factory, "open");
    await new IndexedDBSession(factory).load();
    expect(open).toHaveBeenCalledWith("felupe-studio", 1);
  });

  it("names the bytecode cache of another brand", () => {
    expect(bytecodeCache("acme")).toBe("/acme-pycache");
    expect(workerUrl("https://x.example/", "acme")).toBe(
      "https://x.example/sw.js?storage=acme",
    );
  });
});
