import { describe, expect, it } from "vitest";
import fixture from "../../../tests/data/two_sections.json";
import type { Command, CommandList } from "./commands";
import { faceSetNotes, MeshFiles, sectionCellType } from "./meshfiles";

const commands = (fixture as CommandList).commands;

/** Mesh files whose solid cells are of the given type. */
async function files(cellType: string) {
  const files = new MeshFiles(async (name) => ({
    info: {
      file: name,
      points: 8,
      solids: [
        {
          cell_type: cellType,
          cells: 1,
          bounds: [
            [0, 0, 0],
            [1, 1, 1],
          ],
          tags: [],
        },
      ],
    },
  }));
  await files.add("specimen.vtu", new Uint8Array([1]));
  return files;
}

const faces: Command = {
  command: "faceset.add",
  name: "end",
  section: "section_soft",
  select: { axis: "x", value: 3 },
};

describe("face sets and the mesh files (#142)", () => {
  it("know the cell type of a section", async () => {
    const hexahedrons = await files("hexahedron");
    expect(sectionCellType(commands, "section_soft", hexahedrons)).toBe(
      "hexahedron",
    );
    expect(sectionCellType(commands, "hard", hexahedrons)).toBeUndefined();
    expect(
      sectionCellType(commands, "section_soft", new MeshFiles()),
    ).toBeUndefined();
  });

  it("are a problem on tetrahedrons", async () => {
    const model = [...commands, faces];
    expect(faceSetNotes(model, await files("hexahedron20")).size).toBe(0);
    expect(
      Object.fromEntries(faceSetNotes(model, await files("tetra"))),
    ).toEqual({
      end: [
        "The faces of tetra cells of 'section_soft' have no boundary region in FElupe 12; a face set needs a section of hexahedrons.",
      ],
    });
    // without the mesh file, nothing is known
    expect(faceSetNotes(model, new MeshFiles()).size).toBe(0);
  });
});
