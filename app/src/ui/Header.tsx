import { useEffect, useLayoutEffect, useRef, useState } from "preact/hooks";
import { APP_NAME, formatVersion, LINKS } from "../app";
import { projectNameProblem, stemOf, suffixOf } from "../core/files";
import { ariaKeys, hint, withHint } from "../core/shortcuts";
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
  onSaveAs: () => void;
  /** Rename the project: the new file name with the suffix of its format (#205). */
  onRename: (fileName: string) => void;
  onShortcuts: () => void;
  onAbout: () => void;
  /** The browser is open as a drawer (narrow windows, #131), and its toggle. */
  browserOpen: boolean;
  onBrowser: () => void;
  exports: ExportItem[];
  solve: {
    /** Why the jobs cannot be run, if so. */
    blocker?: string;
    running: boolean;
    onSolve: () => void;
    onCancel: () => void;
  };
}

/**
 * The field to rename the project (#205): Enter or leaving the field renames,
 * Escape cancels; the suffix (the format) stays. An invalid name is not taken.
 */
function RenameField({
  fileName,
  onDone,
  onRename,
}: {
  fileName: string;
  onDone: () => void;
  onRename: (fileName: string) => void;
}) {
  const [stem, setStem] = useState(stemOf(fileName));
  const input = useRef<HTMLInputElement>(null);
  // finished once: by Enter or Escape, not again by the blur of the removed field
  const done = useRef(false);
  const suffix = suffixOf(fileName);
  const problem = projectNameProblem(stem);
  useLayoutEffect(() => {
    input.current?.focus();
    input.current?.select();
  }, []);
  const finish = (rename: boolean) => {
    if (done.current) return;
    done.current = true;
    const name = stem.trim();
    if (rename && !problem && `${name}${suffix}` !== fileName) {
      onRename(`${name}${suffix}`);
    }
    onDone();
  };
  return (
    <form
      class="project-rename"
      onSubmit={(event) => {
        event.preventDefault();
        if (!problem) finish(true);
      }}
    >
      <input
        ref={input}
        type="text"
        aria-label="Project name"
        value={stem}
        autocomplete="off"
        spellcheck={false}
        aria-invalid={problem ? true : undefined}
        aria-describedby={problem ? "project-name-problem" : undefined}
        onInput={(event) => setStem(event.currentTarget.value)}
        onKeyDown={(event) => {
          if (event.key !== "Escape") return;
          event.preventDefault();
          event.stopPropagation();
          finish(false);
        }}
        // leaving the field renames, an invalid name keeps the old one
        onBlur={() => finish(true)}
      />
      <span class="muted">{suffix}</span>
      {problem && (
        <small id="project-name-problem" class="field-error" role="alert">
          {problem}
        </small>
      )}
    </form>
  );
}

/** The name of the project, a button that turns into a field to rename it. */
function ProjectName({
  fileName,
  modified,
  editing,
  onEditing,
  onRename,
}: {
  fileName: string;
  modified: boolean;
  editing: boolean;
  onEditing: (editing: boolean) => void;
  onRename: (fileName: string) => void;
}) {
  const button = useRef<HTMLButtonElement>(null);
  const restore = useRef(false);
  // back to the name after renaming, unless the focus went elsewhere
  useEffect(() => {
    if (editing || !restore.current) return;
    restore.current = false;
    const active = document.activeElement;
    if (!active || active === document.body) button.current?.focus();
  }, [editing]);
  if (editing) {
    return (
      <RenameField
        fileName={fileName}
        onRename={onRename}
        onDone={() => {
          restore.current = true;
          onEditing(false);
        }}
      />
    );
  }
  return (
    <button
      ref={button}
      type="button"
      class="project-name"
      title="Rename the project"
      onClick={() => onEditing(true)}
    >
      {fileName}
      {modified && <span aria-label="modified"> •</span>}
    </button>
  );
}

export function Header({
  store,
  fileName,
  modified,
  onNew,
  onOpen,
  onSamples,
  onSave,
  onSaveAs,
  onRename,
  onShortcuts,
  onAbout,
  browserOpen,
  onBrowser,
  exports,
  solve,
}: Props) {
  const [renaming, setRenaming] = useState(false);
  return (
    <header class="header">
      <div class="header-group">
        <button
          type="button"
          class="icon-button drawer-toggle"
          aria-label="Browser"
          aria-controls="browser"
          aria-expanded={browserOpen}
          title="Show the browser of the model"
          onClick={onBrowser}
        >
          <Icon name="browser" />
        </button>
        <span class="brand" title={`Version ${formatVersion(__APP_VERSION__)}`}>
          <Icon name="logo" size={20} />
          <span class="brand-name">{APP_NAME}</span>
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
                    hint: "A project file with its mesh files, a project archive, or mesh files to import",
                    shortcut: { text: hint("open"), aria: ariaKeys("open") },
                    onSelect: onOpen,
                  },
                  { id: "samples", label: "Samples…", onSelect: onSamples },
                ],
              },
              {
                items: [
                  {
                    id: "save",
                    label: "Save project",
                    hint: "In its format: a project file or an archive",
                    shortcut: { text: hint("save"), aria: ariaKeys("save") },
                    onSelect: onSave,
                  },
                  {
                    id: "save-as",
                    label: "Save project as…",
                    hint: "With another name, as a project file or an archive with the mesh files",
                    shortcut: {
                      text: hint("save-as"),
                      aria: ariaKeys("save-as"),
                    },
                    onSelect: onSaveAs,
                  },
                  {
                    id: "rename",
                    label: "Rename project…",
                    hint: "The name of the next save and of the exports, without saving",
                    // after the menu has closed and given back the focus
                    onSelect: () => setTimeout(() => setRenaming(true)),
                  },
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
                    shortcut: { text: hint("help"), aria: ariaKeys("help") },
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
          title={withHint(
            "Open a project file with its mesh files, a project archive, or mesh files to import",
            "open",
          )}
          onClick={onOpen}
        >
          <Icon name="open" />
        </button>
        <button
          type="button"
          class="icon-button"
          aria-label="Save project"
          title={withHint("Save project", "save")}
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
          title={withHint("Undo", "undo")}
          disabled={!store.canUndo}
          onClick={() => store.undo()}
        >
          <Icon name="undo" />
        </button>
        <button
          type="button"
          class="icon-button"
          aria-label="Redo"
          title={withHint("Redo", "redo")}
          disabled={!store.canRedo}
          onClick={() => store.redo()}
        >
          <Icon name="redo" />
        </button>
      </div>
      <ProjectName
        fileName={fileName}
        modified={modified}
        editing={renaming}
        onEditing={setRenaming}
        onRename={onRename}
      />
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
              title={
                solve.blocker ?? withHint("Run the jobs of the model", "solve")
              }
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
