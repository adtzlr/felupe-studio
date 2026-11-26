// The surfaces of a contact between bodies in the viewport (#462): the faces of the
// boundary of its section (the secondary surface) and of its primary section, within
// the point sets that limit them, like the masks of felupe_contact.SolidBodyContact.
import type { Command } from "../core/resolved";
import type { SectionFaces } from "./facesets";

type BodyContact = Extract<Command, { command: "bodycontact.add" }>;

/** The faces of a surface of a contact between bodies, of one section. */
export interface ContactFaces {
  section: string;
  /** The indices of the faces of the section. */
  indices: number[];
  /** The primary surface, else the secondary one. */
  primary: boolean;
}

/** The key of a point, equal for the same coordinates up to round-off. */
const key = (x: number, y: number, z: number) =>
  [x, y, z].map((v) => Math.round(v * 1e9)).join(",");

/** The faces of a section with all their nodes among the points, or all faces. */
function facesWithin(of: SectionFaces, points?: Float64Array): number[] {
  const all = of.faces.map((_, i) => i);
  if (points === undefined) return all;
  const keys = new Set<string>();
  for (let p = 0; p < points.length; p += 3)
    keys.add(key(points[p], points[p + 1], points[p + 2]));
  return all.filter((i) => {
    const nodes = of.faces[i].nodes;
    for (let p = 0; p < nodes.length; p += 3)
      if (!keys.has(key(nodes[p], nodes[p + 1], nodes[p + 2]))) return false;
    return true;
  });
}

/**
 * The faces of the surfaces of a contact between bodies: of its section, and of its
 * primary section if it is another section or other points. `pointsOf` gives the
 * coordinates of the points of a point set.
 */
export function bodyContactFaces(
  contact: BodyContact,
  sections: ReadonlyMap<string, SectionFaces>,
  pointsOf: (name: string) => Float64Array | undefined,
): ContactFaces[] {
  const primary = contact.primary ?? contact.section;
  const sides: [string, string | undefined, boolean][] = [
    [contact.section, contact.points, false],
  ];
  if (primary !== contact.section || contact.points_primary !== contact.points)
    sides.push([primary, contact.points_primary, true]);
  return sides.flatMap(([section, points, isPrimary]) => {
    const of = sections.get(section);
    if (!of) return [];
    const within = points === undefined ? undefined : pointsOf(points);
    return [{ section, indices: facesWithin(of, within), primary: isPrimary }];
  });
}
