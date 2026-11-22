import { describe, expect, it } from "vitest";
import type { Command } from "./resolved";
import { fadedIn, isOn, namesOf, offIn } from "./steps";

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

describe("what is off in a step (#393)", () => {
  const commands = [
    { command: "section.add", name: "rubber" },
    { command: "boundary.add", name: "fixed" },
    { command: "loadcase.add", name: "shear" },
    { command: "symmetry.add", name: "half" },
    { command: "rigid.add", name: "plate" },
    { command: "rigid.add", name: "roller" },
    { command: "rigid.add", name: "spare" },
    { command: "mpc.add", name: "glue" },
    { command: "contact.add", name: "press", surface: "plate" },
    { command: "contact.add", name: "roll", surface: "roller" },
    { command: "contact.add", name: "roll_back", surface: "roller" },
    { command: "load.add", name: "pull" },
    { command: "pressure.add", name: "inflate" },
  ] as Command[];

  it("is nothing by default", () => {
    expect(offIn({}, commands)).toEqual([]);
    expect(fadedIn({}, commands)).toEqual(new Set());
  });

  it("are the boundaries, constraints, contacts and loads that it does not name", () => {
    const step: Parameters<typeof offIn>[0] = {
      boundaries: ["fixed"],
      constraints: ["roll"],
      loads: ["inflate"],
    };
    // in the order of the model, without the sections
    expect(offIn(step, commands)).toEqual([
      "shear",
      "half",
      "glue",
      "press",
      "roll_back",
      "pull",
    ]);
    // a rigid surface is faded with all of its contacts off, a surface without a
    // contact is not
    expect(fadedIn(step, commands)).toEqual(
      new Set([...offIn(step, commands), "plate"]),
    );
    expect(fadedIn({ constraints: ["glue"] }, commands).has("roller")).toBe(
      true,
    );
  });
});
