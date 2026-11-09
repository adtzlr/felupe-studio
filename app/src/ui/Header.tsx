import { APP_NAME, formatVersion } from "../app";
import type { ModelStore } from "../core/store";
import type { Runtime } from "./hooks";
import { Icon } from "./icons";

interface Props {
  store: ModelStore;
  fileName: string;
  modified: boolean;
  runtime: Runtime;
  onOpen: () => void;
  onSave: () => void;
}

export function Header({
  store,
  fileName,
  modified,
  runtime,
  onOpen,
  onSave,
}: Props) {
  return (
    <header class="header">
      <div class="header-group">
        <span class="brand" title={`Version ${formatVersion(__APP_VERSION__)}`}>
          <Icon name="logo" size={20} />
          {APP_NAME}
        </span>
        <button
          type="button"
          class="icon-button"
          aria-label="Open project"
          title="Open project"
          onClick={onOpen}
        >
          <Icon name="open" />
        </button>
        <button
          type="button"
          class="icon-button"
          aria-label="Save project"
          title="Save project"
          onClick={onSave}
        >
          <Icon name="save" />
        </button>
        <button
          type="button"
          class="icon-button"
          aria-label="Undo"
          title="Undo (Ctrl+Z)"
          disabled={!store.canUndo}
          onClick={() => store.undo()}
        >
          <Icon name="undo" />
        </button>
        <button
          type="button"
          class="icon-button"
          aria-label="Redo"
          title="Redo (Ctrl+Shift+Z)"
          disabled={!store.canRedo}
          onClick={() => store.redo()}
        >
          <Icon name="redo" />
        </button>
      </div>
      <div class="project-name">
        {fileName}
        {modified && <span aria-label="modified"> •</span>}
      </div>
      <div class="header-group">
        <button
          type="button"
          class="button"
          disabled
          title={
            runtime.state === "ready"
              ? "Running jobs is not available yet."
              : "Python is still loading."
          }
        >
          <Icon name="play" size={12} />
          Solve
        </button>
      </div>
    </header>
  );
}
