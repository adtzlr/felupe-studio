// Main-thread client of the Pyodide worker. Creating it starts loading Pyodide and
// FElupe right away, so loading overlaps with building the model (#40).
import type {
  BenchmarkResult,
  FromWorker,
  LoadTimings,
  ToWorker,
  Versions,
} from "./protocol";

export interface Ready {
  versions: Versions;
  timings: LoadTimings;
}

type Pending = {
  onResult: (result: BenchmarkResult) => void;
  onProgress: (message: string) => void;
  resolve: () => void;
  reject: (error: Error) => void;
};

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
    this.post({
      type: "init",
      pyodideVersion: __PYODIDE_VERSION__,
      felupeWheel: new URL(__FELUPE_WHEEL__, base).href,
    });
  }

  /** Run the benchmark of the spike (#9) for the given mesh sizes. */
  async benchmark(
    sizes: number[],
    onResult: (result: BenchmarkResult) => void,
    onProgress: (message: string) => void = () => {},
  ): Promise<void> {
    await this.ready;
    const id = this.nextId++;
    return new Promise<void>((resolve, reject) => {
      this.pending.set(id, { onResult, onProgress, resolve, reject });
      this.post({ type: "benchmark", id, sizes });
    });
  }

  terminate(): void {
    this.worker.terminate();
  }

  private post(message: ToWorker): void {
    this.worker.postMessage(message);
  }

  private dispatch(message: FromWorker): void {
    if (!("id" in message) || message.id === undefined) return;
    const pending = this.pending.get(message.id);
    if (!pending) return;
    switch (message.type) {
      case "progress":
        pending.onProgress(message.message);
        break;
      case "benchmark-result":
        pending.onResult(message.result);
        break;
      case "done":
        this.pending.delete(message.id);
        pending.resolve();
        break;
      case "error":
        this.pending.delete(message.id);
        pending.reject(new Error(message.message));
        break;
    }
  }
}
