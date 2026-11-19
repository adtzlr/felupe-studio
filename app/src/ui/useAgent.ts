// The agent bridge in the app (#258, ADR 0015): Help ▸ Connect an agent connects the
// tab to `felupe-studio serve --agent`, whose agent then acts on the open model with
// the tools of the app; a mesh script of the agent runs after the user agrees.
import { useEffect, useRef, useState } from "preact/hooks";
import {
  AgentConnection,
  type AgentState,
  agentUrl,
} from "../agent/connection";
import { type AgentHost, agentTools } from "../agent/tools";
import type { Workspace } from "./Ribbon";
import type { Results } from "./useResults";
import type { Selection } from "./useSelection";

/** A mesh script of the agent that waits for the user. */
export interface ScriptRequest {
  name: string;
  content: string;
  answer: (run: boolean) => void;
}

export interface Agent {
  state: AgentState;
  connect: () => void;
  disconnect: () => void;
  /** A mesh script of the agent that the user is asked to run. */
  script?: ScriptRequest;
}

/**
 * The connection of the tab to the agent bridge. `host` is the app as the tools see
 * it, read anew at every call (its state changes between the calls).
 */
export function useAgent(
  host: Omit<AgentHost, "trustScript">,
  createConnection: (
    handler: ConstructorParameters<typeof AgentConnection>[1],
  ) => AgentConnection = (handler) => new AgentConnection(agentUrl(), handler),
): Agent {
  const [connection, setConnection] = useState<AgentConnection>();
  const [state, setState] = useState<AgentState>({ state: "off" });
  const [script, setScript] = useState<ScriptRequest>();
  const latest = useRef(host);
  latest.current = host;

  const trustScript = (name: string, content: string) =>
    new Promise<boolean>((resolve) =>
      setScript({
        name,
        content,
        answer: (run) => {
          setScript(undefined);
          resolve(run);
        },
      }),
    );

  const connect = () => {
    connection?.close();
    // the tools read the app of the latest render
    const proxy = new Proxy({} as AgentHost, {
      get: (_, key: string) =>
        key === "trustScript"
          ? trustScript
          : latest.current[key as keyof typeof host],
    });
    const created = createConnection(agentTools(proxy));
    created.subscribe(setState);
    setState(created.state);
    setConnection(created);
  };

  const disconnect = () => {
    connection?.close();
    setConnection(undefined);
    setState({ state: "off" });
    script?.answer(false);
  };

  useEffect(() => () => connection?.close(), [connection]);
  return { state, connect, disconnect, script };
}

interface AppOptions extends Pick<
  AgentHost,
  "store" | "files" | "client" | "jobs" | "openSample" | "picture"
> {
  /** The notes of the objects, by their names. */
  notes: ReadonlyMap<string, readonly string[]>;
  modified: boolean;
  /** Why the model cannot be solved now, if it cannot. */
  blocker?: string;
  results: Results;
  selection: Selection;
  workspace: Workspace;
  setWorkspace: (workspace: Workspace) => void;
}

/**
 * The agent bridge of the app (#258, #312): the tools of an agent act on the open
 * model, its selection and its results, like the user.
 */
export function useAppAgent({
  notes,
  modified,
  blocker,
  results,
  selection,
  workspace,
  setWorkspace,
  ...host
}: AppOptions): Agent {
  const { view } = results;
  return useAgent({
    ...host,
    notes: () =>
      [...notes].flatMap(([name, messages]) =>
        messages.map((message) => ({ name, message })),
      ),
    modified: () => modified,
    solveBlocker: () => blocker,
    solve: results.solve,
    selection: () => ({
      selected: selection.selection ? [selection.selection] : [],
      workspace,
      ...(workspace === "results" && view ? { view } : {}),
    }),
    select: selection.select,
    show: (target, choice = {}) => {
      if (target === "model") {
        setWorkspace("model");
        return { workspace: "model" };
      }
      const shown = results.showView(choice);
      if (typeof shown === "string") return shown;
      setWorkspace("results");
      host.jobs?.dismiss();
      return { workspace: "results", view: shown };
    },
  });
}
