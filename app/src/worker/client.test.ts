import { describe, expect, it, vi } from "vitest";
import { CancelledError, PyodideClient } from "./client";
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
        lazyWheels: {
          tensortrax:
            "https://example.org/app/wheels/tensortrax-0.30.0-py3-none-any.whl",
        },
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
      surfaces: { hexahedron: surface },
    });
    await expect(inspected).resolves.toEqual({
      info: { file: "bar.vtu", points: 8 },
      surfaces: { hexahedron: surface },
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

describe("jobs", () => {
  it("runs the jobs of a model with progress events", async () => {
    const { worker, client } = start();
    worker.reply(ready);
    const onEvent = vi.fn();
    const run = client.run('{"commands": []}', onEvent);
    await vi.waitFor(() => expect(worker.sent).toHaveLength(2));
    expect(worker.sent[1]).toEqual({
      type: "run",
      id: 1,
      document: '{"commands": []}',
    });
    const event = { event: "iteration", iteration: 1, fnorm: 1, xnorm: 1 };
    worker.reply({ type: "job-progress", id: 1, event } as FromWorker);
    const results = {
      job: { substeps: 3, time: 0.5, x: [[0], [1]], y: [[0], [2]] },
    };
    worker.reply({ type: "job-result", id: 1, results });
    await expect(run).resolves.toEqual(results);
    expect(onEvent).toHaveBeenCalledWith(event);
    // with the settings of the live scenes (#207)
    void client.run("{}", onEvent, { quantity: "stress_mises", interval: 2 });
    await vi.waitFor(() => expect(worker.sent).toHaveLength(3));
    expect(worker.sent[2]).toEqual({
      type: "run",
      id: 2,
      document: "{}",
      live: { quantity: "stress_mises", interval: 2 },
    });
  });

  it("generates the script of a model", async () => {
    const { worker, client } = start();
    worker.reply(ready);
    const script = client.script('{"commands": []}');
    await vi.waitFor(() => expect(worker.sent).toHaveLength(2));
    expect(worker.sent[1]).toEqual({
      type: "script",
      id: 1,
      document: '{"commands": []}',
    });
    worker.reply({ type: "text", id: 1, text: "import felupe as fem\n" });
    await expect(script).resolves.toBe("import felupe as fem\n");
  });

  it("exports the results of a job", async () => {
    const { worker, client } = start();
    worker.reply(ready);
    const exported = client.exportResults("job_1", "vtu", 3);
    await vi.waitFor(() => expect(worker.sent).toHaveLength(2));
    expect(worker.sent[1]).toEqual({
      type: "export-results",
      id: 1,
      job: "job_1",
      format: "vtu",
      substep: 3,
    });
    worker.reply({
      type: "bytes",
      id: 1,
      data: new Uint8Array([60, 63]).buffer,
    });
    expect([...(await exported)]).toEqual([60, 63]);
  });

  it("loads the result scene of a substep", async () => {
    const { worker, client } = start();
    worker.reply(ready);
    const loaded = client.resultScene("job_1", 3, "stress_max");
    await vi.waitFor(() => expect(worker.sent).toHaveLength(2));
    expect(worker.sent[1]).toEqual({
      type: "result",
      id: 1,
      job: "job_1",
      substep: 3,
      quantity: "stress_max",
    });
    const scene = {
      label: "Max. principal Cauchy stress",
      at: "cell" as const,
      range: null,
      surfaces: [],
    };
    worker.reply({ type: "result-scene", id: 1, scene });
    await expect(loaded).resolves.toEqual(scene);
  });

  it("cancels a job by restarting the worker and writes the files again", async () => {
    const workers: FakeWorker[] = [];
    const client = new PyodideClient(() => {
      const worker = new FakeWorker();
      workers.push(worker);
      return worker as unknown as Worker;
    }, "https://example.org/app/");
    workers[0].reply(ready);
    const written = client.writeFile("bar.vtu", new Uint8Array([1, 2]));
    await vi.waitFor(() => expect(workers[0].sent).toHaveLength(2));
    workers[0].reply({ type: "done", id: 1 });
    await written;

    const run = client.run("{}", () => {});
    await vi.waitFor(() => expect(workers[0].sent).toHaveLength(3));
    const onRestart = vi.fn();
    client.onRestart(onRestart);
    client.restart();
    await expect(run).rejects.toBeInstanceOf(CancelledError);
    expect(workers[0].terminated).toBe(true);
    expect(onRestart).toHaveBeenCalledTimes(1);
    // late messages of the old worker are ignored
    workers[0].reply({ type: "job-result", id: 2, results: {} });

    expect(workers[1].sent[0]).toMatchObject({ type: "init" });
    workers[1].reply(ready);
    await vi.waitFor(() => expect(workers[1].sent).toHaveLength(2));
    expect(workers[1].sent[1]).toMatchObject({
      type: "write-file",
      name: "bar.vtu",
    });
    const id = (workers[1].sent[1] as { id: number }).id;
    workers[1].reply({ type: "done", id });
    await expect(client.ready).resolves.toMatchObject({
      versions: { felupe: "12.0.0" },
    });
  });
});
