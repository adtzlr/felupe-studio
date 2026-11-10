import { describe, expect, it } from "vitest";
import { exportName, mediaType } from "./files";

describe("exports", () => {
  it("are named after the project", () => {
    expect(exportName("bar.felupe.json", ".py")).toBe("bar.py");
    expect(exportName("bar.json", ".py")).toBe("bar.py");
    expect(exportName("bar.felupe.json", "-job_1-6.png")).toBe(
      "bar-job_1-6.png",
    );
    expect(exportName(".felupe.json", ".py")).toBe("untitled.py");
  });

  it("have media types", () => {
    expect(mediaType("bar.py")).toBe("text/x-python");
    expect(mediaType("job_1.csv")).toBe("text/csv");
    expect(mediaType("bar.felupe.json")).toBe("application/json");
    expect(mediaType("bar.png")).toBe("image/png");
    expect(mediaType("bar")).toBe("application/octet-stream");
  });
});
