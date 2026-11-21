// The theme of the app (#375): the stored choice, the theme of the page from it and
// from the system, and a new choice, which other tabs of the app follow.
import { useEffect, useLayoutEffect, useState } from "preact/hooks";
import { storageKey } from "../brand";
import {
  applyTheme,
  DARK_QUERY,
  loadTheme,
  saveTheme,
  type Theme,
  type ThemeChoice,
  THEME_KEY,
  themeOf,
} from "../core/theme";
import { useMedia } from "./hooks";

export interface ThemeState {
  choice: ThemeChoice;
  /** The theme of the page: of the choice, and of the system for System. */
  theme: Theme;
  choose: (choice: ThemeChoice) => void;
}

export function useTheme(): ThemeState {
  const [choice, setChoice] = useState(() => loadTheme());
  const systemDark = useMedia(DARK_QUERY);
  const theme = themeOf(choice, systemDark);
  useLayoutEffect(() => applyTheme(theme), [theme]);
  // a choice in another tab of the app
  useEffect(() => {
    const key = storageKey(THEME_KEY);
    const onStorage = (event: StorageEvent) => {
      if (event.key === key) setChoice(loadTheme());
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);
  const choose = (next: ThemeChoice) => {
    saveTheme(next);
    setChoice(next);
  };
  return { choice, theme, choose };
}
