import { APP_NAME, formatVersion } from "../app";
import type { ModelStore } from "../core/store";
import { type ExportItem, ExportMenu } from "./ExportMenu";
import { Icon } from "./icons";

interface Props {
  store: ModelStore;
  fileName: string;
  modified: boolean;
  onOpen: () => void;
  onSave: () => void;
  exports: ExportItem[];
  solve: {
    /** Why the jobs cannot be run, if so. */
    blocker?: string;
    running: boolean;
    onSolve: () => void;
    onCancel: () => void;
  };
}

export function Header({
  store,
  fileName,
  modified,
  onOpen,
  onSave,
  exports,
  solve,
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
          title="Open a project file with its mesh files, or mesh files to import"
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
        <ExportMenu items={exports} />
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
        {solve.running ? (
          <button type="button" class="button" onClick={solve.onCancel}>
            <Icon name="stop" size={12} />
            Cancel
          </button>
        ) : (
          <>
            <button
              type="button"
              class="button primary"
              aria-disabled={solve.blocker ? true : undefined}
              aria-describedby={solve.blocker ? "solve-blocker" : undefined}
              title={solve.blocker ?? "Run the jobs of the model"}
              onClick={() => !solve.blocker && solve.onSolve()}
            >
              <Icon name="play" size={12} />
              Solve
            </button>
            {solve.blocker && (
              <span id="solve-blocker" hidden>
                {solve.blocker}
              </span>
            )}
          </>
        )}
      </div>
    </header>
  );
}
