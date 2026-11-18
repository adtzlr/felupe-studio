// The connection of a tab to the agent bridge of `felupe-studio serve --agent`
// (#258, ADR 0015): a WebSocket to `/agent` on which the server forwards the tool
// calls of an agent, and the tab answers them with the tools of the app. The tab
// says hello with the version of the protocol; a newly connected tab replaces it.
import { RUNTIME_META, TOKEN_KEY } from "../worker/local";

/** The version of the protocol of the bridge (`felupe_studio.bridge.VERSION`). */
export const BRIDGE_VERSION = 1;
/** The meta tag of a page whose server has the bridge. */
export const AGENT_META = "felupe-studio-agent";

export type AgentState =
  | { state: "off" }
  | { state: "connecting" }
  | { state: "connected" }
  /** Another tab is connected now. */
  | { state: "replaced" }
  /** The server or the version refused it, or the connection failed. */
  | { state: "failed"; message: string };

/** The progress of a long tool, e.g. the converged substeps of a run. */
export type Progress = (done: number, total?: number, message?: string) => void;

/** Answer a tool call: its result, or an Error with the message for the agent. */
export type Handler = (
  tool: string,
  args: Record<string, unknown>,
  progress: Progress,
) => Promise<unknown>;

type Message =
  | { type: "welcome"; version: number }
  | { type: "refused"; message: string }
  | { type: "replaced" }
  | {
      type: "call";
      id: number;
      tool: string;
      arguments?: Record<string, unknown>;
    };

/** Whether the server of the page has the bridge (`felupe-studio serve --agent`). */
export function hasAgent(doc: Document = document): boolean {
  const meta = doc.querySelector<HTMLMetaElement>(`meta[name="${AGENT_META}"]`);
  const runtime = doc.querySelector<HTMLMetaElement>(
    `meta[name="${RUNTIME_META}"]`,
  );
  return meta?.content === "on" && runtime?.content === "python";
}

/** The address of the WebSocket of the bridge, with the token of the tab. */
export function agentUrl(
  location: Location = window.location,
  storage: Storage | undefined = globalThis.sessionStorage,
): string {
  let token = "";
  try {
    token = storage?.getItem(TOKEN_KEY) ?? "";
  } catch {
    // without the token the server refuses the connection
  }
  const protocol = location.protocol === "https:" ? "wss:" : "ws:";
  const url = new URL(`${protocol}//${location.host}/agent`);
  url.searchParams.set("token", token);
  return url.href;
}

const FAILED =
  "The agent bridge is not reachable. Is felupe-studio serve --agent still running?";

/** A connection of the tab to the bridge, which answers the calls of the agent. */
export class AgentConnection {
  private socket: WebSocket;
  private listeners = new Set<(state: AgentState) => void>();
  private current: AgentState = { state: "connecting" };
  /** The calls run one after the other, like on the server. */
  private queue: Promise<void> = Promise.resolve();

  constructor(
    url: string,
    private handler: Handler,
    createSocket: (url: string) => WebSocket = (url) => new WebSocket(url),
  ) {
    const socket = createSocket(url);
    socket.addEventListener("open", () =>
      socket.send(JSON.stringify({ type: "hello", version: BRIDGE_VERSION })),
    );
    socket.addEventListener("message", (event: MessageEvent) =>
      this.receive(JSON.parse(event.data as string) as Message),
    );
    socket.addEventListener("close", () => {
      if (this.current.state === "connecting")
        this.set({ state: "failed", message: FAILED });
      else if (this.current.state === "connected")
        this.set({ state: "failed", message: FAILED });
    });
    this.socket = socket;
  }

  get state(): AgentState {
    return this.current;
  }

  subscribe(listener: (state: AgentState) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Disconnect: the agent's tools fail until a tab connects again. */
  close(): void {
    this.set({ state: "off" });
    this.socket.close();
  }

  private set(state: AgentState) {
    this.current = state;
    for (const listener of this.listeners) listener(state);
  }

  private send(message: object) {
    if (this.socket.readyState === WebSocket.OPEN)
      this.socket.send(JSON.stringify(message));
  }

  private receive(message: Message) {
    switch (message.type) {
      case "welcome":
        return this.set({ state: "connected" });
      case "refused":
        return this.set({ state: "failed", message: message.message });
      case "replaced":
        return this.set({ state: "replaced" });
      case "call": {
        const { id, tool } = message;
        const progress: Progress = (done, total, text) =>
          this.send({
            type: "progress",
            id,
            progress: done,
            total,
            message: text,
          });
        this.queue = this.queue.then(async () => {
          try {
            const result = await this.handler(
              tool,
              message.arguments ?? {},
              progress,
            );
            this.send({ type: "result", id, result: result ?? null });
          } catch (error) {
            const text = error instanceof Error ? error.message : String(error);
            this.send({ type: "error", id, message: text });
          }
        });
      }
    }
  }
}
