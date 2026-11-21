// The theme of the app (#375): the stored choice, the theme of a choice and the
// script that sets it before the first paint, with the same rules.
import { describe, expect, it } from "vitest";
import {
  applyTheme,
  DEFAULT_THEME,
  loadTheme,
  saveTheme,
  THEME_CHOICES,
  themeOf,
  type ThemeChoice,
  themeScript,
} from "./theme";

function memory(): Storage {
  const items = new Map<string, string>();
  return {
    getItem: (k) => items.get(k) ?? null,
    setItem: (k, v) => void items.set(k, v),
    removeItem: (k) => void items.delete(k),
    clear: () => items.clear(),
    key: (i) => [...items.keys()][i] ?? null,
    get length() {
      return items.size;
    },
  };
}

/** The theme that the script of the page sets, with a stored value and a system. */
function scriptTheme(
  stored: string | null,
  systemDark: boolean | "none",
  fallback?: ThemeChoice,
) {
  const attributes: Record<string, string> = {};
  const storage = memory();
  if (stored !== null) storage.setItem("acme.theme", stored);
  const matchMedia = (query: string) => {
    if (systemDark === "none") throw new TypeError("no matchMedia");
    expect(query).toBe("(prefers-color-scheme: dark)");
    return { matches: systemDark };
  };
  const document = {
    documentElement: {
      setAttribute: (name: string, value: string) => (attributes[name] = value),
    },
  };
  new Function(
    "localStorage",
    "matchMedia",
    "document",
    themeScript("acme.theme", fallback),
  )(storage, matchMedia, document);
  return attributes["data-theme"];
}

describe("the theme", () => {
  it("is dark without a choice, so nothing changes for those who do not switch", () => {
    expect(DEFAULT_THEME).toBe("dark");
    expect(loadTheme(memory())).toBe("dark");
  });

  it("keeps the choice in the browser, with the storage prefix of the brand", () => {
    const storage = memory();
    for (const { id } of THEME_CHOICES) {
      saveTheme(id, storage);
      expect(storage.getItem("felupe-studio.theme")).toBe(id);
      expect(loadTheme(storage)).toBe(id);
    }
    // an unknown value falls back to the default
    storage.setItem("felupe-studio.theme", "sepia");
    expect(loadTheme(storage)).toBe("dark");
    // without storage, the choice lasts for the session
    const blocked = {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
    } as unknown as Storage;
    expect(loadTheme(blocked)).toBe("dark");
    expect(() => saveTheme("light", blocked)).not.toThrow();
  });

  it("follows the system with System", () => {
    expect(themeOf("dark", false)).toBe("dark");
    expect(themeOf("light", true)).toBe("light");
    expect(themeOf("system", true)).toBe("dark");
    expect(themeOf("system", false)).toBe("light");
  });

  it("is the attribute of the root of the page", () => {
    const root = { dataset: {} as DOMStringMap } as HTMLElement;
    applyTheme("light", root);
    expect(root.dataset.theme).toBe("light");
    applyTheme("dark", root);
    expect(root.dataset.theme).toBe("dark");
  });

  it("is set before the first paint with the same rules", () => {
    for (const stored of [null, "dark", "light", "system", "sepia"])
      for (const systemDark of [true, false]) {
        const storage = memory();
        if (stored !== null) storage.setItem("felupe-studio.theme", stored);
        expect(scriptTheme(stored, systemDark)).toBe(
          themeOf(loadTheme(storage), systemDark),
        );
      }
    // the default of a page may be another choice
    expect(scriptTheme(null, false, "system")).toBe("light");
    // a browser without the media query (as useMedia: not dark)
    expect(scriptTheme("system", "none")).toBe("light");
    // a page without storage
    const script = themeScript("acme.theme");
    const attributes: Record<string, string> = {};
    new Function("localStorage", "matchMedia", "document", script)(
      {
        getItem: () => {
          throw new Error("blocked");
        },
      },
      undefined,
      {
        documentElement: {
          setAttribute: (n: string, v: string) => (attributes[n] = v),
        },
      },
    );
    expect(attributes["data-theme"]).toBe("dark");
    // safe in HTML: no end of the script in it
    expect(themeScript("a</script>")).not.toMatch(/<\/script/i);
  });
});
