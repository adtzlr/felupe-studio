import { describe, expect, it } from "vitest";
import cases from "../../../tests/data/validation_cases.json";
import type { Command } from "./commands";
import { NAME_MAX_LENGTH, RESERVED_KEYWORDS, SCHEMA_VERSION } from "./schema";
import { nameProblem, order, references, validate } from "./validate";

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

  it("returns the field of an issue, if it has one (#137)", () => {
    const field = (name: string) => {
      const c = cases.find((c) => c.name === name)!;
      return validate(c.document.commands as Command[]).map((i) => i.field);
    };
    expect(field("unknown mesh")).toEqual(["mesh"]);
    expect(field("ogden with fewer exponents than moduli")).toEqual([
      "parameters.alpha",
    ]);
    expect(field("two model settings")).toEqual([undefined]);
  });
});

describe("schema values", () => {
  it("are read from the schema", () => {
    expect(SCHEMA_VERSION).toBe(3);
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
      ramp: {
        num: 2,
        items: [
          { target: "move", end: 1 },
          { target: "pull", end: 2 },
        ],
      },
    };
    expect(references(step)).toEqual([
      { field: "sections", name: "a" },
      { field: "sections", name: "b" },
      { field: "ramp", name: "move" },
      { field: "ramp", name: "pull" },
    ]);
  });
});

describe("order", () => {
  const command = (
    name: string,
    kind: string,
    refs: Record<string, unknown> = {},
  ) => ({ command: kind, name, ...refs }) as unknown as Command;
  const names = (commands: Command[]) => commands.map((c) => c.name);

  it("keeps an ordered list", () => {
    const list = [
      command("mesh", "mesh.import"),
      command("cells", "cellset.from_file", { mesh: "mesh" }),
      command("rubber", "material.add"),
      command("body", "section.add", { cellset: "cells", material: "rubber" }),
    ];
    expect(order(list)).toEqual(list);
  });

  it("moves a command and its dependents behind a later reference", () => {
    const list = [
      command("mesh", "mesh.import"),
      command("cells", "cellset.from_file", { mesh: "mesh" }),
      command("body", "section.add", { cellset: "cells", material: "steel" }),
      command("left", "pointset.add"),
      command("fixed", "boundary.add", { pointset: "left" }),
      command("step", "step.add", {
        sections: ["body"],
        ramp: { items: [{ target: "fixed" }] },
      }),
      command("job", "job.add", { steps: ["step"] }),
      command("steel", "material.add"),
    ];
    expect(names(order(list))).toEqual([
      "mesh",
      "cells",
      "left",
      "fixed",
      "steel",
      "body",
      "step",
      "job",
    ]);
    // a point set created after its boundary
    const boundary = [
      command("fixed", "boundary.add", { pointset: "left" }),
      command("mesh", "mesh.import"),
      command("left", "pointset.add"),
    ];
    expect(names(order(boundary))).toEqual(["mesh", "left", "fixed"]);
  });

  it("does not move a command for a reference to a missing object", () => {
    const list = [
      command("body", "section.add", {
        cellset: "missing",
        material: "rubber",
      }),
      command("other", "material.add"),
    ];
    expect(names(order(list))).toEqual(["body", "other"]);
    // the material that the section references comes later
    list.push(command("rubber", "material.add"));
    expect(names(order(list))).toEqual(["other", "rubber", "body"]);
  });
});
