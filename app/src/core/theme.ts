// The theme of the app (#375): dark or light, and the choice of it in the header,
// Dark, Light or System (the color scheme of the system or the browser). The choice
// is a setting of the browser with the storage prefix of the brand (ADR 0020), not
// a part of the project. The page sets the theme before its first paint, from the
// stored choice (themeScript, in the head of index.html), and the app follows a
// changed choice and the system (useTheme). A brand may start in another theme
// (`defaults.theme`).
import { currentBrand, storageKey } from "../brand";

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

/**
 * The theme of FElupe Studio without a stored choice: nothing changes for those who
 * do not switch.
 */
export const DEFAULT_THEME: ThemeChoice = "dark";

/** The theme without a stored choice: of the brand (`defaults.theme`), else dark. */
export const defaultTheme = (): ThemeChoice =>
  currentBrand()?.defaults?.theme ?? DEFAULT_THEME;

/**
 * The colors around the content of the app per theme, the tokens `--color-bar` and
 * `--color-bg` of shell.css (`tokens.test.ts`): the theme color of the page, which
 * browsers and installed apps take for their bars, and the colors of the manifest.
 */
export const THEME_COLORS: Readonly<
  Record<Theme, { readonly bar: string; readonly background: string }>
> = {
  dark: { bar: "#171a21", background: "#1b1f27" },
  light: { bar: "#e9ecf1", background: "#eef0f4" },
};

/** The name of the stored choice, after the storage prefix of the brand. */
export const THEME_KEY = "theme";

/** The media query of a dark color scheme of the system. */
export const DARK_QUERY = "(prefers-color-scheme: dark)";

const isChoice = (value: unknown): value is ThemeChoice =>
  THEME_CHOICES.some((c) => c.id === value);

/** The stored choice, or the default of the brand. */
export function loadTheme(storage?: Storage): ThemeChoice {
  try {
    const value = (storage ?? localStorage).getItem(storageKey(THEME_KEY));
    return isChoice(value) ? value : defaultTheme();
  } catch {
    return defaultTheme();
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

/** The theme color of the page in a theme: the bar of the app, also in the browser. */
export function applyThemeColor(theme: Theme, page: ParentNode = document) {
  for (const meta of page.querySelectorAll('meta[name="theme-color"]'))
    meta.setAttribute("content", THEME_COLORS[theme].bar);
}

/**
 * The script in the head of the page that sets the theme before the first paint, so
 * a light app does not start dark: the theme of the stored choice (`key`), else of
 * the default of the brand, and the theme color of the page before it (in the head
 * after its `theme-color`). A plain script with the same rules as `loadTheme`,
 * `themeOf` and `applyThemeColor`.
 */
export function themeScript(key: string, fallback = DEFAULT_THEME): string {
  // a value in the script, safe in HTML
  const value = (v: unknown) => JSON.stringify(v).replace(/</g, "\\u003c");
  const choices = value(THEME_CHOICES.map((c) => c.id));
  const bars = value({
    dark: THEME_COLORS.dark.bar,
    light: THEME_COLORS.light.bar,
  });
  return (
    `(function(){var c;try{c=localStorage.getItem(${value(key)})}` +
    `catch(e){}if(${choices}.indexOf(c)<0)c=${value(fallback)};` +
    `if(c==="system"){try{c=matchMedia(${value(DARK_QUERY)}).matches` +
    `?"dark":"light"}catch(e){c="light"}}` +
    `document.documentElement.setAttribute("data-theme",c);` +
    `var m=document.querySelectorAll('meta[name="theme-color"]');` +
    `for(var i=0;i<m.length;i++)m[i].setAttribute("content",${bars}[c])})();`
  );
}
