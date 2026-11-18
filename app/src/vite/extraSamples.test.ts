import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  extraSamples,
  PLACEHOLDER,
  readExtraSamples,
  titleOf,
} from "./extraSamples";

const samples = join(__dirname, "../../public/samples");

/** A folder of extra samples: copies of built-in ones under other names. */
function folder(entries: Record<string, string> = {}) {
  const root = mkdtempSync(join(tmpdir(), "extra-samples-"));
  const copy = (from: string, to: string, files: string[]) => {
    mkdirSync(join(root, to));
    for (const file of files)
      writeFileSync(
        join(root, to, file),
        readFileSync(join(samples, from, file)),
      );
  };
  copy("glued-plate", "my-plate", [
    "model.felupe.json",
    "block.vtu",
    "thumbnail.svg",
  ]);
  copy("plate-with-hole", "seal_ring", [
    "model.felupe.json",
    "plate_with_hole.py",
  ]);
  for (const [name, text] of Object.entries(entries))
    writeFileSync(join(root, name), text);
  return root;
}

describe("extra samples (#255)", () => {
  it("are the folders, with defaults", () => {
    const root = folder();
    mkdirSync(join(root, ".git")); // hidden folders are skipped
    const samples = readExtraSamples(root);
    expect(samples).toHaveLength(2);
    const [plate, ring] = samples;
    expect(plate).toMatchObject({
      id: "my-plate",
      title: "My plate",
      description: "",
      topics: [],
      files: ["block.vtu"],
      thumbnail: true,
    });
    expect(ring).toMatchObject({
      id: "seal_ring",
      title: "Seal ring",
      files: ["plate_with_hole.py"],
      thumbnail: false,
    });
    expect(titleOf("engine-mount")).toBe("Engine mount");
  });

  it("take titles, descriptions, topics and the order of samples.json", () => {
    const index = [
      {
        id: "seal_ring",
        title: "A seal ring",
        description: "Pressed into a groove.",
        topics: ["2D"],
      },
    ];
    const root = folder({ "samples.json": JSON.stringify(index) });
    const [ring, plate] = readExtraSamples(root);
    expect(ring).toMatchObject({ ...index[0], files: ["plate_with_hole.py"] });
    // a folder without an entry is still added, after the listed ones
    expect(plate).toMatchObject({ id: "my-plate", title: "My plate" });
  });

  it("fail with a clear message", () => {
    const missing = join(tmpdir(), "no-such-samples-folder");
    expect(() => readExtraSamples(missing)).toThrow(
      `EXTRA_SAMPLES_DIR: the folder ${missing} does not exist.`,
    );
    const root = folder();
    expect(() => readExtraSamples(root, ["my-plate"])).toThrow(
      "the id 'my-plate' is taken by a built-in sample.",
    );
    mkdirSync(join(root, "empty"));
    expect(() => readExtraSamples(root)).toThrow(
      "the sample 'empty' has no model.felupe.json.",
    );
    writeFileSync(join(root, "empty", "model.felupe.json"), "{]");
    expect(() => readExtraSamples(root)).toThrow(
      "the model.felupe.json of the sample 'empty' is invalid",
    );
    const project = readFileSync(
      join(root, "my-plate", "model.felupe.json"),
      "utf-8",
    );
    writeFileSync(
      join(root, "empty", "model.felupe.json"),
      project.replace("block.vtu", "other.vtu"),
    );
    expect(() => readExtraSamples(root)).toThrow(
      "the sample 'empty' has no file 'other.vtu'.",
    );
    const listed = folder({ "samples.json": '[{"id": "gone"}]' });
    expect(() => readExtraSamples(listed)).toThrow(
      "the entry 'gone' of samples.json has no folder.",
    );
  });

  it("are a virtual module and files of the build", () => {
    const plugin = extraSamples(folder());
    const emitted: { fileName: string; source: string | Buffer }[] = [];
    const context = {
      error: (message: string) => {
        throw new Error(message);
      },
      emitFile: (file: { fileName: string; source: string | Buffer }) => {
        emitted.push(file);
        return "";
      },
    };
    const call = (hook: unknown, ...args: unknown[]) =>
      (hook as (...a: unknown[]) => unknown).call(context, ...args);
    call(plugin.buildStart);
    const resolved = call(plugin.resolveId, "virtual:extra-samples") as string;
    const module = call(plugin.load, resolved) as string;
    const list = JSON.parse(module.replace("export default ", "").slice(0, -1));
    expect(list.map((s: { id: string }) => s.id)).toEqual([
      "my-plate",
      "seal_ring",
    ]);
    expect(list[0]).not.toHaveProperty("folder");
    call(plugin.generateBundle);
    expect(emitted.map((f) => f.fileName)).toEqual([
      "samples/my-plate/model.felupe.json",
      "samples/my-plate/thumbnail.svg",
      "samples/my-plate/block.vtu",
      "samples/seal_ring/model.felupe.json",
      "samples/seal_ring/thumbnail.svg",
      "samples/seal_ring/plate_with_hole.py",
    ]);
    // a sample without a picture gets the placeholder
    expect(emitted[4].source).toBe(PLACEHOLDER);
    // without a folder, no extra samples
    const none = extraSamples(undefined);
    call(none.buildStart);
    expect(call(none.load, resolved)).toBe("export default [];");
  });
});
