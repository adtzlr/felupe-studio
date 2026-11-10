// Main-thread client of the Pyodide worker. Creating it starts loading Pyodide and
// FElupe right away, so loading overlaps with building the model (#40).
import type {
  BenchmarkResult,
  FromWorker,
  LoadTimings,
  MeshInfo,
  MeshSurface,
  ToWorker,
  Versions,
} from "./protocol";

export interface Ready {
  versions: Versions;
  timings: LoadTimings;
}

type Request = Extract<ToWorker, { id: number }>;
type RequestBody = Request extends infer R
  ? R extends Request
    ? Omit<R, "id">
    : never
  : never;

interface Pending {
  final: FromWorker["type"];
  resolve: (message: FromWorker) => void;
  reject: (error: Error) => void;
  onMessage?: (message: FromWorker) => void;
}

export class PyodideClient {
  /** Resolves when Pyodide and FElupe are loaded. */
  readonly ready: Promise<Ready>;
  private worker: Worker;
  private pending = new Map<number, Pending>();
  private nextId = 1;

  constructor(
    worker: Worker = new Worker(
      new URL("./pyodide.worker.ts", import.meta.url),
      {
        type: "module",
      },
    ),
    base: string = document.baseURI,
  ) {
    this.worker = worker;
    this.ready = new Promise<Ready>((resolve, reject) => {
      worker.addEventListener("message", (event: MessageEvent<FromWorker>) => {
        const message = event.data;
        if (message.type === "ready") {
          resolve({ versions: message.versions, timings: message.timings });
        } else if (message.type === "error" && message.id === undefined) {
          reject(new Error(message.message));
        } else {
          this.dispatch(message);
        }
      });
    });
    // avoid an unhandled rejection; callers see the error through `ready`
    this.ready.catch(() => {});
    this.worker.postMessage({
      type: "init",
      pyodideVersion: __PYODIDE_VERSION__,
      wheels: __WHEELS__.map((wheel) => new URL(wheel, base).href),
    } satisfies ToWorker);
  }

  /** Run the benchmark of the spike (#9) for the given mesh sizes. */
  async benchmark(
    sizes: number[],
    onResult: (result: BenchmarkResult) => void,
    onProgress: (message: string) => void = () => {},
  ): Promise<void> {
    await this.request({ type: "benchmark", sizes }, "done", (message) => {
      if (message.type === "progress") onProgress(message.message);
      if (message.type === "benchmark-result") onResult(message.result);
    });
  }

  /** Write a file into the project directory of Python (a copy of the data is sent). */
  async writeFile(name: string, data: Uint8Array): Promise<void> {
    const copy = data.slice().buffer;
    await this.request(
      { type: "write-file", name, data: copy },
      "done",
      undefined,
      [copy],
    );
  }

  /**
   * Inspect a mesh file of the project directory. The outer surface is given for
   * files that can be used.
   */
  async inspectMesh(
    name: string,
  ): Promise<{ info: MeshInfo; surface?: MeshSurface }> {
    const message = await this.request(
      { type: "inspect-mesh", name },
      "mesh-info",
    );
    const { info, surface } = message as Extract<
      FromWorker,
      { type: "mesh-info" }
    >;
    return { info, surface };
  }

  terminate(): void {
    this.worker.terminate();
  }

  private async request(
    body: RequestBody,
    final: FromWorker["type"],
    onMessage?: (message: FromWorker) => void,
    transfer: Transferable[] = [],
  ): Promise<FromWorker> {
    await this.ready;
    const id = this.nextId++;
    return new Promise<FromWorker>((resolve, reject) => {
      this.pending.set(id, { final, resolve, reject, onMessage });
      this.worker.postMessage({ ...body, id } as Request, transfer);
    });
  }

  private dispatch(message: FromWorker): void {
    if (!("id" in message) || message.id === undefined) return;
    const pending = this.pending.get(message.id);
    if (!pending) return;
    if (message.type === "error") {
      this.pending.delete(message.id);
      pending.reject(new Error(message.message));
    } else if (message.type === pending.final) {
      this.pending.delete(message.id);
      pending.resolve(message);
    } else {
      pending.onMessage?.(message);
    }
  }
}
