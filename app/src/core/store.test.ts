import { describe, expect, it, vi } from "vitest";
import fixture from "../../../tests/data/two_sections.json";
import type { CheckReport } from "./checks";
import type { Command, CommandList } from "./commands";
import { HISTORY_LIMIT, ModelStore, StoreError } from "./store";

const document = fixture as CommandList;
const names = (store: ModelStore) => store.commands.map((c) => c.name);

const material: Command = {
  command: "material.add",
  name: "rubber",
  model: "NeoHookeCompressible",
  parameters: { mu: 1, lmbda: 2 },
};

describe("ModelStore", () => {
  it("starts empty or with a document", () => {
    expect(new ModelStore().commands).toEqual([]);
    const store = new ModelStore(document);
    expect(store.document).toEqual(document);
    expect(store.canUndo).toBe(false);
    expect(store.issues).toEqual([]);
  });

  it("adds, updates and removes commands", () => {
    const store = new ModelStore();
    store.apply({ type: "add", command: material });
    expect(names(store)).toEqual(["rubber"]);

    store.apply({
      type: "update",
      name: "rubber",
      command: { ...material, parameters: { mu: 2, lmbda: 2 } },
    });
    expect(store.get("rubber")).toMatchObject({ parameters: { mu: 2 } });

    store.apply({
      type: "add",
      command: { ...material, name: "first" },
      index: 0,
    });
    expect(names(store)).toEqual(["first", "rubber"]);

    store.apply({ type: "remove", name: "rubber" });
    expect(names(store)).toEqual(["first"]);
  });

  it("undoes and redoes edits", () => {
    const store = new ModelStore();
    store.apply({ type: "add", command: material });
    store.apply({
      type: "update",
      name: "rubber",
      command: { ...material, name: "renamed" },
    });
    expect(names(store)).toEqual(["renamed"]);

    store.undo();
    expect(names(store)).toEqual(["rubber"]);
    store.undo();
    expect(names(store)).toEqual([]);
    expect(store.canUndo).toBe(false);
    store.undo(); // nothing to undo
    expect(names(store)).toEqual([]);

    store.redo();
    store.redo();
    expect(names(store)).toEqual(["renamed"]);
    expect(store.canRedo).toBe(false);
  });

  it("clears the redo history after a new edit", () => {
    const store = new ModelStore();
    store.apply({ type: "add", command: material });
    store.undo();
    expect(store.canRedo).toBe(true);
    store.apply({ type: "add", command: { ...material, name: "other" } });
    expect(store.canRedo).toBe(false);
  });

  it("applies several edits as one undo step", () => {
    const store = new ModelStore(document);
    store.apply([
      { type: "remove", name: "job_1" },
      { type: "remove", name: "step_1" },
    ]);
    expect(store.get("step_1")).toBeUndefined();
    store.undo();
    expect(store.document).toEqual(document);
  });

  it("keeps the list unchanged if an edit of a batch fails", () => {
    const store = new ModelStore(document);
    expect(() =>
      store.apply([
        { type: "remove", name: "job_1" },
        { type: "remove", name: "missing" },
      ]),
    ).toThrow(StoreError);
    expect(store.document).toEqual(document);
    expect(store.canUndo).toBe(false);
  });

  it("rejects duplicate names and unknown objects", () => {
    const store = new ModelStore(document);
    expect(() =>
      store.apply({ type: "add", command: { ...material, name: "hard" } }),
    ).toThrow("already used");
    expect(() =>
      store.apply({
        type: "update",
        name: "umat_hard",
        command: { ...material, name: "soft" },
      }),
    ).toThrow("already used");
    expect(() => store.apply({ type: "remove", name: "missing" })).toThrow(
      "no object",
    );
  });

  it("limits the history", () => {
    const store = new ModelStore();
    for (let i = 0; i < HISTORY_LIMIT + 5; i++) {
      store.apply({ type: "add", command: { ...material, name: `m${i}` } });
    }
    let steps = 0;
    while (store.canUndo) {
      store.undo();
      steps++;
    }
    expect(steps).toBe(HISTORY_LIMIT);
    expect(store.commands).toHaveLength(5);
  });

  it("loads a document and clears the history", () => {
    const store = new ModelStore();
    store.apply({ type: "add", command: material });
    store.load(document);
    expect(store.document).toEqual(document);
    expect(store.canUndo).toBe(false);
  });

  it("is not changed by mutating commands from outside", () => {
    const command = structuredClone(material);
    const store = new ModelStore();
    store.apply({ type: "add", command });
    (command.parameters as { mu: number }).mu = 99;
    expect(store.get("rubber")).toMatchObject({ parameters: { mu: 1 } });
    expect(() => {
      (store.get("rubber") as { name: string }).name = "x";
    }).toThrow();
    const copy = store.document;
    copy.commands.pop();
    expect(store.commands).toHaveLength(1);
  });

  it("notifies subscribers", () => {
    const store = new ModelStore();
    const listener = vi.fn();
    const unsubscribe = store.subscribe(listener);
    store.apply({ type: "add", command: material });
    store.undo();
    store.redo();
    expect(listener).toHaveBeenCalledTimes(3);
    unsubscribe();
    store.undo();
    expect(listener).toHaveBeenCalledTimes(3);
  });

  it("validates the commands and lists dependents", () => {
    const store = new ModelStore(document);
    expect(store.dependents("umat_hard")).toEqual(["section_hard"]);
    expect(store.dependents("move")).toEqual(["step_1", "job_1"]);

    store.apply({ type: "remove", name: "umat_hard" });
    expect(store.issues.map((i) => i.name)).toEqual(["section_hard"]);
    store.undo();
    expect(store.issues).toEqual([]);
  });

  it("keeps the check report until the commands change", () => {
    const store = new ModelStore(document);
    const report: CheckReport = {
      ok: true,
      messages: ["192 / 192 cells assigned once."],
      cells: { total: 192, unassigned: [], multiple: [] },
      interfaces: [
        { sections: ["section_hard", "section_soft"], shared: 25, hanging: 0 },
      ],
    };
    store.setReport(report);
    expect(store.report).toBe(report);
    store.apply({ type: "remove", name: "job_1" });
    expect(store.report).toBeUndefined();
  });

  it("caches the derived state", () => {
    const store = new ModelStore(document);
    expect(store.tree).toBe(store.tree);
    expect(store.issues).toBe(store.issues);
  });
});
