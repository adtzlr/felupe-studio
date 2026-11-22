// Main-thread client of the Python runtime: the Pyodide worker, or the local Python
// of `felupe-studio serve` (#240, ADR 0014) over a WebSocket with the same messages.
// Creating it starts loading Pyodide and FElupe right away, so loading overlaps with
// building the model (#40). Python runs jobs synchronously: a running job is
// cancelled by restarting the worker (or the connection, which ends the process of
// the local runtime), which loads Python again and gets the files again.
import { bytecodeCache } from "../brand";
import { pyodideUrl } from "../pyodide";
import type { CheckReport } from "../core/checks";
import {
  type Channel,
  isLocal,
  LocalChannel,
  runtimeUrl,
  takeToken,
} from "./local";
import type {
  BenchmarkResult,
  Cut,
  FromWorker,
  JobEvent,
  JobResult,
  LiveSettings,
  LoadTimings,
  MeshFormat,
  MeshInfo,
  MeshSource,
  MeshSurface,
  Precision,
  Quantity,
  ResultRanges,
  ResultScene,
  ToWorker,
  ValuesMethod,
  Versions,
  Capabilities,
} from "./protocol";

/** A generated script and the line ranges [first, last] (from 1) of its objects. */
export interface ScriptView {
  script: string;
  lines: Record<string, [number, number][]>;
}

export interface Ready {
  versions: Versions;
  timings: LoadTimings;
  /** The linear solvers of the runtime, e.g. PARDISO (#308). */
  capabilities?: Capabilities;
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

export class RuntimeClient {
  /** Resolves when Pyodide and FElupe are loaded (and the files are written). */
  ready!: Promise<Ready>;
  private booted!: Promise<Ready>;
  private worker!: Channel;
  private pending = new Map<number, Pending>();
  private nextId = 1;
  /** The files written into the project directory, written again on a restart. */
  private files = new Map<string, Uint8Array>();
  private listeners = new Set<() => void>();
  private createWorker: () => Channel;

  /**
   * @param worker The worker, or a function that makes one (a new one on a
   *   restart), or a channel to the local runtime.
   * @param local Python runs on this computer (`felupe-studio serve`), not in
   *   Pyodide.
   */
  constructor(
    worker: Channel | (() => Channel) = newWorker,
    private base: string = document.baseURI,
    readonly local = false,
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

  /** Python is gone after it was ready, e.g. the local runtime was stopped. */
  private fail(error: Error): void {
    this.ready = Promise.reject(error);
    this.ready.catch(() => {});
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
    let started = false;
    this.booted = new Promise<Ready>((resolve, reject) => {
      worker.addEventListener("message", (event: MessageEvent<FromWorker>) => {
        if (this.worker !== worker) return;
        const message = event.data;
        if (message.type === "ready") {
          started = true;
          const { versions, timings, capabilities } = message;
          resolve({ versions, timings, capabilities });
        } else if (message.type === "error" && message.id === undefined) {
          // Python could not start, or the connection to the local runtime ended
          const error = new Error(message.message);
          reject(error);
          const pending = [...this.pending.values()];
          this.pending.clear();
          for (const p of pending) p.reject(error);
          if (started) this.fail(error);
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
      indexURL: pyodideUrl(__PYODIDE_VERSION__, this.base),
      wheels: __WHEELS__.map(url),
      lazyWheels: Object.fromEntries(
        Object.entries(__LAZY_WHEELS__).map(([name, w]) => [name, url(w)]),
      ),
      cache: bytecodeCache(),
    } satisfies ToWorker);
  }

  /**
   * Run the benchmark of the spike (#9) for the given mesh sizes, with the linear
   * equation system or the model in single precision (ADR 0016).
   */
  async benchmark(
    sizes: number[],
    onResult: (result: BenchmarkResult) => void,
    onProgress: (message: string) => void = () => {},
    precision: Precision = "double",
  ): Promise<void> {
    const request = { type: "benchmark", sizes, precision } as const;
    await this.request(request, "done", (message) => {
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
   * Newton iteration, and live results with scenes of a quantity (#207). Rejects
   * with the Python traceback, or with a CancelledError.
   */
  async run(
    document: string,
    onEvent: (event: JobEvent) => void,
    live?: LiveSettings,
  ): Promise<Record<string, JobResult>> {
    const message = await this.request(
      { type: "run", document, ...(live ? { live } : {}) },
      "job-result",
      (message) => {
        if (message.type === "job-progress") onEvent(message.event);
      },
    );
    return (message as Extract<FromWorker, { type: "job-result" }>).results;
  }

  /**
   * The checks of a command list with the mesh data (`felupe_studio.checks`): the
   * cells in no or in two sections and the hanging points of interfaces. Only the
   * local runtime has them (#258).
   */
  async check(document: string): Promise<CheckReport> {
    const message = await this.request({ type: "check", document }, "text");
    return JSON.parse(
      (message as Extract<FromWorker, { type: "text" }>).text,
    ) as CheckReport;
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
    method?: ValuesMethod,
  ): Promise<Uint8Array> {
    const message = await this.request(
      { type: "export-results", job, format, substep, method },
      "bytes",
    );
    return new Uint8Array(
      (message as Extract<FromWorker, { type: "bytes" }>).data,
    );
  }

  /**
   * A mesh of the project as a file of another format (#230): a mesh file, or the
   * mesh of a script with its parameters (and an item).
   */
  async exportMesh(
    file: string,
    format: MeshFormat,
    options: {
      parameters?: Record<string, number>;
      item?: string;
      cellType?: string;
      scale?: number;
      /** The commands of the tools of a made mesh (ADR 0019). */
      commands?: readonly unknown[];
    } = {},
  ): Promise<Uint8Array> {
    const message = await this.request(
      { type: "export-mesh", file, format, ...options },
      "bytes",
    );
    return new Uint8Array(
      (message as Extract<FromWorker, { type: "bytes" }>).data,
    );
  }

  /**
   * The result of a substep of a job of the last run (substeps count from 1), cut
   * by a cut of the view (#395).
   */
  async resultScene(
    job: string,
    substep: number,
    quantity: Quantity,
    method?: ValuesMethod,
    cut?: Cut,
  ): Promise<ResultScene> {
    const message = await this.request(
      {
        type: "result",
        job,
        substep,
        quantity,
        method,
        ...(cut ? { cut } : {}),
      },
      "result-scene",
    );
    return (message as Extract<FromWorker, { type: "result-scene" }>).scene;
  }

  /**
   * The ranges of a quantity of every substep of a job of the last run (`null` for
   * a substep without finite values), for a range over all substeps (#139), also
   * of every section (#377).
   */
  async resultRanges(
    job: string,
    quantity: Quantity,
    method?: ValuesMethod,
  ): Promise<ResultRanges> {
    const message = await this.request(
      { type: "result-ranges", job, quantity, method },
      "text",
    );
    return JSON.parse(
      (message as Extract<FromWorker, { type: "text" }>).text,
    ) as ResultRanges;
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

  /** Run a script with parameters and inspect its mesh, or an item (#182). */
  async makeMesh(
    file: string,
    parameters: Record<string, number>,
    item?: string,
  ): Promise<{ info: MeshInfo; surfaces: Record<string, MeshSurface> }> {
    const message = await this.request(
      { type: "make-mesh", file, parameters, ...(item ? { item } : {}) },
      "mesh-info",
    );
    const { info, surfaces } = message as Extract<
      FromWorker,
      { type: "mesh-info" }
    >;
    return { info, surfaces };
  }

  /**
   * Make a mesh with the tools of FElupe (ADR 0019) and inspect it: the commands of
   * the tools that make it, with the values of their expressions.
   */
  async generateMesh(
    commands: readonly unknown[],
    name: string,
  ): Promise<{ info: MeshInfo; surfaces: Record<string, MeshSurface> }> {
    const message = await this.request(
      { type: "generate-mesh", commands, name },
      "mesh-info",
    );
    const { info, surfaces } = message as Extract<
      FromWorker,
      { type: "mesh-info" }
    >;
    return { info, surfaces };
  }

  /**
   * The outer surfaces of the solid cells of a mesh, cut (#395): of the kept cells of
   * the mesh of a request, without a new read of its file or run of its script.
   */
  async cutMesh(
    source: MeshSource,
    cut: Cut,
  ): Promise<Record<string, MeshSurface>> {
    const message = await this.request({ ...source, cut }, "mesh-info");
    return (message as Extract<FromWorker, { type: "mesh-info" }>).surfaces;
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

/**
 * The client of the runtime of the page: the local Python if the page was served by
 * `felupe-studio serve` (#240), else Pyodide.
 */
export function createClient(): RuntimeClient {
  if (!isLocal()) return new RuntimeClient();
  const url = runtimeUrl(window.location, takeToken() ?? "");
  return new RuntimeClient(() => new LocalChannel(url), document.baseURI, true);
}
