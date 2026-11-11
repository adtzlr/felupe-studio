import { APP_NAME, formatVersion, LINKS } from "../app";
import type { ModelStore } from "../core/store";
import { Icon } from "./icons";
import { Menu, type MenuItem } from "./Menu";

/** An export of the project: the script, the results or a picture. */
export type ExportItem = MenuItem;

interface Props {
  store: ModelStore;
  fileName: string;
  modified: boolean;
  onNew: () => void;
  onOpen: () => void;
  onSamples: () => void;
  onSave: () => void;
  onShortcuts: () => void;
  onAbout: () => void;
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
  onNew,
  onOpen,
  onSamples,
  onSave,
  onShortcuts,
  onAbout,
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
        <div class="menubar">
          <Menu
            kind="text"
            label="File"
            button="File"
            sections={[
              {
                items: [
                  { id: "new", label: "New project", onSelect: onNew },
                  {
                    id: "open",
                    label: "Open project…",
                    hint: "A project file with its mesh files, or mesh files to import",
                    onSelect: onOpen,
                  },
                  { id: "samples", label: "Samples…", onSelect: onSamples },
                ],
              },
              {
                items: [
                  { id: "save", label: "Save project", onSelect: onSave },
                ],
              },
              { label: "Export", items: exports },
            ]}
          />
          <Menu
            kind="text"
            label="Help"
            button="Help"
            sections={[
              {
                items: [
                  { id: "guide", label: "User guide", href: LINKS.guide },
                  {
                    id: "reference",
                    label: "Command reference",
                    href: LINKS.reference,
                  },
                  {
                    id: "shortcuts",
                    label: "Keyboard shortcuts",
                    onSelect: onShortcuts,
                  },
                ],
              },
              {
                items: [
                  {
                    id: "issue",
                    label: "Report an issue",
                    href: LINKS.issues,
                  },
                  {
                    id: "about",
                    label: `About ${APP_NAME}`,
                    onSelect: onAbout,
                  },
                ],
              },
            ]}
          />
        </div>
        <span class="header-separator" aria-hidden="true" />
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
        <Menu
          kind="icon"
          label="Export"
          button={<Icon name="export" />}
          title="Export the script, the results or a picture"
          sections={[{ items: exports }]}
          hints
        />
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
