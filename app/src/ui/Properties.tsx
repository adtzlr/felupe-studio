import type { Draft } from "../core/form";
import { KIND_LABELS } from "../core/registry";
import type { ModelStore } from "../core/store";
import { KINDS } from "../core/validate";
import { CommandForm } from "./CommandForm";
import { Icon, type IconName } from "./icons";

interface Props {
  store: ModelStore;
  selected?: string;
  onSelect: (id: string) => void;
}

export function Properties({ store, selected, onSelect }: Props) {
  const command = selected ? store.get(selected) : undefined;
  if (!command) return <p class="muted">Select an object in the browser.</p>;

  const kind = KINDS[command.command];
  const issues = store.issues
    .filter((i) => i.name === command.name)
    .map((i) => i.message);
  const notes =
    findNode(store, command.name)?.issues.filter((m) => !issues.includes(m)) ??
    [];
  const messages = [...issues, ...notes];
  const dependents = store.dependents(command.name);

  return (
    <div class="properties-content">
      <div class="properties-head">
        <Icon name={kind as IconName} />
        <strong>{KIND_LABELS[kind]}</strong>
        <code class="muted">{command.command}</code>
      </div>
      <CommandForm
        // a new form whenever the command changes, e.g. by undo
        key={JSON.stringify(command)}
        type={command.command}
        initial={command as unknown as Draft}
        context={{ commands: store.commands, editing: command.name }}
        submitLabel="Apply"
        requireChange
        onSubmit={(next) => {
          store.update(command.name, next);
          onSelect(next.name);
        }}
      >
        <button
          type="button"
          class="button"
          disabled={dependents.length > 0}
          title={
            dependents.length > 0
              ? `Used by ${dependents.join(", ")}: delete these first.`
              : `Delete ${command.name}`
          }
          onClick={() => store.apply({ type: "remove", name: command.name })}
        >
          <Icon name="trash" size={14} />
          Delete
        </button>
      </CommandForm>
      {messages.length > 0 && (
        <ul class="issues" aria-label="Issues">
          {messages.map((message) => (
            <li key={message}>
              <Icon name="warning" size={14} />
              {message}
            </li>
          ))}
        </ul>
      )}
      {dependents.length > 0 && (
        <p class="used-by">
          Used by{" "}
          {dependents.map((name, i) => (
            <span key={name}>
              {i > 0 && ", "}
              <button type="button" class="link" onClick={() => onSelect(name)}>
                {name}
              </button>
            </span>
          ))}
        </p>
      )}
    </div>
  );
}

function findNode(store: ModelStore, name: string) {
  const stack = [...store.tree];
  while (stack.length) {
    const node = stack.pop()!;
    if (node.id === name && node.kind !== "group") return node;
    stack.push(...node.children);
  }
  return undefined;
}
