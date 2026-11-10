import { describe, expect, it, vi } from "vitest";
import fixture from "../../../tests/data/two_sections.json";
import type { Command, CommandList } from "./commands";
import { defaultMode, planImport, suggestMeshName, toName } from "./importmesh";
import { fileNotes, MeshFiles } from "./meshfiles";
import { validate } from "./validate";
import type { MeshInfo } from "../worker/protocol";

const commands = (fixture as CommandList).commands;

const tagged: MeshInfo = {
  file: "Bar 01.vtu",
  points: 325,
  cell_type: "hexahedron",
  cells: 192,
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
    const gmsh: MeshInfo = {
      file: "part.msh",
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
    };
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
    const plain: MeshInfo = { file: "bar.vtu", tags: [] };
    expect(defaultMode(plain)).toEqual({ mode: "all" });
    expect(defaultMode({ ...plain, tags: [tagged.tags![1]] })).toEqual({
      mode: "all",
    });
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
          : tagged,
    }));
    const mesh = (name: string, file: string, tag?: string): Command =>
      tag
        ? { command: "mesh.import", name, file, tag }
        : { command: "mesh.import", name, file };
    await files.add("bar.vtu", new Uint8Array());
    await files.add("broken.vtu", new Uint8Array());
    const notes = fileNotes(
      [
        mesh("a", "bar.vtu", "material"),
        mesh("b", "missing.vtu"),
        mesh("c", "broken.vtu"),
        mesh("d", "bar.vtu", "color"),
      ],
      files,
    );
    expect(Object.fromEntries(notes)).toEqual({
      b: ["The file 'missing.vtu' is not loaded. Choose it in the properties."],
      c: ["broken.vtu: meshio could not read the file."],
      d: ["The file 'bar.vtu' has no cell tag 'color'."],
    });
  });
});
