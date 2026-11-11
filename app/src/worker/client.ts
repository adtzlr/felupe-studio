// Main-thread client of the Pyodide worker. Creating it starts loading Pyodide and
// FElupe right away, so loading overlaps with building the model (#40). Python runs
// jobs synchronously in the worker: a running job is cancelled by restarting the
// worker, which loads Python again (from the cache) and gets the files again.
import type {
  BenchmarkResult,
  FromWorker,
  JobEvent,
  JobResult,
  LoadTimings,
  MeshInfo,
  MeshSurface,
  Quantity,
  ResultScene,
  ToWorker,
  Versions,
} from "./protocol";

/** A generated script and the line ranges [first, last] (from 1) of its objects. */
export interface ScriptView {
  script: string;
  lines: Record<string, [number, number][]>;
}

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

/** A request that was stopped by a restart of the worker. */
export class CancelledError extends Error {
  constructor() {
    super("Cancelled.");
    this.name = "CancelledError";
  }
}

const newWorker = () =>
  new Worker(new URL("./pyodide.worker.ts", import.meta.url), {
    type: "module",
  });

export class PyodideClient {
  /** Resolves when Pyodide and FElupe are loaded (and the files are written). */
  ready!: Promise<Ready>;
  private booted!: Promise<Ready>;
  private worker!: Worker;
  private pending = new Map<number, Pending>();
  private nextId = 1;
  /** The files written into the project directory, written again on a restart. */
  private files = new Map<string, Uint8Array>();
  private listeners = new Set<() => void>();
  private createWorker: () => Worker;

  constructor(
    worker: Worker | (() => Worker) = newWorker,
    private base: string = document.baseURI,
  ) {
    this.createWorker = typeof worker === "function" ? worker : () => worker;
    this.start([]);
  }

  /**
   * Stop the worker (e.g. a running job) and start a new one. Pending requests are
   * rejected with a CancelledError; the written files are written again.
   */
  restart(): void {
    this.worker.terminate();
    const pending = [...this.pending.values()];
    this.pending.clear();
    for (const p of pending) p.reject(new CancelledError());
    this.start([...this.files]);
    for (const listener of this.listeners) listener();
  }

  /** Listen to restarts, e.g. to wait for the new `ready`. */
  onRestart(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private start(files: [string, Uint8Array][]): void {
    const worker = this.createWorker();
    this.worker = worker;
    this.booted = new Promise<Ready>((resolve, reject) => {
      worker.addEventListener("message", (event: MessageEvent<FromWorker>) => {
        if (this.worker !== worker) return;
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
    this.ready = this.booted.then(async (ready) => {
      for (const [name, data] of files) await this.write(name, data);
      return ready;
    });
    // avoid unhandled rejections; callers see the error through `ready`
    this.booted.catch(() => {});
    this.ready.catch(() => {});
    const url = (wheel: string) => new URL(wheel, this.base).href;
    worker.postMessage({
      type: "init",
      pyodideVersion: __PYODIDE_VERSION__,
      wheels: __WHEELS__.map(url),
      lazyWheels: Object.fromEntries(
        Object.entries(__LAZY_WHEELS__).map(([name, w]) => [name, url(w)]),
      ),
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
    this.files.set(name, data);
    await this.ready;
    await this.write(name, data);
  }

  /**
   * Run the jobs of a command list (JSON text), with an event for every substep and
   * Newton iteration. Rejects with the Python traceback, or with a CancelledError.
   */
  async run(
    document: string,
    onEvent: (event: JobEvent) => void,
  ): Promise<Record<string, JobResult>> {
    const message = await this.request(
      { type: "run", document },
      "job-result",
      (message) => {
        if (message.type === "job-progress") onEvent(message.event);
      },
    );
    return (message as Extract<FromWorker, { type: "job-result" }>).results;
  }

  /** The FElupe script of a command list (JSON text). */
  async script(document: string): Promise<string> {
    const message = await this.request({ type: "script", document }, "text");
    return (message as Extract<FromWorker, { type: "text" }>).text;
  }

  /** The FElupe script of a command list and the lines of its objects (#130). */
  async scriptView(document: string): Promise<ScriptView> {
    const message = await this.request(
      { type: "script-view", document },
      "text",
    );
    return JSON.parse((message as Extract<FromWorker, { type: "text" }>).text);
  }

  /**
   * The results of a job of the last run as a file: VTU of a substep (the last one
   * by default) or XDMF of all substeps.
   */
  async exportResults(
    job: string,
    format: "vtu" | "xdmf" | "csv",
    substep?: number,
  ): Promise<Uint8Array> {
    const message = await this.request(
      { type: "export-results", job, format, substep },
      "bytes",
    );
    return new Uint8Array(
      (message as Extract<FromWorker, { type: "bytes" }>).data,
    );
  }

  /** The result of a substep of a job of the last run (substeps count from 1). */
  async resultScene(
    job: string,
    substep: number,
    quantity: Quantity,
  ): Promise<ResultScene> {
    const message = await this.request(
      { type: "result", job, substep, quantity },
      "result-scene",
    );
    return (message as Extract<FromWorker, { type: "result-scene" }>).scene;
  }

  private async write(name: string, data: Uint8Array): Promise<void> {
    const copy = data.slice().buffer;
    await this.send(
      { type: "write-file", name, data: copy },
      "done",
      undefined,
      [copy],
    );
  }

  /**
   * Inspect a mesh file of the project directory, with the outer surfaces of its
   * solid cells by cell type.
   */
  async inspectMesh(
    name: string,
  ): Promise<{ info: MeshInfo; surfaces: Record<string, MeshSurface> }> {
    const message = await this.request(
      { type: "inspect-mesh", name },
      "mesh-info",
    );
    const { info, surfaces } = message as Extract<
      FromWorker,
      { type: "mesh-info" }
    >;
    return { info, surfaces };
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
    return this.send(body, final, onMessage, transfer);
  }

  /** Send a request once Python is loaded (without waiting for the files). */
  private async send(
    body: RequestBody,
    final: FromWorker["type"],
    onMessage?: (message: FromWorker) => void,
    transfer: Transferable[] = [],
  ): Promise<FromWorker> {
    await this.booted;
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
