// The scalar bar of a contour (#139), drawn by the app into the root of the viewer
// with the classes of the scalar bars of the viewer (so the picture export takes
// it): the map in its bands over the shown range, and the outside color below and
// above it if values are outside of the range.
import { colorMap, lookupTable } from "../core/colormaps";
import type { ContourLook } from "../core/contour";

export interface ScalarBar {
  label: string;
  look: ContourLook;
}

const CLASS = "app-scalar-bar";

/** A number of a tick, like the viewer formats it. */
export function formatTick(x: number): string {
  if (x === 0 || !Number.isFinite(x)) return String(x);
  const a = Math.abs(x);
  return a >= 1e4 || a < 1e-3
    ? x.toExponential(2)
    : Number(x.toPrecision(3)).toString();
}

/** The parameters of the ticks: at the limits of the bands (at most 6 ticks). */
export function tickParameters(bands: number): number[] {
  if (!bands) return [0, 0.25, 0.5, 0.75, 1];
  let step = 1;
  while (bands / step > 5 || bands % step) step++;
  const result: number[] = [];
  for (let k = 0; k <= bands; k += step) result.push(k / bands);
  return result;
}

/** A canvas of one row of colors (a gradient), or of a single color. */
function strip(colors: Uint8Array, className: string): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.className = className;
  canvas.width = colors.length / 3;
  canvas.height = 1;
  const context = canvas.getContext("2d");
  if (context) {
    const image = context.createImageData(canvas.width, 1);
    for (let i = 0; i < canvas.width; i++) {
      image.data.set([...colors.subarray(3 * i, 3 * i + 3), 255], 4 * i);
    }
    context.putImageData(image, 0, 0);
  }
  return canvas;
}

/** Draw the scalar bar of a contour into the root of the viewer, or remove it. */
export function renderScalarBar(root: HTMLElement, bar?: ScalarBar): void {
  root.querySelector(`.${CLASS}`)?.remove();
  if (!bar) return;
  const { label, look } = bar;
  const [low, high] = look.shown;
  const flat = !(high > low);

  const container = document.createElement("div");
  container.className = `fv-bars ${CLASS}`;
  const element = document.createElement("div");
  element.className = "fv-bar";
  const title = document.createElement("div");
  title.className = "fv-bar-title";
  title.textContent = label;

  const scale = document.createElement("div");
  scale.className = "scalar-scale";
  const outside = Uint8Array.from(colorMap(look.map).outside);
  const swatch = (side: "below" | "above", value: number) => {
    const canvas = strip(outside, `scalar-outside ${side}`);
    canvas.title = `${side === "below" ? "Below" : "Above"} ${formatTick(value)}`;
    return canvas;
  };
  // the map in its bands, or the color of a uniform value (like the viewer)
  const table = lookupTable(look.map);
  const colors = new Uint8Array(768);
  for (let i = 0; i < 256; i++) {
    let t = flat ? 0.5 : (i + 0.5) / 256;
    if (look.mapBands > 0)
      t =
        (Math.min(Math.floor(t * look.mapBands), look.mapBands - 1) + 0.5) /
        look.mapBands;
    const j = Math.min(Math.round(t * 255), 255);
    colors.set(table.subarray(3 * j, 3 * j + 3), 3 * i);
  }
  const ticks = document.createElement("div");
  ticks.className = "fv-ticks";
  for (const s of flat ? [0] : tickParameters(look.mapBands)) {
    const tick = document.createElement("span");
    tick.textContent = formatTick(low + s * (high - low));
    ticks.appendChild(tick);
  }
  scale.append(
    look.below ? swatch("below", low) : document.createElement("span"),
    strip(colors, "scalar-gradient"),
    look.above ? swatch("above", high) : document.createElement("span"),
    ticks,
  );
  element.append(title, scale);
  container.appendChild(element);
  root.appendChild(container);
}
