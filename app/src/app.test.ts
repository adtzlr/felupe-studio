import { describe, expect, it } from "vitest";
import { APP_NAME, formatVersion } from "./app";

describe("app", () => {
  it("has a name", () => {
    expect(APP_NAME).toBe("FElupe Studio");
  });

  it("formats the version with and without commit", () => {
    expect(formatVersion("0.0.0")).toBe("0.0.0");
    expect(formatVersion("0.0.0", "b61f7411ae425672")).toBe("0.0.0 (b61f741)");
  });
});
