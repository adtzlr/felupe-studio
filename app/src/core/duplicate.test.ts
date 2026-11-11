import { describe, expect, it } from "vitest";
import fixture from "../../../tests/data/two_sections.json";
import type { Command, CommandList } from "./commands";
import { duplicateBlocker, duplicateName } from "./duplicate";
import { NAME_MAX_LENGTH } from "./schema";
import { ModelStore } from "./store";

const commands = (fixture as CommandList).commands;
const named = (...names: string[]) =>
  names.map((name) => ({ name }) as Command);

describe("duplicate (#138)", () => {
  it("takes the next free name", () => {
    expect(duplicateName("rubber", [])).toBe("rubber_2");
    expect(duplicateName("rubber", named("rubber", "rubber_2"))).toBe(
      "rubber_3",
    );
    expect(duplicateName("material_1", named("material_1"))).toBe("material_2");
    expect(duplicateName("material_1", named("material_2"))).toBe("material_3");
    // shortened to the longest name
    const long = "x".repeat(NAME_MAX_LENGTH);
    const copy = duplicateName(long, named(long));
    expect(copy).toHaveLength(NAME_MAX_LENGTH);
    expect(copy.endsWith("_2")).toBe(true);
  });

  it("is not possible for a setting of the model", () => {
    expect(
      duplicateBlocker({ command: "model.settings", name: "settings" }),
    ).toBe("A model has at most one of these settings.");
    expect(duplicateBlocker(commands[0])).toBeUndefined();
  });

  it("adds the copy after the original as one undo step", () => {
    const store = new ModelStore(fixture as CommandList);
    expect(store.duplicate("umat_hard")).toBe("umat_hard_2");
    const names = store.commands.map((c) => c.name);
    expect(names.slice(3, 6)).toEqual([
      "umat_hard",
      "umat_hard_2",
      "umat_soft",
    ]);
    expect(store.issues).toEqual([]);
    store.undo();
    expect(store.commands).toEqual(commands);
    expect(store.duplicate("missing")).toBeUndefined();
  });
});
