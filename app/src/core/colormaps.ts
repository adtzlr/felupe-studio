// The color maps of the contours of results (#139): lookup tables of 256 RGB colors,
// like the `lut` of a surface of the FElupe viewer, and an extra color for values
// outside of the range.

export type ColorMapId = "turbo" | "viridis" | "coolwarm" | "grayscale";

export interface ColorMap {
  id: ColorMapId;
  label: string;
  /** A diverging map: centered at zero for signed values. */
  diverging: boolean;
  /** The color of values below or above a range, distinct from the map. */
  outside: RGB;
}

export type RGB = [number, number, number];

export const COLOR_MAPS: readonly ColorMap[] = [
  { id: "turbo", label: "Turbo", diverging: false, outside: [128, 128, 128] },
  {
    id: "viridis",
    label: "Viridis",
    diverging: false,
    outside: [128, 128, 128],
  },
  {
    id: "coolwarm",
    label: "Cool–warm",
    diverging: true,
    outside: [96, 96, 96],
  },
  {
    id: "grayscale",
    label: "Grayscale",
    diverging: false,
    outside: [214, 39, 154],
  },
];

export const colorMap = (id: ColorMapId): ColorMap =>
  COLOR_MAPS.find((m) => m.id === id) ?? COLOR_MAPS[0];

const clamp = (x: number) => Math.min(Math.max(x, 0), 1);
const byte = (x: number) => Math.round(255 * clamp(x));

/** Turbo by the polynomial approximation of the viewer of FElupe. */
function turbo(t: number): RGB {
  const r =
    0.13572138 +
    t *
      (4.6153926 +
        t *
          (-42.66032258 +
            t * (132.13108234 + t * (-152.94239396 + t * 59.28637943))));
  const g =
    0.09140261 +
    t *
      (2.19418839 +
        t *
          (4.84296658 +
            t * (-14.18503333 + t * (4.27729857 + t * 2.82956604))));
  const b =
    0.1066733 +
    t *
      (12.64194608 +
        t *
          (-60.58204836 +
            t * (110.36276771 + t * (-89.90310912 + t * 27.34824973))));
  return [byte(r), byte(g), byte(b)];
}

/** Viridis by a polynomial fit of the map of matplotlib. */
function viridis(t: number): RGB {
  const c0 = [0.2777273272234177, 0.005407344544966578, 0.3340998053353061];
  const c1 = [0.1050930431085774, 1.404613529898575, 1.384590162594685];
  const c2 = [-0.3308618287255563, 0.214847559468213, 0.09509516302823659];
  const c3 = [-4.634230498983486, -5.799100973351585, -19.33244095627987];
  const c4 = [6.228269936347081, 14.17993336680509, 56.69055260068105];
  const c5 = [4.776384997670288, -13.74514537774601, -65.35303263337234];
  const c6 = [-5.435455855934631, 4.645852612178535, 26.3124352495832];
  return [0, 1, 2].map((k) =>
    byte(
      c0[k] +
        t *
          (c1[k] +
            t * (c2[k] + t * (c3[k] + t * (c4[k] + t * (c5[k] + t * c6[k]))))),
    ),
  ) as RGB;
}

/** The diverging map cool to warm of Moreland, by its colors at quarters. */
const COOLWARM: RGB[] = [
  [59, 76, 192],
  [141, 176, 254],
  [221, 221, 221],
  [244, 154, 123],
  [180, 4, 38],
];

function piecewise(colors: readonly RGB[], t: number): RGB {
  const x = clamp(t) * (colors.length - 1);
  const i = Math.min(Math.floor(x), colors.length - 2);
  const f = x - i;
  return [0, 1, 2].map((k) =>
    Math.round((1 - f) * colors[i][k] + f * colors[i + 1][k]),
  ) as RGB;
}

/** The color of a map at a parameter from 0 to 1. */
export function colorOf(id: ColorMapId, t: number): RGB {
  switch (id) {
    case "viridis":
      return viridis(clamp(t));
    case "coolwarm":
      return piecewise(COOLWARM, t);
    case "grayscale":
      // light to dark, for printing
      return piecewise(
        [
          [235, 235, 235],
          [25, 25, 25],
        ],
        t,
      );
    default:
      return turbo(clamp(t));
  }
}

/**
 * The lookup table of a map (256 RGB colors), optionally in bands and with the
 * outside color in an extra entry or band at both ends.
 *
 * Without bands, the entries 0 and 255 are the outside color and the map lies in
 * between; with bands, the first and the last of `bands + 2` bands are outside.
 */
export function lookupTable(
  id: ColorMapId,
  { bands = 0, outside = false }: { bands?: number; outside?: boolean } = {},
): Uint8Array {
  const table = new Uint8Array(768);
  const extra = colorMap(id).outside;
  for (let i = 0; i < 256; i++) {
    let color: RGB;
    if (bands > 0) {
      // the band of the center of the entry, like the viewer samples the table
      const count = outside ? bands + 2 : bands;
      const band = Math.min(Math.floor(((i + 0.5) / 256) * count), count - 1);
      const inner = outside ? band - 1 : band;
      color =
        inner < 0 || inner >= bands
          ? extra
          : colorOf(id, (inner + 0.5) / bands);
    } else if (outside) {
      color = i === 0 || i === 255 ? extra : colorOf(id, (i - 1) / 253);
    } else {
      color = colorOf(id, i / 255);
    }
    table.set(color, 3 * i);
  }
  return table;
}
