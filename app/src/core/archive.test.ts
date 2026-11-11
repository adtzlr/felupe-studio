import { zipSync } from "fflate";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ArchiveError, readArchive, writeArchive } from "./archive";
import { isZip } from "./files";

const text = (s: string) => new TextEncoder().encode(s);
const project = JSON.stringify({
  schema_version: 3,
  commands: [
    { command: "mesh.import", name: "bar", file: "bar.vtu" },
    { command: "mesh.import", name: "block", file: "block.msh" },
  ],
});
// a binary mesh file with all byte values
const binary = Uint8Array.from({ length: 512 }, (_, i) => (i * 7) % 256);
const files = [
  { name: "block.msh", data: binary },
  { name: "bar.vtu", data: text("<VTKFile/>") },
];
const bytesOf = async (file: File) => new Uint8Array(await file.arrayBuffer());

afterEach(() => {
  vi.useRealTimers();
});

describe("project archives (#148)", () => {
  it("keep the project, the script and the mesh files", async () => {
    const zip = writeArchive({ name: "bar", project, files, script: "# x\n" });
    expect(isZip(zip)).toBe(true);
    const archive = readArchive(zip);
    expect(archive.name).toBe("bar");
    expect(archive.project?.name).toBe("bar.felupe.json");
    expect(await archive.project?.text()).toBe(project);
    expect(await archive.script?.text()).toBe("# x\n");
    // sorted by name; binary files byte-identical
    expect(archive.files.map((f) => f.name)).toEqual(["bar.vtu", "block.msh"]);
    expect(await bytesOf(archive.files[1])).toEqual(binary);
    expect(archive.ignored).toEqual([]);
  });

  it("are the same bytes for the same project", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 10, 11, 12));
    const first = writeArchive({ name: "bar", project, files });
    vi.setSystemTime(new Date(2027, 0, 2, 3));
    const second = writeArchive({
      name: "bar",
      project,
      files: [...files].reverse(),
    });
    expect(second).toEqual(first);
  });

  it("open a folder zipped by a user, and report unused files", async () => {
    const zip = zipSync({
      "bar/": new Uint8Array(),
      "bar/bar.felupe.json": text(project),
      "bar/bar.vtu": text("<VTKFile/>"),
      "bar/block.msh": binary,
      "bar/notes.txt": text("old"),
      "bar/.DS_Store": text("x"),
      "__MACOSX/bar/._bar.vtu": text("x"),
    });
    const archive = readArchive(zip);
    expect(archive.project?.name).toBe("bar.felupe.json");
    expect(archive.files.map((f) => f.name)).toEqual(["bar.vtu", "block.msh"]);
    expect(archive.ignored).toEqual(["notes.txt"]);
    expect(archive.script).toBeUndefined();
  });

  it("give the mesh files of an archive without a project", () => {
    const zip = zipSync({ "./bar.vtu": text("<VTKFile/>"), "b.msh": binary });
    const archive = readArchive(zip);
    expect(archive.project).toBeUndefined();
    expect(archive.files.map((f) => f.name)).toEqual(["bar.vtu", "b.msh"]);
    expect(archive.ignored).toEqual([]);
  });

  it("reject unsafe paths, two projects and other files", () => {
    const fails = (entries: Record<string, Uint8Array>, message: RegExp) =>
      expect(() => readArchive(zipSync(entries))).toThrow(message);
    fails({ "/etc/bar.vtu": binary }, /absolute path: \/etc\/bar.vtu/);
    fails({ "C:\\bar.vtu": binary }, /absolute path/);
    fails({ "a/../../bar.vtu": binary }, /outside of it: a\/..\/..\/bar.vtu/);
    fails(
      { "a.felupe.json": text(project), "b.felupe.json": text(project) },
      /more than one project file: a.felupe.json, b.felupe.json/,
    );
    expect(() => readArchive(text('{"commands": []}'))).toThrow(ArchiveError);
    expect(() => readArchive(text("x"))).toThrow(/not a ZIP file/);
    expect(() =>
      writeArchive({ name: "bar", project, files: [files[0], files[0]] }),
    ).toThrow(/two files block.msh/);
    expect(() =>
      writeArchive({
        name: "bar",
        project,
        files: [{ name: "../x", data: binary }],
      }),
    ).toThrow(ArchiveError);
  });
});
