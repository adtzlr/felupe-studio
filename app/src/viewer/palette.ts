// Colors of the viewer. The categorical colors give meshes (and later sections) their
// identity, in a fixed order by their position in the model, so hiding one does not
// repaint the others. The eight steps pass the categorical checks against the
// background of the viewport (#262b36): lightness band, chroma, CVD and normal-vision
// separation of neighbors; green is below 3:1, so the legend names every color.
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

/** Color of the arrows of point loads (#100). */
export const FORCE_COLOR = "#ff6fb5";

/** Color of the markers of control points (#95). */
export const CONTROL_COLOR = "#5ce1e6";

/** Color of point markers and arrows (boundaries and loads). */
export const MARKER_COLOR = "#f5a524";

/** The categorical color of the object at a position of the model. */
export function categorical(index: number): string {
  return CATEGORICAL[index] ?? OTHER;
}
