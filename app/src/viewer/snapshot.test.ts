// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import { backgroundOf } from "./snapshot";

describe("snapshot", () => {
  it("takes the first opaque background", () => {
    const outer = document.createElement("div");
    outer.style.backgroundColor = "rgb(38, 43, 54)";
    const inner = document.createElement("div");
    outer.appendChild(inner);
    document.body.appendChild(outer);
    expect(backgroundOf(inner)).toBe("rgb(38, 43, 54)");
    expect(backgroundOf(null)).toBe("#ffffff");
    outer.remove();
  });
});
