import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import cases from "../../../tests/data/sample_folder_cases.json";
import { readSamples, samples, SamplesError, titleOf } from "./samples";

/** A folder with the files of a case: {path: text}. */
function folder(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), "samples-"));
  for (const [name, text] of Object.entries(files)) {
    mkdirSync(dirname(join(root, name)), { recursive: true });
    writeFileSync(join(root, name), text);
  }
  return root;
}

type Case = {
  name: string;
  files: Record<string, string>;
  samples?: unknown[];
  error?: string;
  prefix?: boolean;
};

describe("a folder of samples (#350)", () => {
  // the same cases as felupe_studio.samples (tests/data/sample_folder_cases.json)
  it.each(
    (cases as unknown as Case[]).map((c) => [c.name, c] as [string, Case]),
  )("%s", (_, c) => {
    const root = folder(c.files);
    if (!c.error) {
      expect(readSamples(root)).toEqual(c.samples);
      return;
    }
    const expected = c.error.replace("{version}", __APP_VERSION__);
    expect(() => readSamples(root)).toThrow(SamplesError);
    try {
      readSamples(root);
    } catch (error) {
      const message = (error as Error).message;
      if (c.prefix) expect(message.startsWith(expected)).toBe(true);
      else expect(message).toBe(expected);
    }
  });

  it("does not exist", () => {
    expect(() => readSamples(join(tmpdir(), "no-such-samples"))).toThrow(
      /^the folder .*no-such-samples does not exist\.$/,
    );
  });

  it("names a sample by its id", () => {
    expect(titleOf("engine-mount")).toBe("Engine mount");
    expect(titleOf("seal_ring--2")).toBe("Seal ring 2");
  });

  it("are the samples of the app (app/samples)", () => {
    const list = readSamples(join(__dirname, "../../samples"));
    expect(list[0]).toMatchObject({
      id: "two-materials",
      folder: "01_two-materials",
      title: "Bar of two materials",
      files: ["bar.vtu"],
      thumbnail: true,
    });
    expect(list.at(-1)?.id).toBe("engine-mount");
  });
});

/** Call the hooks of the plugin with a small context of Vite. */
function driver(plugin: ReturnType<typeof samples>, root: string) {
  const emitted: { fileName: string; source: unknown }[] = [];
  const context = {
    error: (message: string) => {
      throw new Error(message);
    },
    emitFile: (file: { fileName: string; source: unknown }) => {
      emitted.push(file);
      return "";
    },
  };
  const call = (hook: unknown, ...args: unknown[]) =>
    (hook as (...a: unknown[]) => unknown).call(context, ...args);
  call(plugin.configResolved, { root });
  return { call, emitted };
}

describe("the plugin of the samples (#350)", () => {
  const files = {
    "02_plate/model.felupe.json": JSON.stringify({
      schema_version: 3,
      commands: [{ command: "mesh.script", name: "plate", file: "plate.py" }],
    }),
    "02_plate/plate.py": "mesh = None",
    "02_plate/sample.json": JSON.stringify({ title: "Plate" }),
    "02_plate/notes.txt": "not a file of the project",
    "01_ring/model.felupe.json": JSON.stringify({
      schema_version: 3,
      commands: [],
    }),
    "01_ring/thumbnail.svg": "<svg/>",
  };

  it("lists, copies and serves the samples of SAMPLES_DIR", () => {
    const dir = folder(files);
    const plugin = samples(dir);
    const { call, emitted } = driver(plugin, "/somewhere/app");
    call(plugin.buildStart);
    const resolved = call(plugin.resolveId, "virtual:samples") as string;
    const module = call(plugin.load, resolved) as string;
    const list = JSON.parse(module.replace("export default ", "").slice(0, -1));
    expect(list.map((s: { id: string }) => s.id)).toEqual(["ring", "plate"]);
    expect(list[1]).toMatchObject({ folder: "02_plate", files: ["plate.py"] });
    call(plugin.generateBundle);
    expect(emitted.map((f) => f.fileName)).toEqual([
      "samples/01_ring/model.felupe.json",
      "samples/01_ring/thumbnail.svg",
      "samples/02_plate/model.felupe.json",
      "samples/02_plate/sample.json",
      "samples/02_plate/plate.py",
    ]);

    let middleware: (
      request: { url: string },
      response: { setHeader: () => void; end: (body?: unknown) => void },
      next: () => void,
    ) => void = () => {};
    call(plugin.configureServer, {
      middlewares: { use: (m: typeof middleware) => (middleware = m) },
    });
    const get = (url: string) => {
      let body: unknown;
      let passed = false;
      middleware(
        { url },
        { setHeader: () => {}, end: (b?: unknown) => (body = b) },
        () => (passed = true),
      );
      return { passed, body: body ? String(body) : undefined };
    };
    expect(get("/app/samples/02_plate/plate.py")).toEqual({
      passed: false,
      body: "mesh = None",
    });
    // only the files of a sample, and only samples of the folder
    expect(get("/samples/02_plate/notes.txt").passed).toBe(true);
    expect(get("/samples/03_other/model.felupe.json").passed).toBe(true);
    expect(get("/index.html").passed).toBe(true);
  });

  it("takes app/samples without SAMPLES_DIR", () => {
    const app = folder({});
    const dir = join(app, "samples");
    for (const [name, text] of Object.entries(files)) {
      mkdirSync(dirname(join(dir, name)), { recursive: true });
      writeFileSync(join(dir, name), text);
    }
    const plugin = samples(undefined);
    const { call } = driver(plugin, app);
    call(plugin.buildStart);
    const module = call(plugin.load, "\0virtual:samples") as string;
    expect(module).toContain('"id":"ring"');
  });

  it("fails the build with the message of the folder", () => {
    const dir = folder({ "01_ring/sample.json": "{}" });
    const plugin = samples(dir);
    const { call } = driver(plugin, "/somewhere/app");
    expect(() => call(plugin.buildStart)).toThrow(
      `The samples of ${dir}: the sample 'ring' has no model.felupe.json.`,
    );
  });
});
