import { describe, expect, it } from "vitest";
import data from "../../../tests/data/expression_cases.json";
import type { Command } from "./commands";
import { expressionFields, renameParameter, resolveCommands } from "./resolve";
import { ModelStore } from "./store";
import { renameReferences } from "./validate";

const commands: Command[] = [
  { command: "parameter.add", name: "height", value: 10 },
  { command: "parameter.add", name: "cells", value: 4, integer: true },
  {
    command: "pointset.add",
    name: "top",
    select: { axis: "z", value: "height" },
  },
  {
    command: "boundary.add",
    name: "move",
    pointset: "top",
    constrained: ["x", "z"],
    value: ["0.1 * height", 0],
  },
  {
    command: "step.add",
    name: "step_1",
    ramp: { num: "2 * cells", items: [{ target: "move", end: "height / 4" }] },
  },
];

describe("the fields of the expressions (#242)", () => {
  // the same fields as felupe_studio.expressions.fields(), from the schema
  it.each(
    data.fields.map(
      (c, i) => [`${i} ${c.command.command} ${c.command.name}`, c] as const,
    ),
  )("%s", (_, c) => {
    const fields = expressionFields(c.command as unknown as Command);
    expect(fields).toEqual(c.fields);
  });
});

describe("the values of the expressions (#242)", () => {
  it("replaces the expressions by their values", () => {
    const { commands: resolved, problems } = resolveCommands(commands);
    expect(problems).toEqual([]);
    expect(resolved[2]).toEqual({
      command: "pointset.add",
      name: "top",
      select: { axis: "z", value: 10 },
    });
    expect(resolved[3]).toMatchObject({ value: [1, 0] });
    // an integer parameter is an integer, like in the script
    expect(resolved[4]).toMatchObject({
      ramp: { num: 8, items: [{ target: "move", end: 2.5 }] },
    });
    // a command without expressions is the same object
    expect(resolved[0]).toBe(commands[0]);
  });

  it("leaves out a command with a problem", () => {
    const changed = commands.map((c) =>
      c.name === "top" ? { ...c, select: { axis: "z", value: "hight" } } : c,
    ) as Command[];
    const { commands: resolved, problems } = resolveCommands(changed);
    expect(resolved.map((c) => c.name)).toEqual([
      "height",
      "cells",
      "move",
      "step_1",
    ]);
    expect(problems).toEqual([
      {
        index: 2,
        name: "top",
        field: "select.value",
        message:
          "commands/2: 'select.value' of 'top': 'hight' is not a parameter in 'hight'.",
      },
    ]);
  });

  it("follows a renamed parameter", () => {
    expect(renameParameter(commands[4], "height", "h")).toMatchObject({
      ramp: { num: "2 * cells", items: [{ end: "h / 4" }] },
    });
    expect(renameReferences(commands[3], "height", "h")).toMatchObject({
      value: ["0.1 * h", 0],
    });
    const store = new ModelStore({ schema_version: 3, commands });
    store.update("height", { ...commands[0], name: "h" } as Command);
    expect(store.get("top")).toMatchObject({ select: { value: "h" } });
    expect(store.issues).toEqual([]);
  });

  it("is the same list for the same commands in the store", () => {
    const store = new ModelStore({ schema_version: 3, commands });
    expect(store.resolved).toBe(store.resolved);
    expect(store.getResolved("top")).toMatchObject({ select: { value: 10 } });
  });
});
