// A PNG of the viewer (#30): the WebGL canvas with the overlays of the viewer (scalar
// bars, legend, axis triad) on the background of the viewport, at the resolution of
// the canvas. The vendored viewer stays unmodified: its drawing buffer is not
// preserved, so the canvas is read in the animation frame after its next draw.

const transparent = (color: string) =>
  !color || color === "transparent" || /^rgba\(.*,\s*0\)$/.test(color);

/** The first opaque background color of an element or of its ancestors. */
export function backgroundOf(element: Element | null): string {
  for (let e = element; e; e = e.parentElement) {
    const color = getComputedStyle(e).backgroundColor;
    if (!transparent(color)) return color;
  }
  return "#ffffff";
}

/** The opacity of an element, e.g. of a label behind faces (#140). */
const opacityOf = (element: HTMLElement) =>
  Number(getComputedStyle(element).opacity) || 1;

/** Elements with text only (of the scalar bars, the legend and the labels). */
function textElements(root: Element): HTMLElement[] {
  return [
    ...root.querySelectorAll<HTMLElement>(
      ".fv-bars *, .fv-legend *, .fv-labels *",
    ),
  ].filter(
    (e) =>
      // not hidden, e.g. a label behind the camera
      !e.closest("[hidden]") &&
      e.childNodes.length > 0 &&
      [...e.childNodes].every((n) => n.nodeType === Node.TEXT_NODE) &&
      (e.textContent ?? "").trim() !== "",
  );
}

const nextFrame = () =>
  new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

/**
 * A PNG of the canvas of the viewer and its overlays.
 *
 * @param root The root element of the viewer (`.fv`).
 * @param redraw Draws the scene in the next animation frame.
 */
export async function snapshot(
  root: HTMLElement,
  redraw: () => void,
): Promise<Blob> {
  const gl = root.querySelector<HTMLCanvasElement>("canvas.fv-gl");
  if (!gl) throw new Error("The viewer has no canvas.");
  redraw();
  // this frame callback runs after the one of the viewer that draws the scene
  await nextFrame();

  const out = document.createElement("canvas");
  out.width = gl.width;
  out.height = gl.height;
  const context = out.getContext("2d");
  if (!context) throw new Error("A 2D canvas is not available.");
  const ratio = gl.width / Math.max(gl.clientWidth, 1);
  context.fillStyle = backgroundOf(root);
  context.fillRect(0, 0, out.width, out.height);
  context.drawImage(gl, 0, 0);

  const origin = gl.getBoundingClientRect();
  const box = (e: Element) => {
    const r = e.getBoundingClientRect();
    return [
      (r.left - origin.left) * ratio,
      (r.top - origin.top) * ratio,
      r.width * ratio,
      r.height * ratio,
    ] as const;
  };

  // the axis triad and the gradients of the scalar bars
  for (const canvas of root.querySelectorAll<HTMLCanvasElement>(
    "canvas:not(.fv-gl)",
  )) {
    const [x, y, w, h] = box(canvas);
    if (w > 0 && h > 0) context.drawImage(canvas, x, y, w, h);
  }
  // the color swatches of the legend
  for (const swatch of root.querySelectorAll<HTMLElement>(".fv-legend span")) {
    context.fillStyle = getComputedStyle(swatch).backgroundColor;
    context.fillRect(...box(swatch));
  }
  // the boxes of the labels at points of the view (#140)
  for (const label of root.querySelectorAll<HTMLElement>(
    ".fv-labels .fv-label:not([hidden])",
  )) {
    const style = getComputedStyle(label);
    context.globalAlpha = opacityOf(label);
    context.fillStyle = style.backgroundColor;
    context.fillRect(...box(label));
    context.strokeStyle = style.borderLeftColor;
    context.lineWidth = ratio;
    context.strokeRect(...box(label));
  }
  context.globalAlpha = 1;
  // the labels, at the positions of their elements
  context.textBaseline = "middle";
  for (const element of textElements(root)) {
    const style = getComputedStyle(element);
    const label = element.closest<HTMLElement>(".fv-label");
    context.globalAlpha = label ? opacityOf(label) : 1;
    const size = parseFloat(style.fontSize) * ratio;
    context.font = `${style.fontStyle} ${style.fontWeight} ${size}px ${style.fontFamily}`;
    context.fillStyle = style.color;
    const [x, y, w, h] = box(element);
    const text = (element.textContent ?? "").trim();
    const width = context.measureText(text).width;
    // centered or right-aligned texts keep their alignment
    const align = style.textAlign;
    const left =
      align === "center"
        ? x + (w - width) / 2
        : align === "right" || align === "end"
          ? x + w - width
          : x;
    context.fillText(text, left, y + h / 2);
  }
  context.globalAlpha = 1;

  return new Promise<Blob>((resolve, reject) =>
    out.toBlob(
      (blob) =>
        blob ? resolve(blob) : reject(new Error("The PNG was not created.")),
      "image/png",
    ),
  );
}
