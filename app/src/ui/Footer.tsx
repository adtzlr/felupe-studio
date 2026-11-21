import { useRef, useState } from "preact/hooks";
import type { ModelStore } from "../core/store";
import type { CommandType } from "../core/validate";
import { CommandLine } from "./CommandLine";
import { History } from "./History";
import { Icon } from "./icons";
import type { AgentState } from "../agent/connection";
import { type Runtime, runtimeText } from "./hooks";
import type { Kept } from "./useSession";

const KEPT =
  "The project and its mesh files are kept in this browser only, so that a reload restores them. Save the project file to keep it elsewhere.";

/** Where the session is kept, for the status bar. */
function keptText(
  kept: Kept,
): { text: string; title: string; warning?: boolean } | undefined {
  switch (kept.state) {
    case "off":
      return undefined;
    case "restoring":
      return { text: "Restoring the last session …", title: KEPT };
    case "kept":
      return kept.files
        ? { text: "Kept in this browser", title: KEPT }
        : {
            text: "Kept in this browser without mesh files",
            title:
              "The mesh files do not fit into the storage of this browser; a reload restores the project, but its mesh files have to be chosen again.",
            warning: true,
          };
    case "failed":
      return {
        text: "Not kept in this browser",
        title: kept.message,
        warning: true,
      };
  }
}

interface Props {
  store: ModelStore;
  runtime: Runtime;
  /** Where the session is kept (default: not kept). */
  kept?: Kept;
  selected?: string;
  onSelect: (name: string) => void;
  onOpen: (type: CommandType) => void;
  /** The connection to the agent bridge (#258), and how to end it. */
  agent?: { state: AgentState; onDisconnect: () => void };
  /**
   * The compact layout of phones and short windows (#378): the command line is
   * behind a button of the history bar, and the status is one line.
   */
  compact?: boolean;
}

/** The connection to an agent, for the status bar (#258). */
function agentText(state: AgentState): string | undefined {
  switch (state.state) {
    case "off":
      return undefined;
    case "connecting":
      return "Connecting the agent …";
    case "connected":
      return "Agent connected";
    case "replaced":
      return "The agent is connected to another tab";
    case "failed":
      return state.message;
  }
}

/** The status bar; in a compact layout one line, without the number of commands. */
function Status({
  store,
  runtime,
  kept,
  agent,
  compact,
}: Pick<Props, "store" | "runtime" | "agent"> & {
  kept: Kept;
  compact: boolean;
}) {
  const issues = store.issues.length;
  const storage = keptText(kept);
  const agentStatus = agent && agentText(agent.state);
  return (
    <div class="status" role="status">
      <span
        class={
          runtime.state === "error" ? "status-runtime error" : "status-runtime"
        }
      >
        {runtimeText(runtime)}
      </span>
      {/* the history bar shows the commands */}
      {!compact && (
        <span>
          {store.commands.length}{" "}
          {store.commands.length === 1 ? "command" : "commands"}
        </span>
      )}
      <span class={issues ? "warning" : undefined}>
        {issues} {issues === 1 ? "issue" : "issues"}
      </span>
      {/* a compact status keeps only a warning of the storage */}
      {storage && (!compact || storage.warning) && (
        <span
          class={storage.warning ? "warning" : undefined}
          title={storage.title}
        >
          {storage.text}
        </span>
      )}
      {agent && agentStatus && (
        <span
          class={
            agent.state.state === "connected"
              ? "agent-status"
              : "agent-status warning"
          }
        >
          {agentStatus}{" "}
          {agent.state.state === "connected" && (
            <button
              type="button"
              class="link"
              title="The agent's tools stop working until you connect it again (Help ▸ Connect an agent)"
              onClick={agent.onDisconnect}
            >
              Disconnect
            </button>
          )}
        </span>
      )}
    </div>
  );
}

export function Footer({
  store,
  runtime,
  kept = { state: "off" },
  selected,
  onSelect,
  onOpen,
  agent,
  compact = false,
}: Props) {
  // the command line of a compact layout, behind its button (#378)
  const [lineOpen, setLineOpen] = useState(false);
  const slot = useRef<HTMLDivElement>(null);
  const toggleLine = () => {
    setLineOpen(!lineOpen);
    if (lineOpen || !slot.current) return;
    // shown and focused in the tap itself, so that a phone shows its keyboard
    slot.current.hidden = false;
    slot.current.querySelector("input")?.focus();
  };
  return (
    <footer class="footer">
      <div class="command-line">
        <div
          ref={slot}
          id="command-line"
          class="command-slot"
          hidden={compact && !lineOpen}
        >
          <CommandLine store={store} onSelect={onSelect} onOpen={onOpen} />
        </div>
        <Status
          store={store}
          runtime={runtime}
          kept={kept}
          agent={agent}
          compact={compact}
        />
      </div>
      <History
        store={store}
        selected={selected}
        onSelect={onSelect}
        tools={
          compact && (
            <button
              type="button"
              class="icon-button"
              aria-label="Command line"
              aria-controls="command-line"
              aria-expanded={lineOpen}
              title="Type a command"
              onClick={toggleLine}
            >
              <Icon name="terminal" />
            </button>
          )
        }
      />
    </footer>
  );
}
