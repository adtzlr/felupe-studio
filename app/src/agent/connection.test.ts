// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import {
  AgentConnection,
  type AgentState,
  agentUrl,
  BRIDGE_VERSION,
  type Handler,
  hasAgent,
} from "./connection";

class FakeSocket extends EventTarget {
  readyState = 0;
  sent: unknown[] = [];
  closed = false;
  constructor(readonly url: string) {
    super();
  }
  send(text: string) {
    this.sent.push(JSON.parse(text));
  }
  open() {
    this.readyState = 1;
    this.dispatchEvent(new Event("open"));
  }
  receive(message: object) {
    this.dispatchEvent(
      new MessageEvent("message", { data: JSON.stringify(message) }),
    );
  }
  close() {
    this.closed = true;
    this.readyState = 3;
    this.dispatchEvent(new Event("close"));
  }
}

const settle = () => new Promise((resolve) => setTimeout(resolve));

function connect(handler: Handler) {
  let socket!: FakeSocket;
  const connection = new AgentConnection(
    "ws://x/agent?token=t",
    handler,
    (url) => {
      socket = new FakeSocket(url);
      return socket as unknown as WebSocket;
    },
  );
  const states: AgentState["state"][] = [];
  connection.subscribe((state) => states.push(state.state));
  return { connection, socket, states };
}

describe("the connection to the agent bridge (#258)", () => {
  it("is offered by a page of felupe-studio serve --agent", () => {
    const doc = document.implementation.createHTMLDocument("app");
    const meta = (name: string, content: string) => {
      const tag = doc.createElement("meta");
      tag.name = name;
      tag.content = content;
      doc.head.append(tag);
    };
    meta("felupe-studio-agent", "on");
    expect(hasAgent(doc)).toBe(false);
    meta("felupe-studio-runtime", "python");
    expect(hasAgent(doc)).toBe(true);
    const storage = { getItem: () => "a+b" } as unknown as Storage;
    expect(
      agentUrl(
        { protocol: "http:", host: "127.0.0.1:8765" } as Location,
        storage,
      ),
    ).toBe("ws://127.0.0.1:8765/agent?token=a%2Bb");
  });

  it("says hello and answers the calls in order", async () => {
    const calls: string[] = [];
    const { socket, states } = connect(async (tool, args, progress) => {
      calls.push(tool);
      if (tool === "solve") {
        progress(1, 2, "job: 1 of 2 substeps");
        await settle();
        return { job: {} };
      }
      if (tool === "delete_command") throw new Error("Not 'x'.");
      return { echo: args };
    });
    socket.open();
    expect(socket.sent).toEqual([{ type: "hello", version: BRIDGE_VERSION }]);
    socket.receive({ type: "welcome", version: BRIDGE_VERSION });
    expect(states).toEqual(["connected"]);

    socket.receive({ type: "call", id: 1, tool: "solve", arguments: {} });
    socket.receive({
      type: "call",
      id: 2,
      tool: "select",
      arguments: { names: ["a"] },
    });
    socket.receive({ type: "call", id: 3, tool: "delete_command" });
    for (let i = 0; i < 5; i++) await settle();
    expect(calls).toEqual(["solve", "select", "delete_command"]);
    expect(socket.sent.slice(1)).toEqual([
      {
        type: "progress",
        id: 1,
        progress: 1,
        total: 2,
        message: "job: 1 of 2 substeps",
      },
      { type: "result", id: 1, result: { job: {} } },
      { type: "result", id: 2, result: { echo: { names: ["a"] } } },
      { type: "error", id: 3, message: "Not 'x'." },
    ]);
  });

  it("says when it is replaced, refused or gone", () => {
    const replaced = connect(async () => null);
    replaced.socket.open();
    replaced.socket.receive({ type: "welcome", version: 1 });
    replaced.socket.receive({ type: "replaced" });
    expect(replaced.connection.state).toEqual({ state: "replaced" });

    const refused = connect(async () => null);
    refused.socket.open();
    refused.socket.receive({ type: "refused", message: "Reload the app." });
    expect(refused.connection.state).toEqual({
      state: "failed",
      message: "Reload the app.",
    });

    const gone = connect(async () => null);
    gone.socket.open();
    gone.socket.receive({ type: "welcome", version: 1 });
    gone.socket.close();
    expect(gone.connection.state.state).toBe("failed");

    const closed = connect(async () => null);
    closed.socket.open();
    closed.socket.receive({ type: "welcome", version: 1 });
    closed.connection.close();
    expect(closed.socket.closed).toBe(true);
    expect(closed.connection.state).toEqual({ state: "off" });
  });
});
