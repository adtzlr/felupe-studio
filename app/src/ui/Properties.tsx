import type { Draft } from "../core/form";
import type { MeshFiles } from "../core/meshfiles";
import { KIND_LABELS } from "../core/registry";
import type { ModelStore } from "../core/store";
import { KINDS } from "../core/validate";
import { CommandForm } from "./CommandForm";
import { Icon, type IconName } from "./icons";
import { MeshFileStatus } from "./MeshFileStatus";

interface Props {
  store: ModelStore;
  files: MeshFiles;
  /** Messages about the mesh files, by object name. */
  notes: Map<string, string[]>;
  selected?: string;
  onSelect: (id: string) => void;
}

export function Properties({ store, files, notes, selected, onSelect }: Props) {
  const command = selected ? store.get(selected) : undefined;
  if (!command) return <p class="muted">Select an object in the browser.</p>;

  const kind = KINDS[command.command];
  const own = store.issues.filter((i) => i.name === command.name);
  // an issue of a field is shown at the field (#137), the others below the form
  const fieldIssues: Record<string, string> = {};
  for (const issue of own) {
    if (issue.field && !(issue.field in fieldIssues))
      fieldIssues[issue.field] = withoutIndex(issue.message);
  }
  const issues = own.filter((i) => !i.field).map((i) => i.message);
  const reported =
    findNode(store, command.name)?.issues.filter(
      (m) => !own.some((i) => i.message === m),
    ) ?? [];
  // a missing file is shown by the file status
  const messages = [...issues, ...reported, ...(notes.get(command.name) ?? [])]
    .filter((message) => !message.includes("is not loaded"))
    .map(withoutIndex);
  const dependents = store.dependents(command.name);
  // a control point is a point set of one point, with a label of its own (#95)
  const control = command.command === "point.add";
  // the values of a rotation point are rotations (#98)
  const rotation =
    command.command === "boundary.add"
      ? store.commands.find(
          (c) => c.command === "mpc.add" && c.rotation === command.pointset,
        )
      : command.command === "point.add"
        ? store.commands.find(
            (c) => c.command === "mpc.add" && c.rotation === command.name,
          )
        : undefined;

  return (
    <div class="properties-content">
      <div class="properties-head">
        <Icon name={(control ? "point" : kind) as IconName} />
        <strong>{control ? "Control point" : KIND_LABELS[kind]}</strong>
        <code class="muted">{command.command}</code>
      </div>
      {(command.command === "mesh.import" ||
        command.command === "mesh.script") && (
        <MeshFileStatus
          command={command}
          commands={store.commands}
          files={files}
        />
      )}
      <CommandForm
        // a new form whenever the command changes, e.g. by undo
        key={JSON.stringify(command)}
        type={command.command}
        initial={command as unknown as Draft}
        context={{ commands: store.commands, editing: command.name }}
        submitLabel="Apply"
        requireChange
        issues={fieldIssues}
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
      {rotation && (
        <p class="muted note">
          {command.command === "boundary.add"
            ? `${command.pointset} is the rotation point of ${rotation.name}: the values are rotations about its center point in rad, a curve shows the moment over the rotation.`
            : `The rotation point of ${rotation.name}: its values are rotations about the center point in rad; its coordinates are not used.`}
        </p>
      )}
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

/** A message without the index of its command, e.g. `commands/3: `. */
const withoutIndex = (message: string) =>
  message.replace(/^commands\/\d+: /, "");

function findNode(store: ModelStore, name: string) {
  const stack = [...store.tree];
  while (stack.length) {
    const node = stack.pop()!;
    if (node.id === name && node.kind !== "group") return node;
    stack.push(...node.children);
  }
  return undefined;
}
