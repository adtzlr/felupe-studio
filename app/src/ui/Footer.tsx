import type { ModelStore } from "../core/store";
import type { CommandType } from "../core/validate";
import { CommandLine } from "./CommandLine";
import { History } from "./History";
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
}

export function Footer({
  store,
  runtime,
  kept = { state: "off" },
  selected,
  onSelect,
  onOpen,
}: Props) {
  const issues = store.issues.length;
  const storage = keptText(kept);
  return (
    <footer class="footer">
      <div class="command-line">
        <CommandLine store={store} onSelect={onSelect} onOpen={onOpen} />
        <div class="status" role="status">
          <span class={runtime.state === "error" ? "error" : undefined}>
            {runtimeText(runtime)}
          </span>
          <span>
            {store.commands.length}{" "}
            {store.commands.length === 1 ? "command" : "commands"}
          </span>
          <span class={issues ? "warning" : undefined}>
            {issues} {issues === 1 ? "issue" : "issues"}
          </span>
          {storage && (
            <span
              class={storage.warning ? "warning" : undefined}
              title={storage.title}
            >
              {storage.text}
            </span>
          )}
        </div>
      </div>
      <History store={store} selected={selected} onSelect={onSelect} />
    </footer>
  );
}
