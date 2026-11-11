import { describe, expect, it } from "vitest";
import { wheelVersion } from "./AboutDialog";

describe("about", () => {
  it("reads the versions of the wheels", () => {
    const wheels = [
      "wheels/felupe-12.0.0-py3-none-any.whl",
      "wheels/meshio-5.3.5-py3-none-any.whl",
    ];
    expect(wheelVersion("meshio", wheels)).toBe("5.3.5");
    expect(wheelVersion("tensortrax", wheels)).toBeUndefined();
    expect(wheelVersion("tensortrax")).toMatch(/^\d+\.\d+/);
  });
});
