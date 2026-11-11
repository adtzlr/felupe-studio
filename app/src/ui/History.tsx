// History bar: the command list in order. A click selects the object; undo and redo
// step through the changes.
import { withHint } from "../core/shortcuts";
import { useEffect, useRef } from "preact/hooks";
import type { ModelStore } from "../core/store";
import { KINDS } from "../core/validate";
import { Icon, type IconName } from "./icons";

interface Props {
  store: ModelStore;
  selected?: string;
  onSelect: (name: string) => void;
}

export function History({ store, selected, onSelect }: Props) {
  const list = useRef<HTMLOListElement>(null);
  const withIssues = new Set(store.issues.map((i) => i.name));

  useEffect(() => {
    if (!selected || !list.current) return;
    const item = list.current.querySelector<HTMLElement>(
      `[data-name="${CSS.escape(selected)}"]`,
    );
    item?.scrollIntoView?.({ block: "nearest", inline: "nearest" });
  }, [selected]);

  return (
    <section class="history" aria-label="History">
      <button
        type="button"
        class="icon-button"
        aria-label="Step back"
        title={withHint("Undo", "undo")}
        disabled={!store.canUndo}
        onClick={() => store.undo()}
      >
        <Icon name="undo" />
      </button>
      <button
        type="button"
        class="icon-button"
        aria-label="Step forward"
        title={withHint("Redo", "redo")}
        disabled={!store.canRedo}
        onClick={() => store.redo()}
      >
        <Icon name="redo" />
      </button>
      <span class="history-separator" aria-hidden="true" />
      {store.commands.length === 0 ? (
        <span class="muted">No commands yet.</span>
      ) : (
        <ol ref={list} class="history-items">
          {store.commands.map((command, index) => (
            <li key={command.name}>
              <button
                type="button"
                class="history-item"
                data-name={command.name}
                aria-pressed={command.name === selected}
                title={`${index + 1}. ${command.command}`}
                onClick={() => onSelect(command.name)}
              >
                <Icon name={KINDS[command.command] as IconName} size={14} />
                {command.name}
                {withIssues.has(command.name) && (
                  <span class="history-issue" aria-label="has issues">
                    <Icon name="warning" size={12} />
                  </span>
                )}
              </button>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
