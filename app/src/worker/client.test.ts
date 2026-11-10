import { describe, expect, it, vi } from "vitest";
import { PyodideClient } from "./client";
import { safeName } from "./files";
import type { FromWorker, ToWorker } from "./protocol";

class FakeWorker extends EventTarget {
  sent: ToWorker[] = [];
  terminated = false;
  postMessage(message: ToWorker) {
    this.sent.push(message);
  }
  reply(message: FromWorker) {
    this.dispatchEvent(new MessageEvent("message", { data: message }));
  }
  terminate() {
    this.terminated = true;
  }
}

const ready: FromWorker = {
  type: "ready",
  versions: {
    python: "3.14.2",
    pyodide: "314.0.7",
    felupe: "12.0.0",
    numpy: "2",
    scipy: "1",
  },
  timings: { pyodide: 1, packages: 2, felupe: 3, total: 6 },
};

const start = () => {
  const worker = new FakeWorker();
  const client = new PyodideClient(
    worker as unknown as Worker,
    "https://example.org/app/",
  );
  return { worker, client };
};

describe("PyodideClient", () => {
  it("starts loading with the pinned versions and the wheels of the app", () => {
    const { worker } = start();
    expect(worker.sent).toEqual([
      {
        type: "init",
        pyodideVersion: __PYODIDE_VERSION__,
        wheels: [
          `https://example.org/app/wheels/felupe-${__FELUPE_VERSION__}-py3-none-any.whl`,
          "https://example.org/app/wheels/meshio-5.3.5-py3-none-any.whl",
        ],
      },
    ]);
  });

  it("resolves ready and runs benchmarks", async () => {
    const { worker, client } = start();
    worker.reply(ready);
    await expect(client.ready).resolves.toMatchObject({
      versions: { felupe: "12.0.0" },
    });

    const onResult = vi.fn();
    const onProgress = vi.fn();
    const run = client.benchmark([3, 5], onResult, onProgress);
    await vi.waitFor(() => expect(worker.sent).toHaveLength(2));
    expect(worker.sent[1]).toEqual({ type: "benchmark", id: 1, sizes: [3, 5] });

    const result = {
      n: 3,
      points: 27,
      cells: 8,
      dofs: 81,
      increments: 5,
      setup: 0,
      solve: 0,
      force: 1,
    };
    worker.reply({ type: "progress", id: 1, message: "Running n = 3 …" });
    worker.reply({ type: "benchmark-result", id: 1, result });
    worker.reply({ type: "benchmark-result", id: 99, result }); // other run: ignored
    worker.reply({ type: "done", id: 1 });
    await run;
    expect(onProgress).toHaveBeenCalledWith("Running n = 3 …");
    expect(onResult).toHaveBeenCalledTimes(1);
  });

  it("rejects a failed benchmark and a failed start", async () => {
    const { worker, client } = start();
    worker.reply(ready);
    const run = client.benchmark([3], () => {});
    await vi.waitFor(() => expect(worker.sent).toHaveLength(2));
    worker.reply({ type: "error", id: 1, message: "Traceback …" });
    await expect(run).rejects.toThrow("Traceback");

    const other = start();
    other.worker.reply({ type: "error", message: "CDN not reachable" });
    await expect(other.client.ready).rejects.toThrow("CDN not reachable");
    other.client.terminate();
    expect(other.worker.terminated).toBe(true);
  });
});

describe("files", () => {
  it("writes a copy of a file and inspects a mesh", async () => {
    const { worker, client } = start();
    worker.reply(ready);
    const data = new Uint8Array([1, 2, 3]);
    const written = client.writeFile("bar.vtu", data);
    await vi.waitFor(() => expect(worker.sent).toHaveLength(2));
    const message = worker.sent[1] as Extract<ToWorker, { type: "write-file" }>;
    expect(message).toMatchObject({
      type: "write-file",
      id: 1,
      name: "bar.vtu",
    });
    expect([...new Uint8Array(message.data)]).toEqual([1, 2, 3]);
    expect(message.data).not.toBe(data.buffer);
    worker.reply({ type: "done", id: 1 });
    await written;

    const inspected = client.inspectMesh("bar.vtu");
    await vi.waitFor(() => expect(worker.sent).toHaveLength(3));
    const surface = {
      positions: new Float32Array(9),
      triangles: new Uint32Array([0, 1, 2]),
      edges: new Uint32Array([0, 1]),
      owners: new Uint32Array([0]),
      cells: 1,
    };
    worker.reply({
      type: "mesh-info",
      id: 2,
      info: { file: "bar.vtu", points: 8 },
      surface,
    });
    await expect(inspected).resolves.toEqual({
      info: { file: "bar.vtu", points: 8 },
      surface,
    });
  });

  it("allows plain file names only", () => {
    expect(safeName("bar.vtu")).toBe("bar.vtu");
    expect(safeName("C:\\meshes\\bar.vtu")).toBe("bar.vtu");
    expect(safeName("../../etc/passwd")).toBe("passwd");
    expect(() => safeName("..")).toThrow("Invalid file name");
    expect(() => safeName("dir/")).toThrow("Invalid file name");
  });
});
