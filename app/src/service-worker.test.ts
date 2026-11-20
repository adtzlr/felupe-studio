import { describe, expect, it, vi } from "vitest";
import ci from "../../.github/workflows/ci.yml?raw";
import source from "../public/sw.js?raw";

const SCOPE = "https://adtzlr.github.io/felupe-studio/";
const PYODIDE = "https://cdn.jsdelivr.net/pyodide/v314.0.7/full/";

type Sw = {
  runtimeFile: (
    url: string,
    scope: string,
  ) => { family: string; version: string } | undefined;
  cacheFirst: (
    request: Request,
    file: { family: string; version: string },
  ) => Promise<Response>;
  listeners: Record<string, (event: unknown) => void>;
};

/** Run public/sw.js with a fake service worker scope and cache storage. */
function load(cached: Record<string, string> = {}) {
  const store = new Map(
    Object.entries(cached).map(([url, body]) => [url, new Response(body)]),
  );
  const cache = {
    match: vi.fn(async (request: Request) => store.get(request.url)?.clone()),
    put: vi.fn(
      async (request: Request, response: Response) =>
        void store.set(request.url, response),
    ),
    keys: vi.fn(async () => [...store.keys()].map((url) => new Request(url))),
    delete: vi.fn(async (request: Request) => store.delete(request.url)),
  };
  const fetch = vi.fn(
    async (request: Request) => new Response(`fetched ${request.url}`),
  );
  const listeners: Sw["listeners"] = {};
  const self = {
    registration: { scope: SCOPE },
    listeners,
    addEventListener: (type: string, listener: (event: unknown) => void) => {
      listeners[type] = listener;
    },
  } as unknown as Sw;
  new Function("self", "caches", "fetch", source)(
    self,
    { open: async () => cache },
    fetch,
  );
  return { sw: self, store, fetch };
}

describe("service worker", () => {
  it("caches Pyodide and the wheels of the app only", () => {
    const { sw } = load();
    expect(sw.runtimeFile(`${PYODIDE}pyodide.asm.wasm`, SCOPE)).toEqual({
      family: "pyodide",
      version: "v314.0.7",
    });
    expect(
      sw.runtimeFile(`${SCOPE}wheels/felupe-12.0.0-py3-none-any.whl`, SCOPE),
    ).toEqual({
      family: "wheel:felupe",
      version: "12.0.0",
    });
    expect(sw.runtimeFile(`${SCOPE}index.html`, SCOPE)).toBeUndefined();
    expect(
      sw.runtimeFile("https://other.org/wheels/x-1-py3-none-any.whl", SCOPE),
    ).toBeUndefined();
    expect(
      sw.runtimeFile("https://cdn.jsdelivr.net/npm/other", SCOPE),
    ).toBeUndefined();
    expect(Object.keys(sw.listeners).sort()).toEqual([
      "activate",
      "fetch",
      "install",
    ]);
  });

  it("answers from the cache and fetches only on a miss", async () => {
    const url = `${PYODIDE}pyodide.mjs`;
    const { sw, fetch } = load({ [url]: "cached" });
    const file = sw.runtimeFile(url, SCOPE)!;
    expect(await (await sw.cacheFirst(new Request(url), file)).text()).toBe(
      "cached",
    );
    expect(fetch).not.toHaveBeenCalled();

    const wasm = `${PYODIDE}pyodide.asm.wasm`;
    expect(await (await sw.cacheFirst(new Request(wasm), file)).text()).toBe(
      `fetched ${wasm}`,
    );
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("removes other versions of a file family", async () => {
    const old = "https://cdn.jsdelivr.net/pyodide/v0.29.0/full/pyodide.mjs";
    const oldWheel = `${SCOPE}wheels/felupe-11.0.0-py3-none-any.whl`;
    const { sw, store } = load({ [old]: "old", [oldWheel]: "old wheel" });
    const url = `${PYODIDE}pyodide.mjs`;
    await sw.cacheFirst(new Request(url), sw.runtimeFile(url, SCOPE)!);
    expect([...store.keys()].sort()).toEqual([url, oldWheel].sort());
  });
});

describe("the cache of a brand (ADR 0020)", () => {
  /** Activate public/sw.js, registered with this URL, among these caches. */
  async function activate(href: string | undefined, names: string[]) {
    const opened: string[] = [];
    const deleted: string[] = [];
    const listeners: Record<string, (event: unknown) => void> = {};
    const self = {
      ...(href ? { location: { href } } : {}),
      registration: { scope: SCOPE },
      clients: { claim: async () => {} },
      skipWaiting: () => {},
      addEventListener: (type: string, listener: (event: unknown) => void) => {
        listeners[type] = listener;
      },
    } as unknown as Sw & { cacheFirst: Sw["cacheFirst"] };
    const caches = {
      open: async (name: string) => {
        opened.push(name);
        return {
          match: async () => undefined,
          put: async () => {},
          keys: async () => [],
        };
      },
      keys: async () => names,
      delete: async (name: string) => void deleted.push(name),
    };
    new Function("self", "caches", "fetch", source)(
      self,
      caches,
      async () => new Response(""),
    );
    let done: Promise<unknown> = Promise.resolve();
    listeners.activate({ waitUntil: (p: Promise<unknown>) => (done = p) });
    await done;
    const url = `${PYODIDE}pyodide.mjs`;
    await self.cacheFirst(new Request(url), {
      family: "pyodide",
      version: "v1",
    });
    return { opened, deleted };
  }

  const names = [
    "felupe-studio-runtime-v0",
    "felupe-studio-runtime-v1",
    "acme-runtime-v0",
    "acme-runtime-v1",
  ];

  it("is that of FElupe Studio without a prefix in the URL", async () => {
    const { opened, deleted } = await activate(`${SCOPE}sw.js`, names);
    expect(opened).toEqual(["felupe-studio-runtime-v1"]);
    expect(deleted).toEqual(["felupe-studio-runtime-v0"]);
  });

  it("has the prefix of the brand, and keeps the caches of other brands", async () => {
    const { opened, deleted } = await activate(
      `${SCOPE}sw.js?storage=acme`,
      names,
    );
    expect(opened).toEqual(["acme-runtime-v1"]);
    expect(deleted).toEqual(["acme-runtime-v0"]);
  });
});

describe("pinned FElupe version", () => {
  it("is the same in the app and in CI", () => {
    expect(ci).toContain(`FELUPE_VERSION: "${__FELUPE_VERSION__}"`);
  });
});
