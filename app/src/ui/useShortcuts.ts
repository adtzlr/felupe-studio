// The keyboard shortcuts of the app (#129, #312), with the state of the latest
// render.
import { useEffect, useRef } from "preact/hooks";
import {
  dialogOpen,
  isNavigating,
  isTyping,
  matches,
  type ShortcutId,
} from "../core/shortcuts";

/** What the shortcuts act on: the state of the app and its actions. */
export interface Keys {
  /** The selected object in the Model workspace, if any. */
  object?: string;
  /** Whether the selected object can be shown or hidden. */
  visible: boolean;
  /** Whether an object is selected, which Escape deselects. */
  selected: boolean;
  /** An open drawer of the browser in a narrow window, which Escape closes. */
  drawer: boolean;
  /** The Results workspace: the keys of the substeps and of the player. */
  results: boolean;
  /** Whether Solve is offered. */
  canSolve: boolean;
  save(): void;
  saveAs(): void;
  solve(): void;
  open(): void;
  undo(): void;
  redo(): void;
  help(): void;
  remove(name: string): void;
  rename(): void;
  duplicate(name: string): void;
  toggleVisible(name: string): void;
  closeDrawer(): void;
  deselect(): void;
  moveSubstep(to: "previous" | "next" | "first" | "last"): void;
  play(): void;
}

interface Shortcut {
  id: ShortcutId;
  /** Whether the shortcut acts now; else the key may be another shortcut. */
  when?: (keys: Keys, event: KeyboardEvent) => boolean;
  run: (keys: Keys) => void;
}

/** Saving and solving also work while typing, e.g. in the properties. */
const WHILE_TYPING: readonly Shortcut[] = [
  { id: "save", run: (keys) => keys.save() },
  { id: "save-as", run: (keys) => keys.saveAs() },
  {
    id: "solve",
    run: (keys) => {
      if (keys.canSolve) keys.solve();
    },
  },
];

/** The shortcuts of the app and of the selected object. */
const MODEL: readonly Shortcut[] = [
  { id: "open", run: (keys) => keys.open() },
  { id: "undo", run: (keys) => keys.undo() },
  { id: "redo", run: (keys) => keys.redo() },
  { id: "help", run: (keys) => keys.help() },
  {
    id: "delete",
    when: (keys) => keys.object !== undefined,
    run: (keys) => keys.remove(keys.object!),
  },
  {
    id: "rename",
    when: (keys) => keys.object !== undefined,
    run: (keys) => keys.rename(),
  },
  {
    id: "duplicate",
    when: (keys) => keys.object !== undefined,
    run: (keys) => keys.duplicate(keys.object!),
  },
  {
    id: "visibility",
    when: (keys) => keys.object !== undefined && keys.visible,
    run: (keys) => keys.toggleVisible(keys.object!),
  },
  {
    id: "escape",
    when: (keys) => keys.drawer,
    run: (keys) => keys.closeDrawer(),
  },
  {
    id: "escape",
    when: (keys) => keys.selected,
    run: (keys) => keys.deselect(),
  },
];

/** The shortcuts of the Results workspace, not while a list is navigated. */
const RESULTS: readonly Shortcut[] = [
  { id: "substep-previous", run: (keys) => keys.moveSubstep("previous") },
  { id: "substep-next", run: (keys) => keys.moveSubstep("next") },
  { id: "substep-first", run: (keys) => keys.moveSubstep("first") },
  { id: "substep-last", run: (keys) => keys.moveSubstep("last") },
  {
    id: "play",
    // Space on a button presses it
    when: (_, event) =>
      !(event.target as Element | null)?.closest?.("button, a, summary"),
    run: (keys) => keys.play(),
  },
];

/** The shortcut of a key, if it is one now. */
function shortcutOf(event: KeyboardEvent, keys: Keys): Shortcut | undefined {
  const first = (list: readonly Shortcut[]) =>
    list.find((s) => matches(event, s.id) && (s.when?.(keys, event) ?? true));
  const typed = first(WHILE_TYPING);
  if (typed || isTyping(event.target)) return typed;
  const model = first(MODEL);
  if (model || isNavigating(event.target) || !keys.results) return model;
  return first(RESULTS);
}

/** Act on a key, and prevent its default action if it was a shortcut. */
export function onKey(event: KeyboardEvent, keys: Keys) {
  if (event.defaultPrevented || dialogOpen()) return;
  const shortcut = shortcutOf(event, keys);
  if (!shortcut) return;
  shortcut.run(keys);
  event.preventDefault();
}

/** Listen to the keys of the window with the keys of the latest render. */
export function useShortcuts(keys: Keys) {
  const latest = useRef(keys);
  latest.current = keys;
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => onKey(event, latest.current);
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);
}
