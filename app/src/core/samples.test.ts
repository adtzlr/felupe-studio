import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { parse } from "./project";
import { join } from "node:path";
import { readSamples } from "../vite/samples";
import {
  loadSamples,
  type Sample,
  sampleFiles,
  sampleUrl,
  thumbnailUrl,
} from "./samples";

// the samples of app/samples, read like the build does (#350)
const SAMPLES = readSamples(join(__dirname, "../../samples"));

// the samples of app/samples, which describe themselves (#350)
const folder = (sample: Sample) =>
  new URL(`../../samples/${sample.folder}/`, import.meta.url);

describe("samples", () => {
  it("are project files with their mesh files", () => {
    expect(SAMPLES.length).toBeGreaterThanOrEqual(4);
    for (const sample of SAMPLES) {
      const text = readFileSync(
        new URL("model.felupe.json", folder(sample)),
        "utf8",
      );
      const document = parse(text);
      // the files of imported meshes and of scripts that make meshes (#182)
      const files = document.commands
        .filter(
          (c) => c.command === "mesh.import" || c.command === "mesh.script",
        )
        .map((c) => (c as { file: string }).file);
      expect([...new Set(files)].sort()).toEqual(sample.files);
      for (const file of sample.files) {
        expect(existsSync(new URL(file, folder(sample)))).toBe(true);
      }
    }
  });

  it("are loaded like opened files", async () => {
    const sample = SAMPLES[0];
    const base = "https://example.org/app/";
    expect(sampleUrl(sample, "bar.vtu", base)).toBe(
      `https://example.org/app/samples/${sample.folder}/bar.vtu`,
    );
    const get = vi.fn(
      async (url: string | URL | Request) => new Response(`content of ${url}`),
    );
    const files = await sampleFiles(sample, base, get as typeof fetch);
    expect(files.map((f) => f.name)).toEqual([
      `${sample.id}.felupe.json`,
      ...sample.files,
    ]);
    expect(await files[0].text()).toBe(
      `content of https://example.org/app/samples/${sample.folder}/model.felupe.json`,
    );

    const missing = vi.fn(async () => new Response("", { status: 404 }));
    await expect(
      sampleFiles(sample, base, missing as typeof fetch),
    ).rejects.toThrow(
      "model.felupe.json of the sample could not be loaded (404).",
    );
  });

  it("are the list of the app (#350)", async () => {
    const base = "https://example.org/app/";
    const answer = (body: string, status = 200) =>
      vi.fn(
        async () => new Response(body, { status }),
      ) as unknown as typeof fetch;
    const ok = answer(JSON.stringify(SAMPLES));
    expect(await loadSamples(base, ok)).toEqual(SAMPLES);
    expect(ok).toHaveBeenCalledWith(
      "https://example.org/app/samples/index.json",
    );
    // without a list, or with one that is no list, no samples
    expect(await loadSamples(base, answer("", 404))).toEqual([]);
    expect(await loadSamples(base, answer("{"))).toEqual([]);
    expect(await loadSamples(base, answer('{"id": "a"}'))).toEqual([]);
    const offline = vi.fn(async () => {
      throw new TypeError("Failed to fetch");
    }) as unknown as typeof fetch;
    expect(await loadSamples(base, offline)).toEqual([]);
  });

  it("show their picture or a placeholder", () => {
    const base = "https://example.org/app/";
    const sample = SAMPLES[0];
    expect(thumbnailUrl(sample, base)).toBe(
      `https://example.org/app/samples/${sample.folder}/thumbnail.svg`,
    );
    expect(thumbnailUrl({ ...sample, thumbnail: false }, base)).toMatch(
      /^data:image\/svg\+xml,/,
    );
  });
});
