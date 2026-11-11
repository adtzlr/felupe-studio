// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import {
  ariaKeys,
  formatKeys,
  isMac,
  isNavigating,
  isTyping,
  matches,
  SHORTCUTS,
  shortcut,
  withHint,
} from "./shortcuts";

const event = (init: KeyboardEventInit) => new KeyboardEvent("keydown", init);

describe("shortcuts", () => {
  it("formats key combinations for the platform", () => {
    expect(formatKeys(["Mod", "Shift", "Z"], false)).toBe("Ctrl+Shift+Z");
    expect(formatKeys(["Mod", "Shift", "Z"], true)).toBe("⌘⇧Z");
    expect(formatKeys(["Shift", "Drag"], true)).toBe("Shift+Drag");
    expect(formatKeys(["Esc"], true)).toBe("Esc");
    expect(isMac("MacIntel")).toBe(true);
    expect(isMac("Win32")).toBe(false);
  });

  it("lists every action once per group and every id once", () => {
    const ids: string[] = [];
    for (const group of SHORTCUTS) {
      const actions = group.shortcuts.map((s) => s.action);
      expect(new Set(actions).size).toBe(actions.length);
      ids.push(...group.shortcuts.flatMap((s) => (s.id ? [s.id] : [])));
    }
    expect(new Set(ids).size).toBe(ids.length);
    expect(shortcut("save").keys).toEqual([["Mod", "S"]]);
  });

  it("matches key events, with Ctrl or ⌘ for Mod and exact modifiers", () => {
    expect(matches(event({ key: "s", ctrlKey: true }), "save")).toBe(true);
    expect(matches(event({ key: "s", metaKey: true }), "save")).toBe(true);
    expect(matches(event({ key: "s" }), "save")).toBe(false);
    expect(
      matches(event({ key: "S", ctrlKey: true, shiftKey: true }), "save"),
    ).toBe(false);
    expect(
      matches(event({ key: "Z", ctrlKey: true, shiftKey: true }), "redo"),
    ).toBe(true);
    expect(matches(event({ key: "z", ctrlKey: true }), "redo")).toBe(false);
    expect(matches(event({ key: "y", ctrlKey: true }), "redo")).toBe(true);
    // a symbol is typed with Shift on most keyboards
    expect(matches(event({ key: "?", shiftKey: true }), "help")).toBe(true);
    expect(matches(event({ key: "f" }), "fit")).toBe(true);
    expect(matches(event({ key: "f", ctrlKey: true }), "fit")).toBe(false);
    expect(matches(event({ key: "f", altKey: true }), "fit")).toBe(false);
    expect(matches(event({ key: "Enter", metaKey: true }), "solve")).toBe(true);
    expect(matches(event({ key: "Backspace" }), "delete")).toBe(true);
    expect(matches(event({ key: "Escape" }), "escape")).toBe(true);
    expect(matches(event({ key: "ArrowRight" }), "substep-next")).toBe(true);
  });

  it("describes the shortcuts for menus, tooltips and assistive technology", () => {
    expect(ariaKeys("redo")).toBe(
      "Control+Shift+Z Meta+Shift+Z Control+Y Meta+Y",
    );
    expect(ariaKeys("help")).toBe("?");
    expect(ariaKeys("substep-next")).toBe("ArrowRight");
    expect(withHint("Fit", "fit")).toBe("Fit (F)");
  });

  it("knows where keys are typed or used by a widget", () => {
    const input = document.createElement("input");
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    const tree = document.createElement("ul");
    tree.setAttribute("role", "tree");
    const item = document.createElement("li");
    tree.append(item);
    expect(isTyping(input)).toBe(true);
    expect(isTyping(checkbox)).toBe(false);
    expect(isTyping(document.createElement("textarea"))).toBe(true);
    expect(isTyping(item)).toBe(false);
    expect(isNavigating(item)).toBe(true);
    expect(isNavigating(input)).toBe(false);
  });
});
