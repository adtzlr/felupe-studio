import type { ModelStore } from "../core/store";
import type { CommandType } from "../core/validate";
import { CommandLine } from "./CommandLine";
import { History } from "./History";
import { type Runtime, runtimeText } from "./hooks";

interface Props {
  store: ModelStore;
  runtime: Runtime;
  selected?: string;
  onSelect: (name: string) => void;
  onOpen: (type: CommandType) => void;
}

export function Footer({ store, runtime, selected, onSelect, onOpen }: Props) {
  const issues = store.issues.length;
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
        </div>
      </div>
      <History store={store} selected={selected} onSelect={onSelect} />
    </footer>
  );
}
