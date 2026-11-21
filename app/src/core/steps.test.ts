import { describe, expect, it } from "vitest";
import { isOn, namesOf } from "./steps";

describe("the boundaries of a step (#393)", () => {
  it("has all boundaries by default, or those that it names", () => {
    expect(isOn({}, "move")).toBe(true);
    expect(isOn({ boundaries: ["fixed", "half"] }, "half")).toBe(true);
    expect(isOn({ boundaries: ["fixed", "half"] }, "move")).toBe(false);
  });

  it("names the steps in a sentence", () => {
    expect(namesOf("step", ["release"])).toBe("step 'release'");
    expect(namesOf("step", ["a", "b", "c"])).toBe("steps 'a', 'b' and 'c'");
  });
});
