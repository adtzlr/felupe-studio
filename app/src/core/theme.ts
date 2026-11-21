// The theme of the app (#375): dark or light, and the choice of it in the header,
// Dark, Light or System (the color scheme of the system or the browser). The choice
// is a setting of the browser with the storage prefix of the brand (ADR 0020), not
// a part of the project. The page sets the theme before its first paint, from the
// stored choice (themeScript, in the head of index.html), and the app follows a
// changed choice and the system (useTheme).
import { storageKey } from "../brand";

export type Theme = "dark" | "light";
export type ThemeChoice = Theme | "system";

export const THEME_CHOICES: readonly {
  id: ThemeChoice;
  label: string;
  hint: string;
}[] = [
  { id: "dark", label: "Dark", hint: "Light text on dark surfaces" },
  {
    id: "light",
    label: "Light",
    hint: "Dark text on light surfaces, and light pictures of the view, e.g. for reports",
  },
  {
    id: "system",
    label: "System",
    hint: "The color scheme of the system or the browser",
  },
];

/** The theme without a stored choice: nothing changes for those who do not switch. */
export const DEFAULT_THEME: ThemeChoice = "dark";

/** The name of the stored choice, after the storage prefix of the brand. */
export const THEME_KEY = "theme";

/** The media query of a dark color scheme of the system. */
export const DARK_QUERY = "(prefers-color-scheme: dark)";

const isChoice = (value: unknown): value is ThemeChoice =>
  THEME_CHOICES.some((c) => c.id === value);

/** The stored choice, or the default. */
export function loadTheme(storage?: Storage): ThemeChoice {
  try {
    const value = (storage ?? localStorage).getItem(storageKey(THEME_KEY));
    return isChoice(value) ? value : DEFAULT_THEME;
  } catch {
    return DEFAULT_THEME;
  }
}

/** Keep the choice in the browser (where it can). */
export function saveTheme(choice: ThemeChoice, storage?: Storage) {
  try {
    (storage ?? localStorage).setItem(storageKey(THEME_KEY), choice);
  } catch {
    // e.g. storage disabled: the choice lasts for the session
  }
}

/** The theme of a choice; System follows the color scheme of the system. */
export const themeOf = (choice: ThemeChoice, systemDark: boolean): Theme =>
  choice === "system" ? (systemDark ? "dark" : "light") : choice;

/** The theme of the page: the attribute of its root, which the tokens follow. */
export function applyTheme(theme: Theme, root = document.documentElement) {
  if (root.dataset.theme !== theme) root.dataset.theme = theme;
}

/**
 * The script in the head of the page that sets the theme before the first paint, so
 * a light app does not start dark: the theme of the stored choice (`key`), else of
 * the default. A plain script with the same rules as `loadTheme` and `themeOf`.
 */
export function themeScript(key: string, fallback = DEFAULT_THEME): string {
  // a value in the script, safe in HTML
  const value = (v: unknown) => JSON.stringify(v).replace(/</g, "\\u003c");
  const choices = value(THEME_CHOICES.map((c) => c.id));
  return (
    `(function(){var c;try{c=localStorage.getItem(${value(key)})}` +
    `catch(e){}if(${choices}.indexOf(c)<0)c=${value(fallback)};` +
    `if(c==="system"){try{c=matchMedia(${value(DARK_QUERY)}).matches` +
    `?"dark":"light"}catch(e){c="light"}}` +
    `document.documentElement.setAttribute("data-theme",c)})();`
  );
}
