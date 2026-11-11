import { afterEach, describe, expect, it } from "vitest";
import twoSections from "../../../tests/data/two_sections.felupe.json?raw";
import numbers from "../../../tests/data/numbers.felupe.json?raw";
import fixture from "../../../tests/data/two_sections.json";
import type { CommandList } from "./commands";
import { MIGRATIONS, parse, ProjectError, serialize } from "./project";
import { ModelStore } from "./store";

describe("project files", () => {
  // the same files are written by the Python implementation
  it.each([
    ["two_sections.felupe.json", twoSections],
    ["numbers.felupe.json", numbers],
  ])("%s survives a round trip", (_, text) => {
    expect(serialize(parse(text))).toBe(text);
  });

  it("does not depend on the key order", () => {
    const document = fixture as CommandList;
    const shuffled = {
      commands: document.commands.map((c) =>
        Object.fromEntries(Object.entries(c).reverse()),
      ),
      schema_version: 3,
    } as unknown as CommandList;
    expect(serialize(document)).toBe(twoSections);
    expect(serialize(shuffled)).toBe(twoSections);
  });

  it("round-trips through the store", () => {
    const store = new ModelStore(parse(twoSections));
    expect(serialize(store.document)).toBe(twoSections);
  });

  it("rejects invalid files", () => {
    expect(() => parse("{")).toThrow("not valid JSON");
    expect(() => parse("[]")).toThrow("does not contain");
    expect(() => parse('{"commands": []}')).toThrow("no valid schema_version");
    expect(() => parse('{"schema_version": 4, "commands": []}')).toThrow(
      "Please update",
    );
    try {
      parse('{"schema_version": 3, "commands": [{"command": "mesh.import"}]}');
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(ProjectError);
      expect((error as ProjectError).errors.length).toBeGreaterThan(0);
    }
  });

  it("checks parameters per material model", () => {
    const text = (parameters: object) =>
      JSON.stringify({
        schema_version: 3,
        commands: [
          { command: "material.add", name: "m", model: "NeoHooke", parameters },
        ],
      });
    expect(() => parse(text({ mu: 1 }))).not.toThrow();
    expect(() => parse(text({ E: 1 }))).toThrow(ProjectError);
  });

  it("checks the units of the model settings (#132)", () => {
    const text = (units: object) =>
      JSON.stringify({
        schema_version: 3,
        commands: [{ command: "model.settings", name: "settings", units }],
      });
    expect(() => parse(text({ length: "m", force: "kN" }))).not.toThrow();
    expect(() => parse(text({ length: "inch", force: "N" }))).toThrow(
      ProjectError,
    );
    expect(() => parse(text({ length: "mm" }))).toThrow(ProjectError);
  });

  it("does not check references when loading", () => {
    const text = JSON.stringify({
      schema_version: 3,
      commands: [{ command: "cellset.from_file", name: "a", mesh: "missing" }],
    });
    expect(parse(text).commands[0]).toMatchObject({ mesh: "missing" });
  });
});

describe("migrations", () => {
  afterEach(() => {
    delete MIGRATIONS[0];
  });

  it("are applied in order", () => {
    MIGRATIONS[0] = (document) => ({
      ...document,
      schema_version: 1,
      commands: (document.commands as Record<string, unknown>[]).map(
        ({ id, ...c }) => ({
          ...c,
          name: id,
        }),
      ),
    });
    const old = {
      schema_version: 0,
      commands: [{ command: "mesh.import", id: "m", file: "m.vtu" }],
    };
    expect(parse(JSON.stringify(old)).commands[0].name).toBe("m");
  });

  it("turn the ramp of version 1 into items (#90)", () => {
    const old = structuredClone(fixture) as unknown as {
      schema_version: number;
      commands: Record<string, unknown>[];
    };
    old.schema_version = 1;
    const step = old.commands.find((c) => c.command === "step.add")!;
    step.ramp = { boundary: "move", also: ["fixed"], end: 0.5, num: 5 };
    const document = parse(JSON.stringify(old));
    expect(document.schema_version).toBe(3);
    expect(document.commands.find((c) => c.name === "step_1")).toEqual({
      command: "step.add",
      name: "step_1",
      ramp: {
        num: 5,
        items: [
          { target: "move", end: 0.5 },
          { target: "fixed", end: 0.5 },
        ],
      },
    });
    expect(document.commands.slice(0, -2)).toEqual(
      (fixture as CommandList).commands.slice(0, -2),
    );
  });

  it("must exist for older files", () => {
    expect(() => parse('{"schema_version": 0, "commands": []}')).toThrow(
      "No migration from schema version 0",
    );
  });
});
