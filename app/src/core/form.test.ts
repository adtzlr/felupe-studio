import { describe, expect, it } from "vitest";
import fixture from "../../../tests/data/two_sections.json";
import type { Command, CommandList } from "./commands";
import {
  available,
  type Context,
  type Draft,
  draftErrors,
  fieldSpecs,
  initialDraft,
  normalize,
  sameDraft,
  setValue,
  suggestName,
  toCommand,
} from "./form";
import { parse } from "./project";
import { REGISTRY } from "./registry";
import { ModelStore } from "./store";
import { type CommandType, KINDS, nameProblem, validate } from "./validate";

const commands = (fixture as CommandList).commands;
const find = (name: string) =>
  commands.find((c) => c.name === name)! as unknown as Draft;
const editing = (name: string): Context => ({ commands, editing: name });
const TYPES = Object.keys(KINDS) as CommandType[];

/** Whether the schema (Ajv) accepts the command. */
function schemaAccepts(command: unknown): boolean {
  try {
    parse(JSON.stringify({ schema_version: 1, commands: [command] }));
    return true;
  } catch {
    return false;
  }
}

const summary = (type: CommandType, draft: Draft) =>
  fieldSpecs(type, draft).map(
    (s) => `${s.key}:${s.input.type}${s.required ? "*" : ""}`,
  );

describe("fieldSpecs", () => {
  it("derives the fields of every command from the schema", () => {
    expect(summary("mesh.import", find("specimen"))).toEqual([
      "name:name*",
      "file:text*",
      "tag:text",
      "cell_type:choice",
    ]);
    expect(summary("cellset.from_tag", find("hard"))).toEqual([
      "name:name*",
      "mesh:reference*",
      "value:number*",
    ]);
    expect(summary("material.add", find("umat_hard"))).toEqual([
      "name:name*",
      "model:variant*",
      "parameters.E:number*",
      "parameters.nu:number*",
    ]);
    expect(summary("material.add", find("umat_soft"))).toEqual([
      "name:name*",
      "model:variant*",
      "parameters.mu:number*",
      "parameters.bulk:number",
    ]);
    expect(summary("pointset.add", find("left"))).toEqual([
      "name:name*",
      "select:variant*",
      "select.axis:choice*",
      "select.value:number*",
      "select.atol:number",
    ]);
    expect(summary("boundary.add", find("fixed"))).toEqual([
      "name:name*",
      "pointset:reference*",
      "constrained:multichoice*",
      "value:number",
    ]);
    expect(summary("step.add", find("step_1"))).toEqual([
      "name:name*",
      "sections:reference",
      "ramp:toggle",
      "ramp.boundary:reference*",
      "ramp.also:reference",
      "ramp.start:number",
      "ramp.end:number*",
      "ramp.num:number*",
    ]);
    expect(
      summary("loadcase.add", { type: "biaxial", name: "pull" } as Draft),
    ).toEqual([
      "name:name*",
      "type:variant*",
      "axis:choice",
      "second:choice",
      "clamped:boolean",
      "symmetry:boolean",
    ]);
    expect(
      summary("loadcase.add", { type: "shear", name: "shear" } as Draft),
    ).toEqual([
      "name:name*",
      "type:variant*",
      "axis:choice",
      "normal:choice",
      "compression:number",
      "symmetry:boolean",
    ]);
    expect(summary("job.add", find("job_1"))).toEqual([
      "name:name*",
      "steps:reference*",
      "curve:reference",
    ]);
  });

  it("requires the bulk modulus only for the mixed formulation", () => {
    expect(summary("section.add", find("section_soft"))).toEqual([
      "name:name*",
      "cellset:reference*",
      "material:reference*",
      "formulation:choice*",
      "bulk:number*",
    ]);
    expect(summary("section.add", find("section_hard"))).not.toContain(
      "bulk:number*",
    );
  });

  it("takes ranges, options and the labels of materials from the schema", () => {
    const specs = fieldSpecs("material.add", find("umat_hard"));
    const nu = specs.find((s) => s.key === "parameters.nu")!;
    expect(nu.input).toMatchObject({
      type: "number",
      min: -1,
      exclusiveMax: 0.5,
    });
    expect(nu).toMatchObject({ label: "ν", hint: "nu: Poisson's ratio" });
    const model = specs.find((s) => s.key === "model")!;
    expect(model.input).toMatchObject({
      options: [
        { value: "NeoHooke", label: "Neo-Hooke" },
        { value: "NeoHookeCompressible", label: "Neo-Hooke (compressible)" },
        { value: "MooneyRivlin", label: "Mooney-Rivlin" },
        {
          value: "LinearElasticLargeStrain",
          label: "Linear elastic (large strain)",
        },
      ],
    });
    const ramp = fieldSpecs("step.add", find("step_1")).find(
      (s) => s.key === "ramp.boundary",
    )!;
    expect(ramp.input).toMatchObject({
      type: "reference",
      kind: "boundary",
      multiple: false,
    });
  });

  it("has a label for every field of every variant", () => {
    const context: Context = { commands };
    for (const type of TYPES) {
      // all variants of a command: follow every option of every variant field
      const drafts = [initialDraft(type, context)];
      for (let i = 0; i < drafts.length; i++) {
        for (const spec of fieldSpecs(type, drafts[i])) {
          if (spec.key !== "name") {
            // from the registry, or from the schema (the material registry)
            expect(
              REGISTRY[type].fields[spec.key]?.label ??
                (spec.label !== spec.key ? spec.label : undefined),
              `${type} ${spec.key}`,
            ).toBeDefined();
          }
          if (spec.input.type === "variant") {
            for (const { value } of spec.input.options) {
              const next = setValue(
                type,
                drafts[i],
                spec.path,
                spec.input.seeds[value],
                context,
              );
              if (!drafts.some((d) => sameDraft(d, next))) drafts.push(next);
            }
          }
          if (spec.input.type === "toggle") {
            const next = setValue(type, drafts[i], spec.path, {}, context);
            if (!drafts.some((d) => sameDraft(d, next))) drafts.push(next);
          }
        }
      }
      expect(drafts.length).toBeGreaterThan(0);
    }
  });
});

describe("new sections", () => {
  // the model up to its materials: two cell sets, two materials
  const model = commands.slice(0, 5);

  it("take a cell set without a section", () => {
    const first = initialDraft("section.add", { commands: model });
    expect(first.cellset).toBe("hard");
    const withSection = [...model, find("section_hard") as unknown as Command];
    expect(initialDraft("section.add", { commands: withSection }).cellset).toBe(
      "soft",
    );
  });

  it("use u-p-J for an incompressible material", () => {
    // the latest material is NeoHooke without a bulk modulus
    const draft = initialDraft("section.add", { commands: model });
    expect(draft).toMatchObject({
      material: "umat_soft",
      formulation: "u-p-J",
      bulk: 5000,
    });
    expect(
      initialDraft(
        "section.add",
        { commands: model },
        { material: "umat_hard" },
      ),
    ).toMatchObject({ formulation: "u" });
    // a preset wins
    expect(
      initialDraft("section.add", { commands: model }, { formulation: "u" }),
    ).not.toHaveProperty("bulk");
  });
});

describe("drafts", () => {
  it("accepts the commands of the fixture, like the schema", () => {
    for (const command of commands) {
      const context = editing(command.name);
      const draft = command as unknown as Draft;
      expect(
        draftErrors(command.command, draft, context),
        command.name,
      ).toEqual({});
      expect(toCommand(command.command, draft, context)).toEqual(command);
      expect(schemaAccepts(command)).toBe(true);
    }
  });

  it.each<[string, string, string[], unknown, string]>([
    [
      "umat_hard",
      "nu too large",
      ["parameters", "nu"],
      0.5,
      "Must be less than 0.5.",
    ],
    [
      "umat_hard",
      "nu too small",
      ["parameters", "nu"],
      -1.5,
      "Must be at least -1.",
    ],
    [
      "umat_hard",
      "E not positive",
      ["parameters", "E"],
      0,
      "Must be greater than 0.",
    ],
    ["umat_hard", "E missing", ["parameters", "E"], undefined, "Required."],
    [
      "umat_hard",
      "E not a number",
      ["parameters", "E"],
      NaN,
      "Enter a number, with a point",
    ],
    ["step_1", "no increment", ["ramp", "num"], 0, "Must be at least 1."],
    [
      "step_1",
      "half an increment",
      ["ramp", "num"],
      2.5,
      "Enter a whole number.",
    ],
    [
      "fixed",
      "nothing constrained",
      ["constrained"],
      [],
      "Select at least one.",
    ],
    ["specimen", "no file", ["file"], "", "Required."],
    ["job_1", "no steps", ["steps"], [], "Select at least one."],
    ["section_soft", "bulk missing", ["bulk"], 0, "Must be greater than 0."],
  ])(
    "%s: %s is rejected, like the schema does",
    (name, _, path, value, message) => {
      const command = find(name);
      const type = command.command as CommandType;
      // set the value without normalizing, to check the validation itself
      const draft = structuredClone(command);
      let target = draft;
      for (const key of path.slice(0, -1)) target = target[key] as Draft;
      if (value === undefined) delete target[path.at(-1)!];
      else target[path.at(-1)!] = value;

      const errors = draftErrors(type, draft, editing(name));
      expect(errors[path.join(".")]).toContain(message);
      expect(schemaAccepts(draft)).toBe(false);
    },
  );

  it("checks names", () => {
    const context = editing("umat_hard");
    const errors = (name: string) =>
      draftErrors("material.add", { ...find("umat_hard"), name }, context).name;
    expect(errors("umat_hard")).toBeUndefined(); // its own name
    expect(errors("steel")).toBeUndefined();
    expect(errors("")).toBe("Required.");
    expect(errors("umat_soft")).toBe("The name 'umat_soft' is already used.");
    expect(errors("1steel")).toContain("starts with a letter");
    expect(errors("a".repeat(25))).toContain("at most 24");
    expect(errors("field")).toBe(
      "The name 'field' is reserved for the generated script.",
    );
  });

  it("checks point ids", () => {
    const draft = (ids: unknown) => ({
      command: "pointset.add",
      name: "p",
      select: { ids },
    });
    const errors = (ids: unknown) =>
      draftErrors("pointset.add", draft(ids), { commands })["select.ids"];
    expect(errors([3, 1, 2])).toBeUndefined();
    expect(errors([])).toBe("Enter at least one id.");
    expect(errors([1, 1])).toBe("Each id may appear only once.");
    expect(errors([1.5])).toContain("whole numbers from 0");
    expect(errors([-1])).toContain("whole numbers from 0");
    expect(schemaAccepts(draft([3, 1, 2]))).toBe(true);
    for (const ids of [[], [1, 1], [1.5], [-1]])
      expect(schemaAccepts(draft(ids))).toBe(false);
  });

  it("offers only objects that are defined before the edited one", () => {
    expect(available({ commands }, "material")).toEqual([
      "umat_hard",
      "umat_soft",
    ]);
    expect(available(editing("umat_soft"), "material")).toEqual(["umat_hard"]);
    expect(available(editing("section_hard"), "cellset")).toEqual([
      "hard",
      "soft",
    ]);

    const context = editing("section_hard");
    const draft = { ...find("section_hard"), material: "later" };
    expect(draftErrors("section.add", draft, context).material).toBe(
      "There is no material 'later' before this object.",
    );
    const none = draftErrors(
      "job.add",
      { command: "job.add", name: "j" },
      { commands: [] },
    );
    expect(none.steps).toBe("Create a step first.");
  });
});

describe("editing a draft", () => {
  const context: Context = { commands };

  it("switches the material model, keeps shared parameters and fills defaults", () => {
    const draft = { ...find("umat_soft"), parameters: { mu: 3, bulk: 100 } };
    const next = setValue(
      "material.add",
      draft,
      ["model"],
      "NeoHookeCompressible",
      context,
    );
    expect(next).toEqual({
      command: "material.add",
      name: "umat_soft",
      model: "NeoHookeCompressible",
      parameters: { mu: 3, lmbda: 2 },
    });
    const linear = setValue(
      "material.add",
      next,
      ["model"],
      "LinearElasticLargeStrain",
      context,
    );
    expect(linear.parameters).toEqual({ E: 1, nu: 0.3 });
  });

  it("adds and removes the bulk modulus with the formulation", () => {
    const mixed = setValue(
      "section.add",
      find("section_hard"),
      ["formulation"],
      "u-p-J",
      context,
    );
    expect(mixed.bulk).toBe(5000);
    const displacement = setValue(
      "section.add",
      mixed,
      ["formulation"],
      "u",
      context,
    );
    expect("bulk" in displacement).toBe(false);
    expect(schemaAccepts(displacement)).toBe(true);
  });

  it("switches the variant of a point set", () => {
    const spec = fieldSpecs("pointset.add", find("left")).find(
      (s) => s.key === "select",
    )!;
    if (spec.input.type !== "variant") throw new Error("not a variant");
    const ids = setValue(
      "pointset.add",
      find("left"),
      ["select"],
      spec.input.seeds.ids,
      context,
    );
    expect(ids.select).toEqual({ ids: [] });
    expect(summary("pointset.add", ids)).toEqual([
      "name:name*",
      "select:variant*",
      "select.ids:integers*",
    ]);
    const axis = setValue(
      "pointset.add",
      ids,
      ["select"],
      spec.input.seeds.axis,
      context,
    );
    expect(axis.select).toEqual({ axis: "x", value: 0 });
  });

  it("switches the ramp of a step on and off", () => {
    const off = setValue(
      "step.add",
      find("step_1"),
      ["ramp"],
      undefined,
      context,
    );
    expect("ramp" in off).toBe(false);
    expect(summary("step.add", off)).toEqual([
      "name:name*",
      "sections:reference",
      "ramp:toggle",
    ]);
    const on = setValue("step.add", off, ["ramp"], {}, context);
    expect(on.ramp).toEqual({ boundary: "move", end: 1, num: 5 });
    expect(draftErrors("step.add", on, editing("step_1"))).toEqual({});
  });

  it("removes a value with undefined and keeps other values", () => {
    const next = setValue(
      "mesh.import",
      find("specimen"),
      ["tag"],
      undefined,
      context,
    );
    expect(next).toEqual({
      command: "mesh.import",
      name: "specimen",
      file: "specimen.vtu",
    });
    // the draft of the store is frozen and stays untouched
    expect(find("specimen").tag).toBe("material");
  });

  it("does not refill a field that was emptied", () => {
    const type = "material.add";
    const cleared = setValue(
      type,
      find("umat_hard"),
      ["parameters", "E"],
      undefined,
      context,
    );
    expect(cleared.parameters).toEqual({ nu: 0.3 });
    const next = setValue(type, cleared, ["parameters", "nu"], 0.2, context);
    expect(next.parameters).toEqual({ nu: 0.2 });
    expect(draftErrors(type, next, editing("umat_hard"))).toEqual({
      "parameters.E": "Required.",
    });
  });

  it("drops properties that the schema does not know", () => {
    const draft = { ...find("specimen"), extra: 1 };
    expect(normalize("mesh.import", draft, context)).toEqual(find("specimen"));
  });

  it("compares drafts independent of the key order", () => {
    expect(
      sameDraft({ a: 1, b: { c: [1, 2] } }, { b: { c: [1, 2] }, a: 1 }),
    ).toBe(true);
    expect(sameDraft({ a: 1, b: undefined }, { a: 1 })).toBe(true);
    expect(sameDraft({ a: [1, 2] }, { a: [2, 1] })).toBe(false);
    expect(sameDraft({ a: NaN }, { a: NaN })).toBe(true);
  });
});

describe("new commands", () => {
  it("suggests valid, unused names", () => {
    for (const type of TYPES) {
      const name = suggestName(type, commands);
      expect(nameProblem(name), name).toBeUndefined();
    }
    const store = new ModelStore();
    expect(suggestName("material.add", store.commands)).toBe("material_1");
    store.apply({
      type: "add",
      command: toCommand(
        "material.add",
        initialDraft("material.add", store),
        store,
      ),
    });
    expect(suggestName("material.add", store.commands)).toBe("material_2");
  });

  it("builds a valid model from the defaults", () => {
    // every command with its defaults; only the mesh file has to be entered
    const store = new ModelStore();
    const add = (
      type: CommandType,
      change: (draft: Draft) => Draft = (d) => d,
    ) => {
      const context: Context = { commands: store.commands };
      const draft = change(initialDraft(type, context));
      expect(draftErrors(type, draft, context), type).toEqual({});
      store.apply({ type: "add", command: toCommand(type, draft, context) });
    };
    const context = (): Context => ({ commands: store.commands });

    expect(
      draftErrors(
        "mesh.import",
        initialDraft("mesh.import", context()),
        context(),
      ),
    ).toEqual({
      file: "Required.",
    });
    add("mesh.import", (d) =>
      setValue("mesh.import", d, ["file"], "bar.vtu", context()),
    );
    add("mesh.merge");
    add("cellset.from_file");
    add("material.add", (d) =>
      setValue("material.add", d, ["parameters", "bulk"], 50, context()),
    );
    add("section.add");
    add("pointset.add");
    add("boundary.add");
    add("step.add");
    add("job.add");

    expect(store.commands.map((c) => c.name)).toEqual([
      "mesh_1",
      "merge_1",
      "cells_1",
      "material_1",
      "section_1",
      "points_1",
      "boundary_1",
      "step_1",
      "job_1",
    ]);
    expect(validate(store.commands)).toEqual([]);
    expect(() => parse(JSON.stringify(store.document))).not.toThrow();
    expect(store.get("section_1")).toMatchObject({
      cellset: "cells_1",
      material: "material_1",
    });
    expect(store.get("job_1")).toMatchObject({ steps: ["step_1"] });
  });
});

describe("renaming", () => {
  it("renames the references of other commands in one undo step", () => {
    const store = new ModelStore(fixture as CommandList);
    const move = store.get("move") as Command;
    store.update("move", { ...move, name: "pull" });
    expect(store.get("step_1")).toMatchObject({ ramp: { boundary: "pull" } });
    expect(store.get("job_1")).toMatchObject({ curve: "pull" });
    expect(store.issues).toEqual([]);

    const hard = store.get("section_hard") as Command;
    store.update("section_hard", { ...hard, name: "stiff" });
    expect(store.issues).toEqual([]);

    store.undo();
    store.undo();
    expect(store.document).toEqual(fixture);
  });

  it("renames entries of lists", () => {
    const store = new ModelStore(fixture as CommandList);
    store.update("step_1", {
      ...(store.get("step_1") as Command),
      name: "loading",
    });
    expect(store.get("job_1")).toMatchObject({ steps: ["loading"] });
  });
});
