import { describe, expect, it } from "vitest";
import { exportName, isZip, mediaType, stemOf } from "./files";

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
