// The keyboard shortcuts and mouse actions of the app (#126, #129): one list for
// Help ▸ Keyboard shortcuts, the menus, the tooltips and the handlers, so that they
// cannot disagree.

/** A key combination, e.g. ["Mod", "Shift", "Z"]; "Mod" is Ctrl or ⌘ on macOS. */
export type Keys = string[];

export interface Shortcut {
  /** The id of a shortcut that the app handles (mouse actions have none). */
  id?: ShortcutId;
  /** Alternatives, e.g. Ctrl+Shift+Z or Ctrl+Y. */
  keys: Keys[];
  action: string;
}

export interface ShortcutGroup {
  title: string;
  shortcuts: Shortcut[];
}

export type ShortcutId =
  | "save"
  | "open"
  | "solve"
  | "undo"
  | "redo"
  | "help"
  | "escape"
  | "delete"
  | "rename"
  | "fit"
  | "view-iso"
  | "view-xy"
  | "view-xz"
  | "view-yz"
  | "nodes"
  | "substep-previous"
  | "substep-next"
  | "substep-first"
  | "substep-last";

export const SHORTCUTS: ShortcutGroup[] = [
  {
    title: "General",
    shortcuts: [
      { id: "save", keys: [["Mod", "S"]], action: "Save the project" },
      {
        id: "open",
        keys: [["Mod", "O"]],
        action: "Open a project or mesh files",
      },
      { id: "solve", keys: [["Mod", "Enter"]], action: "Solve" },
      { id: "undo", keys: [["Mod", "Z"]], action: "Undo" },
      {
        id: "redo",
        keys: [
          ["Mod", "Shift", "Z"],
          ["Mod", "Y"],
        ],
        action: "Redo",
      },
      { id: "help", keys: [["?"]], action: "Show the keyboard shortcuts" },
      {
        id: "escape",
        keys: [["Esc"]],
        action:
          "Close a dialog, a menu or the browser drawer, clear a pick or the selection",
      },
    ],
  },
  {
    title: "Selected object",
    shortcuts: [
      {
        id: "delete",
        keys: [["Delete"], ["Backspace"]],
        action: "Delete it (if nothing uses it)",
      },
      { id: "rename", keys: [["F2"]], action: "Rename it in the properties" },
    ],
  },
  {
    title: "Viewport",
    shortcuts: [
      { id: "fit", keys: [["F"]], action: "Fit the model into the view" },
      { id: "view-iso", keys: [["1"]], action: "Isometric view" },
      { id: "view-xy", keys: [["2"]], action: "View onto the xy-plane" },
      { id: "view-xz", keys: [["3"]], action: "View onto the xz-plane" },
      { id: "view-yz", keys: [["4"]], action: "View onto the yz-plane" },
      { id: "nodes", keys: [["N"]], action: "Show or hide the nodes" },
      { keys: [["Drag"]], action: "Rotate" },
      { keys: [["Shift", "Drag"], ["Right drag"]], action: "Pan" },
      { keys: [["Scroll"]], action: "Zoom" },
      { keys: [["Double-click"]], action: "Reset the view" },
      { keys: [["Click"]], action: "Pick a face, or a node with Nodes shown" },
      { keys: [["Shift", "Click"]], action: "Pick more nodes" },
    ],
  },
  {
    title: "Results",
    shortcuts: [
      { id: "substep-previous", keys: [["←"]], action: "Previous substep" },
      { id: "substep-next", keys: [["→"]], action: "Next substep" },
      { id: "substep-first", keys: [["Home"]], action: "First substep" },
      { id: "substep-last", keys: [["End"]], action: "Last substep" },
    ],
  },
  {
    title: "Browser",
    shortcuts: [
      { keys: [["↑"], ["↓"]], action: "Previous or next object" },
      { keys: [["←"], ["→"]], action: "Collapse or expand a group" },
      { keys: [["Home"], ["End"]], action: "First or last object" },
      { keys: [["Enter"], ["Space"]], action: "Select the object" },
    ],
  },
  {
    title: "Command line",
    shortcuts: [
      {
        keys: [["↑"], ["↓"]],
        action: "Choose a suggestion, or recall an earlier line",
      },
      { keys: [["Tab"]], action: "Complete the suggestion" },
      { keys: [["Enter"]], action: "Run the line" },
      { keys: [["Esc"]], action: "Close the suggestions, or clear the line" },
    ],
  },
  {
    title: "Ribbon and menus",
    shortcuts: [
      { keys: [["←"], ["→"]], action: "Previous or next tab" },
      { keys: [["↑"], ["↓"]], action: "Previous or next menu item" },
    ],
  },
];

const BY_ID = new Map(
  SHORTCUTS.flatMap((group) =>
    group.shortcuts.flatMap((s) => (s.id ? [[s.id, s] as const] : [])),
  ),
);

/** The shortcut of an id. */
export function shortcut(id: ShortcutId): Shortcut {
  return BY_ID.get(id)!;
}

/** Whether the app runs on macOS (⌘ instead of Ctrl). */
export function isMac(
  platform = globalThis.navigator?.platform ?? "",
): boolean {
  return /mac|iphone|ipad/i.test(platform);
}

/** The text of a key combination, e.g. "Ctrl+Shift+Z" or "⌘⇧Z" on macOS. */
export function formatKeys(keys: Keys, mac = isMac()): string {
  if (mac) {
    const symbols: Record<string, string> = { Mod: "⌘", Shift: "⇧", Alt: "⌥" };
    const modifiers = keys.filter((key) => key in symbols);
    const rest = keys.filter((key) => !(key in symbols));
    if (rest.every((key) => key.length === 1)) {
      return modifiers.map((key) => symbols[key]).join("") + rest.join("");
    }
  }
  return keys.map((key) => (key === "Mod" ? "Ctrl" : key)).join("+");
}

/** The first key combination of a shortcut as text, e.g. for a menu. */
export function hint(id: ShortcutId, mac = isMac()): string {
  return formatKeys(shortcut(id).keys[0], mac);
}

/** The value of `aria-keyshortcuts` of a shortcut, e.g. "Control+S Meta+S". */
export function ariaKeys(id: ShortcutId): string {
  const name = (key: string) =>
    ({ Esc: "Escape", "←": "ArrowLeft", "→": "ArrowRight" })[key] ?? key;
  return shortcut(id)
    .keys.flatMap((keys) =>
      keys.includes("Mod")
        ? ["Control", "Meta"].map((mod) =>
            keys.map((k) => (k === "Mod" ? mod : name(k))).join("+"),
          )
        : [keys.map(name).join("+")],
    )
    .join(" ");
}

/** A tooltip with its shortcut, e.g. "Save project (Ctrl+S)". */
export function withHint(title: string, id: ShortcutId): string {
  return `${title} (${hint(id)})`;
}

// the names of KeyboardEvent.key for the names of the keys in the list
const KEY_NAMES: Record<string, string> = {
  Esc: "Escape",
  "←": "ArrowLeft",
  "→": "ArrowRight",
  "↑": "ArrowUp",
  "↓": "ArrowDown",
  Space: " ",
};

const MODIFIERS = ["Mod", "Shift", "Alt"];

/** Whether a key event is one of the key combinations of a shortcut. */
export function matches(event: KeyboardEvent, id: ShortcutId): boolean {
  return shortcut(id).keys.some((keys) => {
    const [key] = keys.filter((k) => !MODIFIERS.includes(k));
    const name = KEY_NAMES[key] ?? key;
    if ((event.ctrlKey || event.metaKey) !== keys.includes("Mod")) return false;
    if (event.altKey !== keys.includes("Alt")) return false;
    // a symbol like "?" needs Shift on most keyboards: only letters check it
    const letter = /^[a-z]$/i.test(name);
    if (letter && event.shiftKey !== keys.includes("Shift")) return false;
    if (!letter && keys.includes("Shift") && !event.shiftKey) return false;
    return event.key.toLowerCase() === name.toLowerCase();
  });
}

/** Whether the focus is in a field, where letters and arrows are typed. */
export function isTyping(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  if (target instanceof HTMLInputElement)
    return !["checkbox", "radio", "button", "submit"].includes(target.type);
  return ["TEXTAREA", "SELECT"].includes(target.tagName);
}

/** Whether the focus is in a widget that uses the keys itself, e.g. the tree. */
export function isNavigating(target: EventTarget | null): boolean {
  return (
    target instanceof Element &&
    target.closest(
      '[role="tree"], [role="tablist"], [role="menu"], [role="listbox"], [role="dialog"]',
    ) !== null
  );
}

/** Whether a modal dialog is open (it handles the keys itself). */
export const dialogOpen = () =>
  document.querySelector('[role="dialog"][aria-modal="true"]') !== null;
