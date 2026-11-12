import { describe, expect, it } from "vitest";
import {
  exportName,
  formatBytes,
  isZip,
  mediaType,
  projectNameProblem,
  stemOf,
  suffixOf,
} from "./files";

describe("exports", () => {
  it("are named after the project", () => {
    expect(exportName("bar.felupe.json", ".py")).toBe("bar.py");
    expect(exportName("bar.json", ".py")).toBe("bar.py");
    expect(exportName("bar.felupe.json", "-job_1-6.png")).toBe(
      "bar-job_1-6.png",
    );
    expect(exportName(".felupe.json", ".py")).toBe("untitled.py");
    // of a project archive (#149)
    expect(exportName("bar.felupe.zip", ".py")).toBe("bar.py");
    expect(stemOf("bar (1).zip")).toBe("bar (1)");
    expect(stemOf("bar")).toBe("bar");
  });

  it("have media types", () => {
    expect(mediaType("bar.py")).toBe("text/x-python");
    expect(mediaType("job_1.csv")).toBe("text/csv");
    expect(mediaType("bar.felupe.json")).toBe("application/json");
    expect(mediaType("bar.png")).toBe("image/png");
    expect(mediaType("bar.felupe.zip")).toBe("application/zip");
    expect(mediaType("bar")).toBe("application/octet-stream");
  });
});

describe("ZIP files (#148)", () => {
  it("are recognized by their first bytes", () => {
    const bytes = (...b: number[]) => Uint8Array.from(b);
    expect(isZip(bytes(0x50, 0x4b, 3, 4, 20))).toBe(true);
    // an empty archive
    expect(isZip(bytes(0x50, 0x4b, 5, 6))).toBe(true);
    expect(isZip(bytes(0x50, 0x4b, 7, 8))).toBe(false);
    expect(isZip(new TextEncoder().encode('{"commands": []}'))).toBe(false);
    expect(isZip(bytes(0x50))).toBe(false);
  });
});

describe("sizes of files (#150)", () => {
  it("are given in B, kB or MB", () => {
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(1500)).toBe("1.5 kB");
    expect(formatBytes(31_420)).toBe("31 kB");
    expect(formatBytes(2_500_000)).toBe("2.5 MB");
    expect(formatBytes(120_000_000)).toBe("120 MB");
  });
});

describe("the name of a project (#205)", () => {
  it("has a suffix of its format", () => {
    expect(suffixOf("bar.felupe.zip")).toBe(".felupe.zip");
    expect(suffixOf("bar.felupe.json")).toBe(".felupe.json");
    expect(suffixOf("bar.json")).toBe(".json");
  });

  it("is a valid file name", () => {
    expect(projectNameProblem("bar")).toBeUndefined();
    expect(projectNameProblem(" spring 2 ")).toBeUndefined();
    expect(projectNameProblem("  ")).toBe("Enter a name.");
    expect(projectNameProblem("a/b")).toContain("none of the characters");
    expect(projectNameProblem("a:b")).toContain("none of the characters");
    expect(projectNameProblem("tab\there")).toContain("none of the characters");
    expect(projectNameProblem(".bar")).toBe(
      "A name does not start with a dot.",
    );
  });

  it("is not the name of a mesh script of an archive with the script", () => {
    const meshFiles = ["bushing.py", "plate.vtu"];
    expect(projectNameProblem("bushing", { meshFiles })).toBeUndefined();
    expect(projectNameProblem("bushing", { meshFiles, script: true })).toBe(
      "bushing.py is a mesh script of the project: the archive would have two files bushing.py. Take another name or no script.",
    );
    expect(
      projectNameProblem("plate", { meshFiles, script: true }),
    ).toBeUndefined();
  });
});
