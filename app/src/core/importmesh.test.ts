import { describe, expect, it, vi } from "vitest";
import fixture from "../../../tests/data/two_sections.json";
import type { Command, CommandList, MeshImport } from "./commands";
import {
  defaultMode,
  describePlanned,
  meshSize,
  planImport,
  suggestMeshName,
  suggestScale,
  toName,
} from "./importmesh";
import { fileNotes, MeshFiles } from "./meshfiles";
import { fileTags, solidOf } from "./meshinfo";
import { validate } from "./validate";
import type { CellTag, MeshInfo } from "../worker/protocol";

const commands = (fixture as CommandList).commands;

/** A mesh file with solid cells of the given types. */
function solids(
  file: string,
  ...list: { cell_type: string; cells: number; tags?: CellTag[] }[]
): MeshInfo {
  return {
    file,
    solids: list.map((s) => ({
      tags: [],
      bounds: [
        [0, 0, 0],
        [1, 1, 1],
      ],
      ...s,
    })),
  };
}

const tagged: MeshInfo = {
  file: "Bar 01.vtu",
  points: 325,
  solids: [
    {
      cell_type: "hexahedron",
      cells: 192,
      bounds: [
        [0, 0, 0],
        [3, 1, 1],
      ],
      tags: [
        {
          name: "material",
          values: [
            { value: 1, cells: 96 },
            { value: 2, cells: 96 },
          ],
        },
        { name: "zone", values: [{ value: 7, cells: 192 }] },
      ],
    },
  ],
};

describe("names", () => {
  it("makes valid, unused names", () => {
    const none = new Set<string>();
    expect(toName("Bar 01", none, "mesh")).toBe("Bar_01");
    expect(toName("01-part", none, "mesh")).toBe("mesh_01_part");
    expect(toName("___", none, "mesh")).toBe("mesh");
    expect(toName("field", none, "mesh")).toBe("mesh"); // reserved
    expect(toName("a".repeat(30), none, "mesh")).toBe("a".repeat(24));
    expect(toName("bar", new Set(["bar", "bar_2"]), "mesh")).toBe("bar_3");
    expect(toName("b".repeat(24), new Set(["b".repeat(24)]), "mesh")).toBe(
      `${"b".repeat(22)}_2`,
    );
  });

  it("suggests the mesh name from the file", () => {
    expect(suggestMeshName("specimen.vtu", commands)).toBe("specimen_2");
    expect(suggestMeshName("part.v2.msh", [])).toBe("part_v2");
  });
});

describe("scale of a mesh (#135)", () => {
  it("is the size of the bounding box of all solid cells", () => {
    expect(meshSize(tagged)).toEqual([3, 1, 1]);
    expect(meshSize({ file: "x.vtu" })).toEqual([0, 0, 0]);
  });

  it("is suggested for a very small or large mesh", () => {
    const mm = { length: "mm", force: "N" } as const;
    const m = { length: "m", force: "N" } as const;
    // a block of 40 x 40 x 20 mm, made in m
    expect(suggestScale([0.04, 0.04, 0.02], mm)).toEqual({
      scale: 1000,
      reason: "The mesh is smaller than 1 mm: was it made in m?",
    });
    expect(suggestScale([40, 40, 20], mm)).toBeUndefined();
    expect(suggestScale([0.04, 0.04, 0.02], m)).toBeUndefined();
    // and made in mm for a model in m
    expect(suggestScale([40, 40, 20], m)).toEqual({
      scale: 0.001,
      reason: "The mesh is larger than 10 m: was it made in mm?",
    });
    // without units only very small or very large meshes
    expect(suggestScale([0.04, 0.04, 0.02], undefined)).toBeUndefined();
    expect(suggestScale([0.004, 0.004, 0.002], undefined)?.scale).toBe(1000);
    expect(suggestScale([400, 40, 20], undefined)).toBeUndefined();
    expect(suggestScale([4e4, 4e4, 2e4], undefined)?.scale).toBe(0.001);
    expect(suggestScale([0, 0, 0], mm)).toBeUndefined();
  });

  it("is written to the planned meshes if it is not 1", () => {
    const plan = planImport(tagged, "bar", { mode: "all" }, [], 1000);
    expect(plan[0]).toEqual({
      command: "mesh.import",
      name: "bar",
      file: "Bar 01.vtu",
      scale: 1000,
    });
    expect(
      planImport(tagged, "bar", { mode: "all" }, [], 1)[0],
    ).not.toHaveProperty("scale");
  });
});

describe("planImport", () => {
  it("creates one cell set per tag value", () => {
    expect(defaultMode(tagged)).toEqual({ mode: "tag", tag: "material" });
    const plan = planImport(
      tagged,
      "bar",
      { mode: "tag", tag: "material" },
      [],
    );
    expect(plan).toEqual([
      {
        command: "mesh.import",
        name: "bar",
        file: "Bar 01.vtu",
        tag: "material",
      },
      {
        command: "cellset.from_tag",
        name: "material_1",
        mesh: "bar",
        value: 1,
      },
      {
        command: "cellset.from_tag",
        name: "material_2",
        mesh: "bar",
        value: 2,
      },
    ]);
    expect(validate(plan)).toEqual([]);
  });

  it("uses the names of Gmsh physical groups and avoids taken names", () => {
    const gmsh = solids("part.msh", {
      cell_type: "hexahedron",
      cells: 12,
      tags: [
        {
          name: "gmsh:physical",
          values: [
            { value: 1, cells: 4, label: "rubber" },
            { value: 2, cells: 4 },
            { value: 3, cells: 4, label: "hard" },
          ],
        },
      ],
    });
    const plan = planImport(
      gmsh,
      "part",
      { mode: "tag", tag: "gmsh:physical" },
      commands,
    );
    expect(plan.map((c) => c.name)).toEqual([
      "part",
      "rubber",
      "physical_2",
      "hard_2",
    ]);
    expect(validate([...commands, ...plan])).toEqual([]);
  });

  it("creates one cell set with all cells, or none", () => {
    const plain = solids("bar.vtu", { cell_type: "hexahedron", cells: 8 });
    expect(defaultMode(plain)).toEqual({ mode: "all" });
    const zone = tagged.solids![0].tags[1];
    expect(
      defaultMode(
        solids("bar.vtu", { cell_type: "hexahedron", cells: 8, tags: [zone] }),
      ),
    ).toEqual({ mode: "all" });
    expect(planImport(plain, "bar", { mode: "all" }, [])).toEqual([
      { command: "mesh.import", name: "bar", file: "bar.vtu" },
      { command: "cellset.from_file", name: "bar_cells", mesh: "bar" },
    ]);
    expect(planImport(plain, "bar", { mode: "none" }, [])).toEqual([
      { command: "mesh.import", name: "bar", file: "bar.vtu" },
    ]);
    expect(() =>
      planImport(plain, "bar", { mode: "tag", tag: "x" }, []),
    ).toThrow("no cell tag");
  });

  it("creates one mesh per cell type", () => {
    const physical = (values: [number, number][]): CellTag => ({
      name: "gmsh:physical",
      values: values.map(([value, cells]) => ({ value, cells })),
    });
    const info: MeshInfo = {
      ...solids(
        "hybrid.msh",
        { cell_type: "hexahedron", cells: 4, tags: [physical([[1, 4]])] },
        {
          cell_type: "tetra",
          cells: 9,
          tags: [
            physical([
              [1, 6],
              [2, 3],
            ]),
          ],
        },
      ),
      unsupported: [{ type: "wedge", cells: 2 }],
    };
    expect(defaultMode(info)).toEqual({ mode: "tag", tag: "gmsh:physical" });
    expect(fileTags(info)).toEqual([
      physical([
        [1, 10],
        [2, 3],
      ]),
    ]);

    const all = planImport(info, "part", { mode: "all" }, commands);
    expect(all).toEqual([
      {
        command: "mesh.import",
        name: "part_hexahedron",
        file: "hybrid.msh",
        cell_type: "hexahedron",
      },
      {
        command: "cellset.from_file",
        name: "part_hexahedron_cells",
        mesh: "part_hexahedron",
      },
      {
        command: "mesh.import",
        name: "part_tetra",
        file: "hybrid.msh",
        cell_type: "tetra",
      },
      {
        command: "cellset.from_file",
        name: "part_tetra_cells",
        mesh: "part_tetra",
      },
    ]);
    expect(validate([...commands, ...all])).toEqual([]);
    expect(all.map((c) => describePlanned(c, all, info))).toEqual([
      "hexahedron, 4 cells",
      "4 cells",
      "tetra, 9 cells",
      "9 cells",
    ]);

    // a tag value of both cell types gets the cell type in its name
    const tag = { mode: "tag", tag: "gmsh:physical" } as const;
    const byTag = planImport(info, "part", tag, commands);
    expect(byTag.map((c) => c.name)).toEqual([
      "part_hexahedron",
      "physical_1_hexahedron",
      "part_tetra",
      "physical_1_tetra",
      "physical_2",
    ]);
    expect(validate([...commands, ...byTag])).toEqual([]);
    expect(describePlanned(byTag[4], byTag, info)).toBe(
      "gmsh:physical = 2, 3 cells",
    );
  });

  it("names the cell type also with one supported type of several", () => {
    const info: MeshInfo = {
      ...solids("hybrid.vtu", { cell_type: "hexahedron", cells: 4 }),
      unsupported: [{ type: "pyramid", cells: 2 }],
    };
    expect(planImport(info, "part", { mode: "none" }, [])).toEqual([
      {
        command: "mesh.import",
        name: "part",
        file: "hybrid.vtu",
        cell_type: "hexahedron",
      },
    ]);
  });
});

describe("solid cells of a mesh", () => {
  const info: MeshInfo = solids(
    "hybrid.vtu",
    { cell_type: "hexahedron", cells: 4 },
    { cell_type: "tetra", cells: 9 },
  );

  it("takes the cells of the given type, or the only type", () => {
    expect(solidOf(info, "tetra")).toMatchObject({ solid: { cells: 9 } });
    expect(solidOf(tagged)).toMatchObject({ solid: { cells: 192 } });
  });

  it("explains a missing or unknown cell type", () => {
    expect(solidOf(info)).toEqual({
      problem:
        "The file 'hybrid.vtu' has more than one type of solid cells " +
        "(hexahedron, tetra). Choose the cell type.",
    });
    expect(solidOf(info, "tetra10")).toEqual({
      problem: "The file 'hybrid.vtu' has no tetra10 cells.",
    });
  });
});

describe("MeshFiles", () => {
  it("inspects added files and notifies", async () => {
    const inspector = vi.fn(async (name: string) => ({
      info: { ...tagged, file: name },
    }));
    const files = new MeshFiles(inspector);
    const listener = vi.fn();
    files.subscribe(listener);
    const pending = files.add("dir/bar.vtu", new Uint8Array([1]));
    expect(files.get("bar.vtu")?.status).toEqual({ state: "reading" });
    const file = await pending;
    expect(file.status).toMatchObject({
      state: "ready",
      info: { file: "bar.vtu" },
    });
    expect(inspector).toHaveBeenCalledWith("bar.vtu", new Uint8Array([1]));
    expect(listener).toHaveBeenCalledTimes(2);
    expect(files.names).toEqual(["bar.vtu"]);
  });

  it("keeps errors of the inspection as state", async () => {
    const files = new MeshFiles(async (name) => ({
      info: { file: name, error: "no solid cells" },
    }));
    expect((await files.add("a.vtu", new Uint8Array())).status).toEqual({
      state: "error",
      message: "no solid cells",
    });
    const failing = new MeshFiles(async () => {
      throw new Error("Python could not be loaded");
    });
    expect((await failing.add("a.vtu", new Uint8Array())).status).toMatchObject(
      {
        message: "Python could not be loaded",
      },
    );
    expect(
      (await new MeshFiles().add("a.vtu", new Uint8Array())).status.state,
    ).toBe("error");
  });

  it("keeps the newest version of a file", async () => {
    let release!: () => void;
    const slow = new Promise<void>((resolve) => (release = resolve));
    const files = new MeshFiles(async (name, data) => {
      if (data[0] === 1) await slow;
      return { info: { file: name, points: data[0] } };
    });
    const first = files.add("a.vtu", new Uint8Array([1]));
    await files.add("a.vtu", new Uint8Array([2]));
    release();
    await first;
    expect(files.get("a.vtu")?.status).toMatchObject({ info: { points: 2 } });
  });

  it("reports meshes whose file is missing, unusable or lacks the tag", async () => {
    const files = new MeshFiles(async (name) => ({
      info:
        name === "broken.vtu"
          ? { file: name, error: "meshio could not read the file." }
          : { ...tagged, file: name },
    }));
    const mesh = (
      name: string,
      file: string,
      tag?: string,
      cell_type?: MeshImport["cell_type"],
    ): Command => ({
      command: "mesh.import",
      name,
      file,
      ...(tag ? { tag } : {}),
      ...(cell_type ? { cell_type } : {}),
    });
    await files.add("bar.vtu", new Uint8Array());
    await files.add("broken.vtu", new Uint8Array());
    const notes = fileNotes(
      [
        mesh("a", "bar.vtu", "material"),
        mesh("b", "missing.vtu"),
        mesh("c", "broken.vtu"),
        mesh("d", "bar.vtu", "color"),
        mesh("e", "bar.vtu", "material", "hexahedron"),
        mesh("f", "bar.vtu", undefined, "tetra"),
        mesh("g", "bar.vtu", "color", "hexahedron"),
      ],
      files,
    );
    expect(Object.fromEntries(notes)).toEqual({
      b: ["The file 'missing.vtu' is not loaded. Choose it in the properties."],
      c: ["broken.vtu: meshio could not read the file."],
      d: ["The file 'bar.vtu' has no cell tag 'color'."],
      f: ["The file 'bar.vtu' has no tetra cells."],
      g: [
        "The hexahedron cells of the file 'bar.vtu' have no cell tag 'color'.",
      ],
    });
  });
});
