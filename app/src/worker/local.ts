// The local Python runtime of `felupe-studio serve` (#240, ADR 0014): a channel to
// it over a WebSocket that looks like the Pyodide worker to the client. One
// connection is one Python process; closing it ends the process, e.g. a running job.
// The arrays of surfaces and scenes arrive as bytes, like from Pyodide, and become
// the typed arrays of the worker (`surface.ts`).
import { decodeFrame, encodeFrame } from "./frames";
import type { FromWorker, ResultScene, ToWorker } from "./protocol";
import {
  type RawResultSurface,
  type RawSurface,
  toResultScene,
  toSurfaces,
} from "./surface";

/** The name of the meta tag of the page that the server of the runtime serves. */
export const RUNTIME_META = "felupe-studio-runtime";
/** The key of the token of the runtime in the storage of the tab. */
export const TOKEN_KEY = "felupe-studio.token";

/** What the client needs of the worker: a channel of messages. */
export interface Channel {
  postMessage(message: ToWorker, transfer?: Transferable[]): void;
  addEventListener(
    type: "message",
    listener: (event: MessageEvent<FromWorker>) => void,
  ): void;
  terminate(): void;
}

type RawScene = Omit<ResultScene, "surfaces"> & {
  surfaces: RawResultSurface[];
};

const toScene = ({ surfaces, ...meta }: RawScene): ResultScene =>
  toResultScene(meta, surfaces);

/** A message of the server as the worker posts it: typed arrays, not bytes. */
export function toWorkerMessage(raw: Record<string, unknown>): FromWorker {
  switch (raw.type) {
    case "mesh-info":
      return {
        ...raw,
        surfaces: toSurfaces(raw.surfaces as Record<string, RawSurface>),
      } as FromWorker;
    case "result-scene":
      return { ...raw, scene: toScene(raw.scene as RawScene) } as FromWorker;
    case "job-progress": {
      const event = raw.event as { scene?: RawScene };
      return event.scene
        ? ({
            ...raw,
            event: { ...event, scene: toScene(event.scene) },
          } as FromWorker)
        : (raw as unknown as FromWorker);
    }
    case "bytes": {
      const data = raw.data as Uint8Array;
      return {
        ...raw,
        data: data.buffer.slice(
          data.byteOffset,
          data.byteOffset + data.byteLength,
        ),
      } as FromWorker;
    }
    default:
      return raw as unknown as FromWorker;
  }
}

/** The message of a connection that failed or ended. */
export const CLOSED =
  "The local Python runtime is not reachable. Is felupe-studio serve still running? Open the link with the token that it printed.";

/** A connection to the local runtime with the interface of the worker. */
export class LocalChannel implements Channel {
  private socket: WebSocket;
  private queue: (string | ArrayBuffer)[] = [];
  private listeners = new Set<(event: MessageEvent<FromWorker>) => void>();
  private ended = false;

  constructor(
    url: string,
    createSocket: (url: string) => WebSocket = (url) => new WebSocket(url),
  ) {
    const socket = createSocket(url);
    socket.binaryType = "arraybuffer";
    socket.addEventListener("open", () => {
      for (const frame of this.queue) socket.send(frame);
      this.queue = [];
    });
    socket.addEventListener("message", (event: MessageEvent) => {
      const raw = decodeFrame(event.data as string | ArrayBuffer);
      this.emit(toWorkerMessage(raw as Record<string, unknown>));
    });
    socket.addEventListener("close", () => {
      // an error without an id rejects the start and the pending requests
      if (!this.ended) this.emit({ type: "error", message: CLOSED });
      this.ended = true;
    });
    this.socket = socket;
  }

  postMessage(message: ToWorker): void {
    // the process loads Python when it starts, without the wheels of Pyodide
    if (message.type === "init" || this.ended) return;
    const frame = encodeFrame(message);
    if (this.socket.readyState === WebSocket.OPEN) this.socket.send(frame);
    else this.queue.push(frame);
  }

  addEventListener(
    _type: "message",
    listener: (event: MessageEvent<FromWorker>) => void,
  ): void {
    this.listeners.add(listener);
  }

  /** Close the connection: the server ends the process. */
  terminate(): void {
    this.ended = true;
    this.socket.close();
  }

  private emit(message: FromWorker): void {
    const event = { data: message } as MessageEvent<FromWorker>;
    for (const listener of this.listeners) listener(event);
  }
}

/** Whether the page was served by `felupe-studio serve`. */
export function isLocal(doc: Document = document): boolean {
  const meta = doc.querySelector<HTMLMetaElement>(
    `meta[name="${RUNTIME_META}"]`,
  );
  return meta?.content === "python";
}

/**
 * The token of the runtime: from the address (then kept for the tab and removed
 * from the address bar) or kept from before, e.g. after a reload.
 */
export function takeToken(
  location: Location = window.location,
  history: History = window.history,
  storage: Storage | undefined = globalThis.sessionStorage,
): string | undefined {
  const url = new URL(location.href);
  const token = url.searchParams.get("token");
  if (token) {
    try {
      storage?.setItem(TOKEN_KEY, token);
    } catch {
      // without storage, a reload needs the link again
    }
    url.searchParams.delete("token");
    history.replaceState(history.state, "", url.href);
    return token;
  }
  try {
    return storage?.getItem(TOKEN_KEY) ?? undefined;
  } catch {
    return undefined;
  }
}

/** The address of the WebSocket of the runtime on the host of the page. */
export function runtimeUrl(location: Location, token: string): string {
  const protocol = location.protocol === "https:" ? "wss:" : "ws:";
  const url = new URL(`${protocol}//${location.host}/runtime`);
  url.searchParams.set("token", token);
  return url.href;
}
