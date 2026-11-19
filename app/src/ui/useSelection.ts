// The selected object and the hidden objects of the model (#312): selecting,
// the properties panel (#83), showing and hiding, renaming, duplicating (#138)
// and deleting an object, and the context menu of an object in the browser.
import { useMemo, useState } from "preact/hooks";
import { duplicateBlocker } from "../core/duplicate";
import { isMeshObject } from "../core/meshfiles";
import { hiddenObjects } from "../core/meshtools";
import { ariaKeys, hint, type ShortcutId } from "../core/shortcuts";
import type { ModelStore } from "../core/store";
import { KINDS } from "../core/validate";
import { VISIBLE_KINDS } from "./Browser";
import type { MenuItem } from "./Menu";
import type { Workspace } from "./Ribbon";
import type { Banner } from "./useProject";

export function useSelection(
  store: ModelStore,
  workspace: Workspace,
  onError: (banner: Banner) => void,
) {
  const [selection, setSelection] = useState<string | undefined>();
  // the properties panel on the right opens when an object is selected (#83)
  const [inspecting, setInspecting] = useState(false);
  const select = (id: string | undefined) => {
    setSelection(id);
    setInspecting(id !== undefined);
  };
  // the objects whose visibility the user changed: hidden, or a mesh that another
  // tool uses (hidden by default, ADR 0019) shown
  const [toggled, setToggled] = useState<ReadonlySet<string>>(new Set());
  const hidden: ReadonlySet<string> = useMemo(
    () => hiddenObjects(store.commands, toggled),
    [store.commands, toggled],
  );
  // a selection that was removed (or renamed) is gone
  const selected = selection && store.get(selection) ? selection : undefined;
  const toggleVisible = (id: string) =>
    setToggled((current) => {
      const next = new Set(current);
      if (!next.delete(id)) next.add(id);
      return next;
    });

  /** Whether an object can be shown or hidden in the viewport. */
  const visible = (name: string) => {
    const command = store.get(name);
    return command !== undefined && VISIBLE_KINDS.has(KINDS[command.command]);
  };

  /** Delete an object, unless other objects use it. */
  const remove = (name: string) => {
    const dependents = store.dependents(name);
    if (dependents.length > 0) {
      onError({
        title: `${name} cannot be deleted.`,
        lines: [`It is used by ${dependents.join(", ")}: delete these first.`],
      });
      return;
    }
    store.apply({ type: "remove", name });
    select(undefined);
  };

  /** Duplicate an object and select the copy (#138). */
  const duplicate = (name: string) => {
    const copy = store.duplicate(name);
    if (copy) select(copy);
  };

  /** Show the properties of the selected object with the focus on its name. */
  const rename = () => {
    setInspecting(true);
    requestAnimationFrame(() => {
      const input = document.querySelector<HTMLInputElement>(
        '[aria-label="Properties"] #field-name',
      );
      input?.focus();
      input?.select();
    });
  };

  return {
    /** The selected name, also of an object that is gone. */
    selection,
    /** The selected object, if it exists. */
    selected,
    select,
    /** The panel shows the properties of a selected object in the Model workspace. */
    showInspector:
      inspecting && selected !== undefined && workspace === "model",
    closeInspector: () => setInspecting(false),
    hidden,
    toggleVisible,
    visible,
    remove,
    duplicate,
    rename,
    /** A project was opened or started: nothing is selected or hidden. */
    reset: () => {
      setSelection(undefined);
      setToggled(new Set());
    },
  };
}

export type Selection = ReturnType<typeof useSelection>;

interface MenuOptions {
  /** Why the mesh cannot be exported, if it is a mesh (#230). */
  exportBlocker: (name: string) => string | undefined;
  onExportMesh: (name: string) => void;
  onParameters: () => void;
}

/** The items of the context menu of an object in the browser (#138). */
export function objectMenu(
  store: ModelStore,
  selection: Selection,
  name: string,
  { exportBlocker, onExportMesh, onParameters }: MenuOptions,
): MenuItem[] {
  const command = store.get(name);
  if (!command) return [];
  const dependents = store.dependents(name);
  const keys = (id: ShortcutId) => ({ text: hint(id), aria: ariaKeys(id) });
  const blocker = duplicateBlocker(command);
  const meshBlocker = isMeshObject(command) ? exportBlocker(name) : undefined;
  return [
    {
      id: "duplicate",
      label: "Duplicate",
      shortcut: keys("duplicate"),
      ...(blocker ? { blocker } : {}),
      onSelect: () => selection.duplicate(name),
    },
    ...(isMeshObject(command)
      ? [
          {
            id: "export-mesh",
            label: "Export mesh…",
            hint: "As a VTU, VTK, Gmsh, Abaqus or Nastran file",
            ...(meshBlocker ? { blocker: meshBlocker } : {}),
            onSelect: () => onExportMesh(name),
          },
        ]
      : []),
    ...(command.command === "parameter.add"
      ? [{ id: "parameters", label: "All parameters…", onSelect: onParameters }]
      : []),
    {
      id: "rename",
      label: "Rename",
      shortcut: keys("rename"),
      onSelect: () => {
        selection.select(name);
        selection.rename();
      },
    },
    ...(selection.visible(name)
      ? [
          {
            id: "visibility",
            label: selection.hidden.has(name) ? "Show" : "Hide",
            shortcut: keys("visibility"),
            onSelect: () => selection.toggleVisible(name),
          },
        ]
      : []),
    {
      id: "delete",
      label: "Delete",
      shortcut: keys("delete"),
      ...(dependents.length
        ? { blocker: `Used by ${dependents.join(", ")}: delete these first.` }
        : {}),
      onSelect: () => selection.remove(name),
    },
  ];
}
