import { describe, expect, it } from "vitest";
import { formatKeys, isMac, SHORTCUTS } from "./shortcuts";

describe("shortcuts", () => {
  it("formats key combinations for the platform", () => {
    expect(formatKeys(["Mod", "Shift", "Z"], false)).toBe("Ctrl+Shift+Z");
    expect(formatKeys(["Mod", "Shift", "Z"], true)).toBe("⌘⇧Z");
    expect(formatKeys(["Shift", "Drag"], true)).toBe("Shift+Drag");
    expect(formatKeys(["Esc"], true)).toBe("Esc");
    expect(isMac("MacIntel")).toBe(true);
    expect(isMac("Win32")).toBe(false);
  });

  it("lists every action once per group", () => {
    for (const group of SHORTCUTS) {
      const actions = group.shortcuts.map((s) => s.action);
      expect(new Set(actions).size).toBe(actions.length);
    }
  });
});
