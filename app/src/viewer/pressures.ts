// Pressures in the viewport (#105): an arrow at the center of every face of the face
// set, normal to the face: onto the face for a positive pressure, away from it for a
// negative one (a pull).
import type { Command, PressureAdd } from "../core/commands";
import { type SectionFaces, selectedFaces } from "./facesets";
import { FORCE_COLOR } from "./palette";
import { arrowSegments, type Lines } from "./scene";

/** The most arrows of a pressure; more faces are thinned out. */
const LIMIT = 300;

/**
 * The arrows of the pressures, with a length relative to the size of the model;
 * the selected pressure is highlighted.
 */
export function pressureLines(
  commands: readonly Command[],
  sections: ReadonlyMap<string, SectionFaces>,
  {
    size,
    hidden = new Set<string>(),
    selected,
    highlight,
  }: {
    size: number;
    hidden?: ReadonlySet<string>;
    selected?: string;
    highlight: string;
  },
): Lines[] {
  const lines: Lines[] = [];
  for (const pressure of commands.filter(
    (c): c is PressureAdd => c.command === "pressure.add",
  )) {
    if (hidden.has(pressure.name) || pressure.pressure === 0) continue;
    const set = commands.find((c) => c.name === pressure.faces);
    if (set?.command !== "faceset.add") continue;
    const of = sections.get(set.section);
    if (!of) continue;
    const faces = selectedFaces(set.select, of);
    const step = Math.max(1, faces.length / LIMIT);
    const chosen = Array.from(
      { length: Math.min(faces.length, LIMIT) },
      (_, i) => faces[Math.floor(i * step)],
    );
    const length = 0.08 * size;
    const push = pressure.pressure > 0;
    const origins = new Float32Array(3 * chosen.length);
    const directions = new Float32Array(3 * chosen.length);
    chosen.forEach((f, i) => {
      const { center, normal } = of.faces[f];
      for (let k = 0; k < 3; k++) {
        // onto the face: from outside to the center; a pull: from the center out
        origins[3 * i + k] = center[k] + (push ? normal[k] * length : 0);
        directions[3 * i + k] = (push ? -1 : 1) * normal[k] * length;
      }
    });
    const isSelected = pressure.name === selected;
    lines.push({
      positions: arrowSegments({ origins, directions }),
      color: isSelected ? highlight : FORCE_COLOR,
      width: isSelected ? 3 : 2,
    });
  }
  return lines;
}
