import type { ModelStore } from "../core/store";
import { KINDS } from "../core/validate";
import { Icon, type IconName } from "./icons";
import { fields, KIND_LABELS } from "./properties";

interface Props {
  store: ModelStore;
  selected?: string;
  onSelect: (id: string) => void;
}

export function Properties({ store, selected, onSelect }: Props) {
  const command = selected ? store.get(selected) : undefined;
  if (!command) return <p class="muted">Select an object in the browser.</p>;

  const kind = KINDS[command.command];
  const issues = store.issues.filter((i) => i.name === command.name);
  const node = findNode(store, command.name);
  const notes =
    node?.issues.filter((m) => !issues.some((i) => i.message === m)) ?? [];
  const dependents = store.dependents(command.name);

  return (
    <div class="properties-content">
      <div class="properties-head">
        <Icon name={kind as IconName} />
        <strong>{command.name}</strong>
        <span class="muted">
          {KIND_LABELS[kind]} · <code>{command.command}</code>
        </span>
      </div>
      <dl class="fields">
        {fields(command).map((f) => (
          <div key={f.label} class="field">
            <dt>{f.label}</dt>
            <dd>{f.value}</dd>
          </div>
        ))}
      </dl>
      {[...issues.map((i) => i.message), ...notes].length > 0 && (
        <ul class="issues" aria-label="Issues">
          {[...issues.map((i) => i.message), ...notes].map((message) => (
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
      <div class="actions">
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
      </div>
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
