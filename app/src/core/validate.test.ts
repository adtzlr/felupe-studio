import { describe, expect, it } from "vitest";
import cases from "../../../tests/data/validation_cases.json";
import type { Command } from "./commands";
import { NAME_MAX_LENGTH, RESERVED_KEYWORDS, SCHEMA_VERSION } from "./schema";
import { nameProblem, references, validate } from "./validate";

describe("validate", () => {
  // the same cases and messages as the Python validation
  it.each(cases.map((c) => [c.name, c] as const))("%s", (_, c) => {
    const issues = validate(c.document.commands as Command[]);
    expect(issues.map((i) => i.message)).toEqual(c.errors);
  });

  it("returns index and name of the command", () => {
    const c = cases.find((c) => c.name === "unknown mesh")!;
    const [issue] = validate(c.document.commands as Command[]);
    expect(issue.index).toBe(1);
    expect(issue.name).toBe("hard");
  });
});

describe("schema values", () => {
  it("are read from the schema", () => {
    expect(SCHEMA_VERSION).toBe(1);
    expect(NAME_MAX_LENGTH).toBe(24);
    expect(RESERVED_KEYWORDS.has("lambda")).toBe(true);
  });
});

describe("nameProblem", () => {
  it("accepts valid names", () => {
    expect(nameProblem("rubber_1")).toBeUndefined();
    expect(nameProblem("_x")).toBeUndefined();
  });

  it("rejects invalid, too long and reserved names", () => {
    expect(nameProblem("1rubber")).toMatch("starts with a letter");
    expect(nameProblem("a b")).toMatch("starts with a letter");
    expect(nameProblem("a".repeat(25))).toMatch("at most 24");
    expect(nameProblem("class")).toMatch("reserved");
    expect(nameProblem("boundaries")).toMatch("reserved");
    expect(nameProblem("field_a")).toMatch("reserved");
  });
});

describe("references", () => {
  it("lists the referenced names with their field", () => {
    const step: Command = {
      command: "step.add",
      name: "step_1",
      sections: ["a", "b"],
      ramp: { boundary: "move", end: 1, num: 2 },
    };
    expect(references(step)).toEqual([
      { field: "sections", name: "a" },
      { field: "sections", name: "b" },
      { field: "ramp", name: "move" },
    ]);
  });
});
