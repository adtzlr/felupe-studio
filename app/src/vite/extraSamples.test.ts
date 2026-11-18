import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  builtInSamples,
  ExtraSamplesError,
  extraSamples,
  PLACEHOLDER,
  readExtraSamples,
  titleOf,
} from "./extraSamples";

/** The list and the flag of the built-in samples of the virtual module. */
function virtual(module: string) {
  const [list, flag] = module.split("\n");
  return {
    list: JSON.parse(list.replace("export default ", "").slice(0, -1)),
    builtIn: flag === "export const builtIn = true;",
  };
}

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
    const { list, builtIn } = virtual(call(plugin.load, resolved) as string);
    expect(builtIn).toBe(true);
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
    expect(virtual(call(none.load, resolved) as string).list).toEqual([]);
  });
});

describe("a build without the built-in samples (#279)", () => {
  it("reads BUILT_IN_SAMPLES", () => {
    for (const value of [undefined, "", "true", "1", "YES"])
      expect(builtInSamples(value)).toBe(true);
    for (const value of ["false", "0", "no", " False "])
      expect(builtInSamples(value)).toBe(false);
    expect(() => builtInSamples("off")).toThrow(ExtraSamplesError);
    expect(() => builtInSamples("off")).toThrow(
      "BUILT_IN_SAMPLES: 'off' is not one of true, false, 1, 0, yes or no.",
    );
  });

  it("has only the extra samples, in the module, the build and in dev", () => {
    // an extra sample may take the id of a built-in one without them
    const extra = folder();
    mkdirSync(join(extra, "bushing"));
    for (const file of ["model.felupe.json", "block.vtu"])
      writeFileSync(
        join(extra, "bushing", file),
        readFileSync(join(extra, "my-plate", file)),
      );
    expect(() => readExtraSamples(extra)).toThrow("taken by a built-in");
    const plugin = extraSamples(extra, "false");
    const context = {
      error: (message: string) => {
        throw new Error(message);
      },
      emitFile: () => "",
    };
    const call = (hook: unknown, ...args: unknown[]) =>
      (hook as (...a: unknown[]) => unknown).call(context, ...args);
    // public/ with a built-in sample, another folder and a file of the app
    const root = mkdtempSync(join(tmpdir(), "app-"));
    const publicDir = join(root, "public");
    mkdirSync(join(publicDir, "samples", "glued-plate"), { recursive: true });
    mkdirSync(join(publicDir, "samples", "notes"), { recursive: true });
    writeFileSync(join(publicDir, "samples", "glued-plate", "block.vtu"), "");
    writeFileSync(join(publicDir, "samples", "notes", "a.txt"), "");
    writeFileSync(join(publicDir, "sw.js"), "public");
    // a file of the bundle, which public/ does not overwrite
    mkdirSync(join(root, "dist"));
    writeFileSync(join(root, "dist", "sw.js"), "bundle");
    expect(call(plugin.config)).toEqual({ build: { copyPublicDir: false } });
    call(plugin.configResolved, { publicDir, root, build: { outDir: "dist" } });
    call(plugin.buildStart);
    const resolved = call(plugin.resolveId, "virtual:extra-samples") as string;
    const { list, builtIn } = virtual(call(plugin.load, resolved) as string);
    expect(builtIn).toBe(false);
    expect(list.map((s: { id: string }) => s.id)).toEqual([
      "bushing",
      "my-plate",
      "seal_ring",
    ]);
    call(plugin.writeBundle);
    const dist = join(root, "dist");
    expect(existsSync(join(dist, "samples", "glued-plate"))).toBe(false);
    expect(existsSync(join(dist, "samples", "notes", "a.txt"))).toBe(true);
    expect(readFileSync(join(dist, "sw.js"), "utf-8")).toBe("bundle");
    // the development server does not serve the built-in samples
    let middleware: (
      request: { url: string },
      response: {
        statusCode: number;
        setHeader: () => void;
        end: (body?: unknown) => void;
      },
      next: () => void,
    ) => void = () => {};
    call(plugin.configureServer, {
      middlewares: { use: (m: typeof middleware) => (middleware = m) },
    });
    const get = (url: string) => {
      const response = {
        statusCode: 200,
        body: undefined as unknown,
        setHeader: () => {},
        end: (body?: unknown) => (response.body = body),
      };
      let passed = false;
      middleware({ url }, response, () => (passed = true));
      return { status: response.statusCode, passed, body: response.body };
    };
    expect(get("/samples/glued-plate/block.vtu")).toMatchObject({
      status: 404,
      passed: false,
    });
    expect(get("/samples/bushing/block.vtu")).toMatchObject({ status: 200 });
    expect(get("/index.html")).toMatchObject({ passed: true });
    // with them (the default), public/ is copied by Vite as before
    const plain = extraSamples(undefined, undefined);
    expect(call(plain.config)).toBeUndefined();
  });
});
