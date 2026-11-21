// Colors of the viewer, all in this module. The categorical colors give meshes, cell
// sets and sections their identity, in a fixed order by their position in the model,
// so hiding one does not repaint the others; an own color of an object replaces it
// (#336, #376). They are colors of the model, the same in both themes (#375). The
// eight steps pass the categorical checks against the dark background of the
// viewport (#262b36): lightness band, chroma, CVD and normal-vision separation of
// neighbors; on it, green is below 3:1, and on the light one (#ffffff) all of them
// pass 3:1. The legend names every color.
import type { Theme } from "../core/theme";

export const CATEGORICAL = [
  "#3987e5", // blue
  "#d95926", // orange
  "#199e70", // aqua
  "#c98500", // yellow
  "#d55181", // magenta
  "#008300", // green
  "#9085e9", // violet
  "#e66767", // red
] as const;

/** Color of the objects beyond the categorical colors (never a generated hue). */
export const OTHER = "#8b93a1";

/** Color of cells without a cell set or section (shown as such in the legend). */
export const UNASSIGNED = "#c4c8cf";

/** Color of the edges of the faces, like `mesh.plot()` of FElupe. */
export const EDGE_COLOR = "#000000";

/** Color of the nodes of the meshes (toggle **Nodes**), like the edges. */
export const NODE_COLOR = "#000000";

/** Color of the faces of face sets (#142), over the model; the selected one is highlighted. */
export const FACE_COLOR = "#f2f4f8";

/** Color of excluded faces of picked surfaces (#195), like FElupe (`darkred`). */
export const EXCLUDED_COLOR = "#8b0000";

/** Color of the markers of point sets; the selected one is highlighted. */
export const POINT_COLOR = "#f2f4f8";

/**
 * The outline of markers of points (`outlined()`): dark, so a marker stands out on
 * the model and on the background of both themes.
 */
export const OUTLINE_COLOR = "#11151c";

/** The colors of the axes, like the axis triad of the viewer, in both themes. */
export const AXIS_COLORS = ["#d62728", "#2ca02c", "#1f77b4"] as const;

/**
 * The colors of the view that are drawn on its background, per theme (#375): of the
 * same hue in both, with a contrast of at least 3:1 to the background of the view
 * (WCAG 1.4.11; `tokens.test.ts`). Lighter than the colors of the model in the dark
 * theme, darker in the light one, or of another hue, so they stand out on the
 * model as well: the lines of the constraints on a blue mesh are light cyan in the
 * dark theme and dark cyan in the light one.
 */
export interface ViewColors {
  /** The selected object, and picked faces, points and planes. */
  highlight: string;
  /** Point markers and the arrows of moved boundaries. */
  marker: string;
  /** The arrows of point loads (#100) and of pressures (#105). */
  force: string;
  /** The control points (#95) and the lines of constraints (#99). */
  control: string;
  /** The markers of the minimum and the maximum of a contour (#140): `--color-min/max`. */
  extremes: { readonly min: string; readonly max: string };
  /** The rigid surfaces (#219): translucent faces and their outlines. */
  rigid: string;
  /** The undeformed ghost of results, translucent (faint by design, not 3:1). */
  ghost: string;
  /** The construction meshes of the mesh tools (ADR 0019): inputs, not the model. */
  construction: string;
}

export const VIEW_COLORS: Readonly<Record<Theme, Readonly<ViewColors>>> = {
  dark: {
    highlight: "#ffd23f",
    marker: "#f5a524",
    force: "#ff6fb5",
    control: "#5ce1e6",
    extremes: { min: "#8ab4ff", max: "#ff8a80" },
    rigid: "#aab4c3",
    ghost: "#c4c8cf",
    construction: "#9aa4b2",
  },
  light: {
    highlight: "#b58900",
    marker: "#c45a00",
    force: "#be185d",
    control: "#155e75",
    extremes: { min: "#1d55c4", max: "#b8322a" },
    rigid: "#6b7686",
    ghost: "#3b414b",
    construction: "#7d8796",
  },
};

/** The colors of the view in a theme, by default the dark one. */
export function viewColors(theme: Theme = "dark"): ViewColors {
  return VIEW_COLORS[theme];
}

/** The categorical color of the object at a position of the model. */
export function categorical(index: number): string {
  return CATEGORICAL[index] ?? OTHER;
}
