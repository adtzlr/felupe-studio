// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import { RuntimeClient } from "./client";
import { encodeFrame } from "./frames";
import {
  CLOSED,
  isLocal,
  LocalChannel,
  runtimeUrl,
  takeToken,
  TOKEN_KEY,
} from "./local";
import type { FromWorker } from "./protocol";

/** A WebSocket of a test: the frames sent, and the frames of the server. */
class FakeSocket extends EventTarget {
  static OPEN = 1;
  readyState = 0;
  binaryType = "blob";
  sent: (string | ArrayBuffer)[] = [];
  closed = false;
  constructor(readonly url: string) {
    super();
  }
  send(frame: string | ArrayBuffer) {
    this.sent.push(frame);
  }
  open() {
    this.readyState = 1;
    this.dispatchEvent(new Event("open"));
  }
  /** A message of the server, encoded like by Python. */
  receive(message: unknown) {
    this.dispatchEvent(
      new MessageEvent("message", { data: encodeFrame(message) }),
    );
  }
  close() {
    this.closed = true;
    this.readyState = 3;
    this.dispatchEvent(new Event("close"));
  }
}

const f32 = (...x: number[]) => new Uint8Array(new Float32Array(x).buffer);
const u32 = (...x: number[]) => new Uint8Array(new Uint32Array(x).buffer);

const ready = {
  type: "ready",
  versions: {
    python: "3.13.1",
    felupe: "12.1.0",
    numpy: "2",
    scipy: "1",
    felupe_studio: "0.5.0",
    runtime: "python",
  },
  timings: { pyodide: 0, packages: 0, felupe: 900, total: 900 },
};

function connect() {
  const sockets: FakeSocket[] = [];
  const channel = () =>
    new LocalChannel("ws://127.0.0.1:8765/runtime?token=t", (url) => {
      const socket = new FakeSocket(url);
      sockets.push(socket);
      return socket as unknown as WebSocket;
    });
  const client = new RuntimeClient(channel, "http://127.0.0.1:8765/", true);
  return { client, sockets, socket: () => sockets[sockets.length - 1] };
}

describe("the local runtime (#240)", () => {
  it("is the runtime of a page with its meta tag", () => {
    const doc = document.implementation.createHTMLDocument("app");
    expect(isLocal(doc)).toBe(false);
    const meta = doc.createElement("meta");
    meta.name = "felupe-studio-runtime";
    meta.content = "python";
    doc.head.append(meta);
    expect(isLocal(doc)).toBe(true);
  });

  it("takes the token from the address and keeps it for the tab", () => {
    const storage = new Map<string, string>();
    const store = {
      setItem: (k: string, v: string) => storage.set(k, v),
      getItem: (k: string) => storage.get(k) ?? null,
    } as unknown as Storage;
    const replaced: string[] = [];
    const history = {
      state: null,
      replaceState: (_: unknown, __: string, url: string) => replaced.push(url),
    } as unknown as History;
    const at = (href: string) => ({ href }) as Location;
    expect(
      takeToken(at("http://127.0.0.1:8765/?token=a%2Bb#x"), history, store),
    ).toBe("a+b");
    expect(replaced).toEqual(["http://127.0.0.1:8765/#x"]);
    expect(storage.get(TOKEN_KEY)).toBe("a+b");
    // after a reload, without the token in the address
    expect(takeToken(at("http://127.0.0.1:8765/"), history, store)).toBe("a+b");
    expect(
      runtimeUrl(
        { protocol: "http:", host: "localhost:8765" } as Location,
        "a+b",
      ),
    ).toBe("ws://localhost:8765/runtime?token=a%2Bb");
  });

  it("talks to the process like to the worker", async () => {
    const { client, socket } = connect();
    expect(socket().url).toBe("ws://127.0.0.1:8765/runtime?token=t");
    expect(socket().binaryType).toBe("arraybuffer");
    // init is not sent: the process loads Python itself
    socket().open();
    expect(socket().sent).toEqual([]);
    socket().receive(ready);
    expect((await client.ready).versions.runtime).toBe("python");
    expect(client.local).toBe(true);

    // a file as a binary frame, a mesh with typed arrays
    const written = client.writeFile("cube.vtu", new Uint8Array([1, 2]));
    await Promise.resolve();
    await Promise.resolve();
    expect(socket().sent.at(-1)).toBeInstanceOf(ArrayBuffer);
    socket().receive({ type: "done", id: 1 });
    await written;
    const inspected = client.inspectMesh("cube.vtu");
    await new Promise((r) => setTimeout(r));
    socket().receive({
      type: "mesh-info",
      id: 2,
      info: { file: "cube.vtu", points: 3 },
      surfaces: {
        hexahedron: {
          positions: f32(0, 1, 2),
          triangles: u32(0, 1, 2),
          edges: u32(0, 1),
          owners: u32(0),
          faces: null,
          cells: 1,
        },
      },
    });
    const { info, surfaces } = await inspected;
    expect(info.points).toBe(3);
    expect(surfaces.hexahedron.positions).toBeInstanceOf(Float32Array);
    expect([...surfaces.hexahedron.triangles]).toEqual([0, 1, 2]);

    // a live scene and the bytes of an export
    const events: unknown[] = [];
    const run = client.run("{}", (event) => events.push(event));
    await new Promise((r) => setTimeout(r));
    const scene = {
      job: "job",
      substep: 1,
      surfaces: [
        {
          name: "body",
          positions: f32(0, 0, 0),
          displacement: f32(0, 0, 0),
          triangles: u32(0, 0, 0),
          edges: u32(0, 0),
          values: f32(1),
          owners: u32(0),
          nodes: u32(0),
        },
      ],
    };
    socket().receive({
      type: "job-progress",
      id: 3,
      event: { event: "live", scene },
    });
    socket().receive({ type: "job-result", id: 3, results: {} });
    await run;
    const live = events[0] as { scene: { surfaces: { values: unknown }[] } };
    expect(live.scene.surfaces[0].values).toBeInstanceOf(Float32Array);
    const exported = client.exportResults("job", "vtu");
    await new Promise((r) => setTimeout(r));
    socket().receive({ type: "bytes", id: 4, data: new Uint8Array([7, 8]) });
    expect([...(await exported)]).toEqual([7, 8]);
  });

  it("cancels by a new connection, with the files written again", async () => {
    const { client, sockets, socket } = connect();
    socket().open();
    socket().receive(ready);
    await client.ready;
    const written = client.writeFile("cube.vtu", new Uint8Array([1]));
    await new Promise((r) => setTimeout(r));
    socket().receive({ type: "done", id: 1 });
    await written;
    const first = socket();
    client.restart();
    expect(first.closed).toBe(true);
    expect(sockets).toHaveLength(2);
    socket().open();
    socket().receive(ready);
    await new Promise((r) => setTimeout(r));
    // the file again, in the new process
    expect(socket().sent).toHaveLength(1);
  });

  it("says when the runtime is gone", async () => {
    const { client, socket } = connect();
    let restarts = 0;
    client.onRestart(() => restarts++);
    // before ready: it does not start
    socket().close();
    await expect(client.ready).rejects.toThrow(CLOSED);

    const later = connect();
    later.client.onRestart(() => restarts++);
    later.socket().open();
    later.socket().receive(ready);
    await later.client.ready;
    const pending = later.client.script("{}");
    await new Promise((r) => setTimeout(r));
    later.socket().close();
    // a pending request, and the runtime is not ready any more
    await expect(pending).rejects.toThrow(CLOSED);
    await expect(later.client.ready).rejects.toThrow(CLOSED);
    expect(restarts).toBe(1);
  });

  it("passes the other messages on", () => {
    const channel = new LocalChannel("ws://x", (url) => {
      const socket = new FakeSocket(url);
      queueMicrotask(() => socket.receive({ type: "text", id: 1, text: "a" }));
      return socket as unknown as WebSocket;
    });
    return new Promise<void>((resolve) =>
      channel.addEventListener("message", (event) => {
        expect(event.data).toEqual({
          type: "text",
          id: 1,
          text: "a",
        } satisfies FromWorker);
        resolve();
      }),
    );
  });
});
