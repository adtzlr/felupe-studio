import { describe, expect, it } from "vitest";
import fixture from "../../../tests/data/two_sections.json";
import type {
  Command,
  CommandList,
  MeshGenerate,
  MeshScript,
} from "./commands";
import {
  faceSetNotes,
  fileNotes,
  generateChain,
  makeMeshes,
  MeshFiles,
  meshFileNames,
  meshSource,
  meshStatus,
  scriptParameters,
  sectionCellType,
} from "./meshfiles";

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
    // the edges of the 2D cells of 2D models (#175)
    expect(faceSetNotes(model, await files("quad8")).size).toBe(0);
    expect(faceSetNotes(model, await files("triangle")).get("end")).toEqual([
      "The edges of triangle cells of 'section_soft' have no boundary region in FElupe 12; a face set of a 2D model needs a section of quads.",
    ]);
  });
});

describe("the cells of the analysis (#175)", () => {
  // the mesh without its tag, which the files do not have
  const mesh = commands.map((c) =>
    c.command === "mesh.import" ? { ...c, tag: undefined } : c,
  );
  const settings = (analysis: string) =>
    [
      { command: "model.settings", name: "settings", analysis },
      ...mesh,
    ] as Command[];

  it("are 3D cells in a 3D model and 2D cells in a 2D model", async () => {
    const quads = await files("quad");
    expect(fileNotes(settings("plane-strain"), quads).size).toBe(0);
    expect(fileNotes(mesh, quads).get("specimen")).toEqual([
      "The file 'specimen.vtu' has quad cells, which are 2D cells: set the analysis of the settings to plane strain or axisymmetric.",
    ]);
    const hexahedrons = await files("hexahedron");
    expect(fileNotes(mesh, hexahedrons).size).toBe(0);
    expect(
      fileNotes(settings("axisymmetric"), hexahedrons).get("specimen"),
    ).toEqual([
      "The file 'specimen.vtu' has hexahedron cells, but a 2D model has 2D cells (triangles or quads).",
    ]);
  });
});

describe("meshes made by scripts (#182)", () => {
  const script: Command[] = [
    { command: "parameter.add", name: "radius", value: 50 },
    { command: "parameter.add", name: "layers", value: 3, integer: true },
    {
      command: "mesh.script",
      name: "rubber_mesh",
      file: "spring.py",
      item: "rubber",
    },
    {
      command: "mesh.script",
      name: "metal_mesh",
      file: "spring.py",
      item: "metal",
      parameters: ["layers"],
    },
  ];
  const info = (file: string, cells: number) => ({
    file,
    points: 8,
    solids: [
      {
        cell_type: "hexahedron",
        cells,
        bounds: [
          [0, 0, 0],
          [1, 1, 1],
        ] as [number[], number[]],
        tags: [],
      },
    ],
  });

  /** Mesh files with a script whose items make meshes, recording the calls. */
  function scripted(fail?: string) {
    const written: string[] = [];
    const made: unknown[][] = [];
    const files = new MeshFiles(undefined, {
      write: async (name) => {
        written.push(name);
      },
      make: async (file, parameters, item) => {
        made.push([file, parameters, item]);
        if (item === fail)
          return {
            info: {
              file,
              error: "NameError: name 'height' is not defined",
              traceback: 'File "spring.py", line 3\nNameError',
            },
          };
        return { info: info(file, item === "rubber" ? 6 : 2) };
      },
    });
    return { files, written, made };
  }

  it("keep the script and make each mesh once per parameter values", async () => {
    const { files, written, made } = scripted();
    await files.add("spring.py", new Uint8Array([1]));
    expect(written).toEqual(["spring.py"]);
    expect(files.get("spring.py")!.status).toEqual({ state: "script" });
    expect(meshFileNames(script)).toEqual(["spring.py"]);

    // all parameters, or the listed ones
    const [rubber, metal] = script.slice(2) as MeshScript[];
    expect(scriptParameters(rubber, script)).toEqual({ radius: 50, layers: 3 });
    expect(scriptParameters(metal, script)).toEqual({ layers: 3 });
    expect(meshStatus(rubber, script, files)).toBeUndefined();
    makeMeshes(script, files);
    makeMeshes(script, files);
    expect(meshStatus(rubber, script, files)).toEqual({ state: "reading" });
    await Promise.resolve();
    await Promise.resolve();
    expect(made).toEqual([
      ["spring.py", { radius: 50, layers: 3 }, "rubber"],
      ["spring.py", { layers: 3 }, "metal"],
    ]);
    const ready = meshStatus(rubber, script, files);
    expect(ready?.state === "ready" && ready.info.solids?.[0].cells).toBe(6);

    // a changed parameter makes the meshes that use it again, and forgets the old
    const changed = script.map((c) =>
      c.name === "radius" ? { ...c, value: 60 } : c,
    ) as Command[];
    makeMeshes(changed, files);
    await Promise.resolve();
    await Promise.resolve();
    expect(made).toHaveLength(3);
    expect(made[2]).toEqual(["spring.py", { radius: 60, layers: 3 }, "rubber"]);
    expect(meshStatus(rubber, script, files)).toBeUndefined();

    // a replaced script makes its meshes again
    await files.add("spring.py", new Uint8Array([2]));
    expect(meshStatus(metal, changed, files)).toBeUndefined();
    makeMeshes(changed, files);
    await Promise.resolve();
    await Promise.resolve();
    expect(made).toHaveLength(5);
  });

  it("report scripts that are missing or fail", async () => {
    const { files } = scripted("metal");
    expect(fileNotes(script, files).get("rubber_mesh")).toEqual([
      "The script 'spring.py' is not loaded. Choose it in the properties.",
    ]);
    await files.add("spring.py", new Uint8Array([1]));
    makeMeshes(script, files);
    await Promise.resolve();
    await Promise.resolve();
    const notes = fileNotes(script, files);
    expect(notes.get("rubber_mesh")).toBeUndefined();
    expect(notes.get("metal_mesh")).toEqual([
      "spring.py: NameError: name 'height' is not defined",
    ]);
    const [, metal] = script.slice(2) as MeshScript[];
    expect(meshStatus(metal, script, files)).toMatchObject({
      state: "error",
      traceback: 'File "spring.py", line 3\nNameError',
    });
    // a tag the mesh does not have
    const tagged = script.map((c) =>
      c.name === "rubber_mesh" ? { ...c, tag: "material" } : c,
    ) as Command[];
    makeMeshes(tagged, files);
    expect(fileNotes(tagged, files).get("rubber_mesh")).toEqual([
      "The mesh of 'spring.py' ['rubber'] has no cell tag 'material'.",
    ]);
  });

  it("are not made without Python", async () => {
    const files = new MeshFiles();
    expect((await files.add("spring.py", new Uint8Array([1]))).status).toEqual({
      state: "error",
      message: "Python is not available.",
    });
    expect(await files.make("key", "spring.py", {}, undefined)).toEqual({
      state: "error",
      message: "Python is not available.",
    });
  });
});

describe("cuts of the meshes (#395)", () => {
  const hexahedron = (positions: number[]) => ({
    hexahedron: {
      positions: Float32Array.from(positions),
      triangles: new Uint32Array(),
      edges: new Uint32Array(),
      owners: new Uint32Array(),
      cells: 1,
    },
  });

  /** Mesh files whose cuts arrive on `arrive()`, recording the asked cuts. */
  function cutting() {
    const asked: unknown[] = [];
    const waiting: (() => void)[] = [];
    const files = new MeshFiles(
      async (name) => ({ info: { file: name, solids: [] } }),
      {
        write: async () => {},
        cut: (source, cut) => {
          asked.push([source, cut]);
          return new Promise((resolve, reject) =>
            waiting.push(() =>
              cut.value < 0
                ? reject(new Error("no cut"))
                : resolve(hexahedron([cut.value])),
            ),
          );
        },
      },
    );
    const arrive = async () => {
      waiting.shift()!();
      await Promise.resolve();
      await Promise.resolve();
    };
    return { files, asked, arrive, waiting };
  }

  const cut = (value: number) => ({
    axis: "x" as const,
    value,
    half: "+" as const,
  });

  it("know the request that made a mesh", async () => {
    const { files } = cutting();
    const model: Command[] = [
      { command: "parameter.add", name: "n", value: 3 },
      { command: "mesh.import", name: "a", file: "a.vtu" },
      { command: "mesh.script", name: "b", file: "b.py", item: "left" },
      {
        command: "mesh.generate",
        name: "c",
        tool: "Cube",
        parameters: { a: [0, 0, 0], b: [1, 1, 1], n: ["n", 2, 2] },
      },
    ];
    const [, a, b, c] = model as [never, MeshScript, MeshScript, MeshGenerate];
    expect(meshSource(a, model, files)).toBeUndefined();
    await files.add("a.vtu", new Uint8Array([1]));
    await files.add("b.py", new Uint8Array([1]));
    expect(meshSource(a, model, files)).toEqual({
      type: "inspect-mesh",
      name: "a.vtu",
    });
    expect(meshSource(b, model, files)).toEqual({
      type: "make-mesh",
      file: "b.py",
      parameters: { n: 3 },
      item: "left",
    });
    // the chain of the tools, like the request that made it
    expect(meshSource(c, model, files)).toEqual({
      type: "generate-mesh",
      name: "c",
      commands: generateChain(c, model),
    });
    expect(generateChain(c, model)).toHaveLength(1);
  });

  it("ask for the latest cut once the one being made arrived", async () => {
    const { files, asked, arrive } = cutting();
    const source = { type: "inspect-mesh" as const, name: "a.vtu" };
    const revision = files.revision;
    files.cutMeshes([{ source, cut: cut(1) }]);
    files.cutMeshes([{ source, cut: cut(1) }]);
    files.cutMeshes([{ source, cut: cut(2) }]);
    files.cutMeshes([{ source, cut: cut(3) }]);
    expect(asked).toEqual([[source, cut(1)]]);
    expect(files.cutSurfaces(source)).toBeUndefined();
    await arrive();
    // the arrived cut is drawn until the latest one arrives, the one between is
    // never asked for
    expect(files.cutSurfaces(source)!.hexahedron.positions).toEqual(
      Float32Array.from([1]),
    );
    expect(asked).toEqual([
      [source, cut(1)],
      [source, cut(3)],
    ]);
    await arrive();
    expect(files.cutSurfaces(source)!.hexahedron.positions[0]).toBe(3);
    expect(files.cutRevision).toBe(2);
    // a cut is no change of the files
    expect(files.revision).toBe(revision);
    files.cutMeshes([{ source, cut: cut(3) }]);
    expect(asked).toHaveLength(2);

    // an error keeps the latest surfaces, and is not asked for again
    files.cutMeshes([{ source, cut: cut(-1) }]);
    await arrive();
    expect(files.cutSurfaces(source)!.hexahedron.positions[0]).toBe(3);
    files.cutMeshes([{ source, cut: cut(-1) }]);
    expect(asked).toHaveLength(3);
  });

  it("forget the cuts without a cut, of other meshes and of new files", async () => {
    const { files, asked, arrive, waiting } = cutting();
    const a = { type: "inspect-mesh" as const, name: "a.vtu" };
    const b = { type: "inspect-mesh" as const, name: "b.vtu" };
    files.cutMeshes([
      { source: a, cut: cut(1) },
      { source: b, cut: cut(1) },
    ]);
    await arrive();
    await arrive();
    files.cutMeshes([{ source: a, cut: cut(1) }]);
    expect(files.cutSurfaces(a)).toBeDefined();
    expect(files.cutSurfaces(b)).toBeUndefined();
    files.cutMeshes([]);
    expect(files.cutSurfaces(a)).toBeUndefined();

    // a cut of a forgotten mesh that arrives late is dropped
    files.cutMeshes([{ source: a, cut: cut(2) }]);
    files.cutMeshes([]);
    await arrive();
    expect(files.cutSurfaces(a)).toBeUndefined();

    // a new file of the project, and a new project
    files.cutMeshes([{ source: a, cut: cut(1) }]);
    await arrive();
    await files.add("c.vtu", new Uint8Array([1]));
    expect(files.cutSurfaces(a)).toBeUndefined();
    files.cutMeshes([{ source: a, cut: cut(1) }]);
    await arrive();
    files.clear();
    expect(files.cutSurfaces(a)).toBeUndefined();
    expect(asked).toHaveLength(5);
    expect(waiting).toHaveLength(0);
  });

  it("are not made without Python", () => {
    const files = new MeshFiles();
    const source = { type: "inspect-mesh" as const, name: "a.vtu" };
    files.cutMeshes([{ source, cut: cut(1) }]);
    expect(files.cutSurfaces(source)).toBeUndefined();
  });
});
