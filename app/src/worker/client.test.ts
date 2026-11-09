import { describe, expect, it, vi } from "vitest";
import { PyodideClient } from "./client";
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
  it("starts loading with the pinned versions and the wheel of the app", () => {
    const { worker } = start();
    expect(worker.sent).toEqual([
      {
        type: "init",
        pyodideVersion: __PYODIDE_VERSION__,
        felupeWheel: `https://example.org/app/wheels/felupe-${__FELUPE_VERSION__}-py3-none-any.whl`,
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
