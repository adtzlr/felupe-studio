// The theme of the app (#375): the stored choice, the theme of a choice and the
// script that sets it before the first paint, with the same rules.
import { describe, expect, it } from "vitest";
import {
  applyTheme,
  applyThemeColor,
  DEFAULT_THEME,
  loadTheme,
  saveTheme,
  THEME_CHOICES,
  THEME_COLORS,
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

/** A page with a theme color, for the script and `applyThemeColor`. */
function fakePage() {
  const attributes: Record<string, string> = {};
  const meta = { content: "#000000" };
  return {
    attributes,
    meta,
    documentElement: {
      setAttribute: (name: string, value: string) => (attributes[name] = value),
    },
    querySelectorAll: (selector: string) => {
      expect(selector).toBe('meta[name="theme-color"]');
      return [
        {
          setAttribute: (_: "content", value: string) => (meta.content = value),
        },
      ];
    },
  };
}

/** The theme that the script of the page sets, with a stored value and a system. */
function scriptTheme(
  stored: string | null,
  systemDark: boolean | "none",
  fallback?: ThemeChoice,
) {
  const page = fakePage();
  const storage = memory();
  if (stored !== null) storage.setItem("acme.theme", stored);
  const matchMedia = (query: string) => {
    if (systemDark === "none") throw new TypeError("no matchMedia");
    expect(query).toBe("(prefers-color-scheme: dark)");
    return { matches: systemDark };
  };
  new Function(
    "localStorage",
    "matchMedia",
    "document",
    themeScript("acme.theme", fallback),
  )(storage, matchMedia, page);
  const theme = page.attributes["data-theme"] as "dark" | "light";
  // and the theme color of the page
  expect(page.meta.content).toBe(THEME_COLORS[theme].bar);
  return theme;
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

  it("is the theme color of the page, for the bars of a browser", () => {
    const page = fakePage();
    applyThemeColor("light", page as unknown as ParentNode);
    expect(page.meta.content).toBe(THEME_COLORS.light.bar);
    applyThemeColor("dark", page as unknown as ParentNode);
    expect(page.meta.content).toBe(THEME_COLORS.dark.bar);
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
    const page = fakePage();
    new Function("localStorage", "matchMedia", "document", script)(
      {
        getItem: () => {
          throw new Error("blocked");
        },
      },
      undefined,
      page,
    );
    expect(page.attributes["data-theme"]).toBe("dark");
    expect(page.meta.content).toBe("#171a21");
    // safe in HTML: no end of the script in it
    expect(themeScript("a</script>")).not.toMatch(/<\/script/i);
  });
});
