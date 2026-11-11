// The keyboard shortcuts and mouse actions of the app, listed in Help ▸ Keyboard
// shortcuts (#126). Every entry describes what the app does already; new shortcuts
// are added here together with their handler (#129).

/** A key combination, e.g. ["Mod", "Shift", "Z"]; "Mod" is Ctrl or ⌘ on macOS. */
export type Keys = string[];

export interface Shortcut {
  /** Alternatives, e.g. Ctrl+Shift+Z or Ctrl+Y. */
  keys: Keys[];
  action: string;
}

export interface ShortcutGroup {
  title: string;
  shortcuts: Shortcut[];
}

export const SHORTCUTS: ShortcutGroup[] = [
  {
    title: "General",
    shortcuts: [
      { keys: [["Mod", "Z"]], action: "Undo" },
      {
        keys: [
          ["Mod", "Shift", "Z"],
          ["Mod", "Y"],
        ],
        action: "Redo",
      },
      { keys: [["Esc"]], action: "Close a dialog or a menu" },
    ],
  },
  {
    title: "Viewport",
    shortcuts: [
      { keys: [["Drag"]], action: "Rotate" },
      { keys: [["Shift", "Drag"], ["Right drag"]], action: "Pan" },
      { keys: [["Scroll"]], action: "Zoom" },
      { keys: [["Double-click"]], action: "Reset the view" },
      { keys: [["Click"]], action: "Pick a face, or a node with Nodes shown" },
      { keys: [["Shift", "Click"]], action: "Pick more nodes" },
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
