import type { ModelStore } from "../core/store";
import { type Runtime, runtimeText } from "./hooks";

export function Footer({
  store,
  runtime,
}: {
  store: ModelStore;
  runtime: Runtime;
}) {
  const issues = store.issues.length;
  return (
    <footer class="footer">
      <div class="command-line">
        <label for="command" class="prompt">
          ›
        </label>
        <input
          id="command"
          class="command-input"
          disabled
          placeholder="Commands can be typed here soon."
        />
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
      <div class="history" aria-label="History">
        <span class="muted">
          History: {store.commands.map((c) => c.name).join(" · ") || "empty"}
        </span>
      </div>
    </footer>
  );
}
