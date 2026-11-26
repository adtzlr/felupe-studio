import { describe, expect, it } from "vitest";
import type { Command } from "../core/resolved";
import { bodyContactFaces } from "./bodycontacts";
import type { SectionFaces } from "./facesets";

/** A section of faces with the given nodes (three coordinates each). */
const section = (name: string, faces: number[][]) =>
  ({
    section: name,
    faces: faces.map((nodes) => ({ nodes: Float64Array.from(nodes) })),
  }) as unknown as SectionFaces;

const sections = new Map([
  [
    "rubber",
    section("rubber", [
      [0, 0, 1, 1, 0, 1],
      [0, 0, 2, 1, 0, 2],
    ]),
  ],
  [
    "steel",
    section("steel", [
      [0, 0, 1, 1, 0, 1],
      [0, 0, 0, 1, 0, 0],
    ]),
  ],
]);

const contact = (fields: object) =>
  ({
    command: "bodycontact.add",
    name: "touch",
    section: "rubber",
    ...fields,
  }) as Extract<Command, { command: "bodycontact.add" }>;

describe("the surfaces of a contact between bodies (#462)", () => {
  it("are all faces of its sections", () => {
    expect(
      bodyContactFaces(
        contact({ primary: "steel" }),
        sections,
        () => undefined,
      ),
    ).toEqual([
      { section: "rubber", indices: [0, 1], primary: false },
      { section: "steel", indices: [0, 1], primary: true },
    ]);
    // a section with itself: one surface
    expect(bodyContactFaces(contact({}), sections, () => undefined)).toEqual([
      { section: "rubber", indices: [0, 1], primary: false },
    ]);
  });

  it("are the faces within its point sets", () => {
    const bottom = Float64Array.from([0, 0, 1, 1, 0, 1]);
    const faces = bodyContactFaces(
      contact({ primary: "steel", points: "bottom", points_primary: "bottom" }),
      sections,
      (name) => (name === "bottom" ? bottom : undefined),
    );
    expect(faces).toEqual([
      { section: "rubber", indices: [0], primary: false },
      { section: "steel", indices: [0], primary: true },
    ]);
  });
});
