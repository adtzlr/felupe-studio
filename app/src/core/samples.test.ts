import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { parse } from "./project";
import { SAMPLES, sampleFiles, sampleUrl } from "./samples";

const folder = (id: string) =>
  new URL(`../../public/samples/${id}/`, import.meta.url);

describe("samples", () => {
  it("are project files with their mesh files", () => {
    expect(SAMPLES.length).toBeGreaterThanOrEqual(4);
    for (const sample of SAMPLES) {
      const text = readFileSync(
        new URL("model.felupe.json", folder(sample.id)),
        "utf8",
      );
      const document = parse(text);
      const files = document.commands
        .filter((c) => c.command === "mesh.import")
        .map((c) => (c as { file: string }).file);
      expect([...new Set(files)].sort()).toEqual(sample.files);
      for (const file of sample.files) {
        expect(existsSync(new URL(file, folder(sample.id)))).toBe(true);
      }
    }
  });

  it("are loaded like opened files", async () => {
    const sample = SAMPLES[0];
    const base = "https://example.org/app/";
    expect(sampleUrl(sample, "bar.vtu", base)).toBe(
      `https://example.org/app/samples/${sample.id}/bar.vtu`,
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
      `content of https://example.org/app/samples/${sample.id}/model.felupe.json`,
    );

    const missing = vi.fn(async () => new Response("", { status: 404 }));
    await expect(
      sampleFiles(sample, base, missing as typeof fetch),
    ).rejects.toThrow(
      "model.felupe.json of the sample could not be loaded (404).",
    );
  });
});
