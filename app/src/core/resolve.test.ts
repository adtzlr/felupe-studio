import { describe, expect, it } from "vitest";
import data from "../../../tests/data/expression_cases.json";
import type { Command } from "./commands";
import {
  evaluateParameters,
  expressionFields,
  parameterValues,
  renameParameter,
  resolveCommands,
} from "./resolve";
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

describe("derived parameters (ADR 0021)", () => {
  it("are evaluated in the order of their dependencies", () => {
    // wherever they stand, in the order of the command list where they are free
    const commands = [
      { command: "parameter.add", name: "c", value: "b + a" },
      { command: "parameter.add", name: "b", value: "2 * a" },
      { command: "parameter.add", name: "d", value: "a / 2", integer: true },
      { command: "parameter.add", name: "a", value: 4 },
      { command: "parameter.add", name: "e", value: "a" },
    ] as Command[];
    const parameters = evaluateParameters(commands);
    expect(parameters.order).toEqual(["b", "c", "d", "e"]);
    expect(parameters.values).toEqual({ a: 4, b: 8, c: 12, d: 2, e: 4 });
    expect(parameterValues(commands)).toEqual(parameters.values);
    // the resolved commands have their values, for the viewer and the checks
    const { commands: resolved, problems } = resolveCommands(commands);
    expect(problems).toEqual([]);
    expect(resolved.map((c) => (c as { value: number }).value)).toEqual([
      12, 8, 2, 4, 4,
    ]);
  });

  it("leave out what uses a parameter with a problem", () => {
    const commands = [
      { command: "parameter.add", name: "a", value: "b" },
      { command: "parameter.add", name: "b", value: "a" },
      { command: "parameter.add", name: "c", value: "2 * a" },
      { command: "symmetry.add", name: "s", axes: ["z"], z: "c" },
    ] as Command[];
    const { commands: resolved, problems } = resolveCommands(commands);
    // only the cause, at every parameter of the cycle
    expect(problems.map((p) => p.message)).toEqual([
      "commands/0: 'value' of 'a': 'a' depends on itself through 'b'.",
      "commands/1: 'value' of 'b': 'b' depends on itself through 'a'.",
    ]);
    expect(resolved).toEqual([]);
  });
});
