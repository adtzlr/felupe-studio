import { describe, expect, it } from "vitest";
import fixture from "../../../tests/data/two_sections.json";
import type { Command, CommandList } from "./commands";
import {
  addRow,
  available,
  cells,
  choiceOptions,
  type Context,
  type Draft,
  draftErrors,
  fieldSpecs,
  getValue,
  initialDraft,
  nextReference,
  normalize,
  offered,
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
    parse(JSON.stringify({ schema_version: 2, commands: [command] }));
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
      "scale:number",
      // an own color of the mesh (#336)
      "color:color",
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
      "value:numbers",
    ]);
    expect(summary("mpc.add", {} as Draft)).toEqual([
      "name:name*",
      "points:reference*",
      "center:reference*",
      "constrained:multichoice*",
      "multiplier:number",
      "rotation:reference",
    ]);
    expect(summary("load.add", {} as Draft)).toEqual([
      "name:name*",
      "points:reference*",
      "force:numbers*",
    ]);
    const curve = fieldSpecs("job.add", find("job_1")).find(
      (s) => s.key === "curve",
    )!;
    expect(curve.input).toMatchObject({ kind: ["boundary", "load"] });
    expect(summary("point.add", {} as Draft)).toEqual([
      "name:name*",
      "coordinates:numbers*",
    ]);
    expect(summary("step.add", find("step_1"))).toEqual([
      "name:name*",
      "sections:reference",
      "constraints:reference",
      "loads:reference",
      "ramp:toggle",
      "ramp.num:number*",
      "ramp.items:rows*",
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
      "tol:number",
      "maxiter:number",
      "solver:toggle",
      "cutback:toggle",
    ]);
    // the settings of a cutback (#133)
    expect(
      summary("job.add", { ...find("job_1"), cutback: {} } as Draft).slice(-4),
    ).toEqual([
      "cutback:toggle",
      "cutback.factor:number",
      "cutback.max_cutbacks:number",
      "cutback.growth:number",
    ]);
  });

  it("shows the options of an iterative linear solver only for it (#203)", () => {
    const context = { commands: (fixture as CommandList).commands };
    const job = find("job_1");
    const on = setValue("job.add", job, ["solver"], {}, context);
    expect(on.solver).toEqual({ type: "superlu" });
    const keys = (draft: Draft) =>
      fieldSpecs("job.add", draft)
        .map((spec) => spec.key)
        .filter((key) => key.startsWith("solver"));
    expect(keys(on)).toEqual(["solver", "solver.type", "solver.precision"]);
    const iterative = setValue(
      "job.add",
      on,
      ["solver", "type"],
      "iterative",
      context,
    );
    expect(iterative.solver).toEqual({ type: "iterative", method: "minres" });
    expect(keys(iterative)).toEqual([
      "solver",
      "solver.type",
      "solver.method",
      "solver.rtol",
      "solver.maxiter",
    ]);
    // a direct solver loses the options of the iterative one
    const direct = setValue(
      "job.add",
      { ...iterative, solver: { ...(iterative.solver as Draft), rtol: 1e-6 } },
      ["solver", "type"],
      "spsolve",
      context,
    );
    expect(direct.solver).toEqual({ type: "spsolve" });
    expect(schemaAccepts(direct)).toBe(true);
    expect(schemaAccepts(iterative)).toBe(true);
  });

  it("offers the precision only for a direct solver (ADR 0016)", () => {
    const context = { commands: (fixture as CommandList).commands };
    const on = setValue("job.add", find("job_1"), ["solver"], {}, context);
    const single = setValue(
      "job.add",
      on,
      ["solver", "precision"],
      "single",
      context,
    );
    expect(single.solver).toEqual({ type: "superlu", precision: "single" });
    expect(schemaAccepts(single)).toBe(true);
    const spec = fieldSpecs("job.add", single).find(
      (s) => s.key === "solver.precision",
    )!;
    expect(choiceOptions(spec, "single")).toEqual({
      empty: "Double (float64) (default)",
      options: [{ value: "single", label: "Single (float32)" }],
    });
    // an iterative solver loses it
    const iterative = setValue(
      "job.add",
      single,
      ["solver", "type"],
      "iterative",
      context,
    );
    expect(iterative.solver).toEqual({ type: "iterative", method: "minres" });
    expect(
      fieldSpecs("job.add", iterative).some(
        (s) => s.key === "solver.precision",
      ),
    ).toBe(false);
    expect(
      schemaAccepts({
        ...iterative,
        solver: { ...(iterative.solver as Draft), precision: "single" },
      }),
    ).toBe(false);
  });

  it("requires the bulk modulus only for the mixed formulation", () => {
    expect(summary("section.add", find("section_soft"))).toEqual([
      "name:name*",
      "cellset:reference*",
      "material:reference*",
      "formulation:choice*",
      "bulk:number*",
      "volumetric:choice",
    ]);
    // the bulk modulus and the volumetric part only with u-p-J (#134)
    expect(summary("section.add", find("section_hard"))).toEqual([
      "name:name*",
      "cellset:reference*",
      "material:reference*",
      "formulation:choice*",
    ]);
    const hard = { ...find("section_hard"), volumetric: "log", bulk: 1 };
    const context = { commands: (fixture as CommandList).commands };
    expect(normalize("section.add", hard as Draft, context)).not.toHaveProperty(
      "volumetric",
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
    expect(nu).toMatchObject({
      label: "ν",
      hint: "Poisson's ratio",
      symbolOf: "nu",
    });
    const model = specs.find((s) => s.key === "model")!;
    expect(model.input).toMatchObject({
      // the groups of the menus of the ribbon (#259)
      options: [
        {
          value: "LinearElasticSmallStrain",
          label: "Linear elastic (small strain)",
          group: "Linear elasticity",
        },
        {
          value: "LinearElasticLargeStrain",
          label: "Linear elastic (large strain)",
          group: "Linear elasticity",
        },
        { value: "NeoHooke", label: "Neo-Hooke", group: "Hyperelasticity" },
        {
          value: "NeoHookeCompressible",
          label: "Neo-Hooke (compressible)",
          group: "Hyperelasticity",
        },
        {
          value: "MooneyRivlin",
          label: "Mooney-Rivlin",
          group: "Hyperelasticity",
        },
        { value: "Yeoh", label: "Yeoh", group: "Hyperelasticity" },
        {
          value: "ThirdOrderDeformation",
          label: "Third-order deformation",
          group: "Hyperelasticity",
        },
        { value: "Ogden", label: "Ogden", group: "Hyperelasticity" },
        {
          value: "ArrudaBoyce",
          label: "Arruda-Boyce",
          group: "Hyperelasticity",
        },
        {
          value: "ExtendedTube",
          label: "Extended tube",
          group: "Hyperelasticity",
        },
        {
          value: "LinearElastic",
          label: "Linear elastic",
          group: "Strain-based elasticity",
        },
        {
          value: "LinearElasticPlasticIsotropicHardening",
          label: "Elastic-plastic, isotropic hardening",
          group: "Strain-based elasticity",
        },
      ],
    });
    // the lists of Ogden (#136): one to three values, no exponent of zero
    const ogden = fieldSpecs("material.add", {
      ...find("umat_hard"),
      model: "Ogden",
      parameters: { mu: [1], alpha: [2, 1] },
    } as unknown as Draft);
    expect(ogden.find((s) => s.key === "parameters.alpha")!.input).toEqual({
      type: "numbers",
      minItems: 1,
      maxItems: 3,
      nonzero: true,
      expressions: true,
    });
    expect(
      draftErrors(
        "material.add",
        {
          ...find("umat_hard"),
          model: "Ogden",
          parameters: { mu: [1], alpha: [2, 1] },
        } as unknown as Draft,
        editing("umat_hard"),
      ),
    ).toEqual({ "parameters.alpha": "Enter as many values as for μᵢ (1)." });
    expect(
      draftErrors(
        "material.add",
        {
          ...find("umat_hard"),
          model: "Ogden",
          parameters: { mu: [1], alpha: [0] },
        } as unknown as Draft,
        editing("umat_hard"),
      ),
    ).toEqual({ "parameters.alpha": "Enter numbers other than 0." });
    const ramp = fieldSpecs("step.add", find("step_1")).find(
      (s) => s.key === "ramp.items",
    )!;
    expect(ramp.input).toMatchObject({ type: "rows", minItems: 1 });
    const columns = ramp.input.type === "rows" ? ramp.input.columns : [];
    expect(
      columns.map((c) => [c.path.join("."), c.key, c.input.type, c.required]),
    ).toEqual([
      ["target", "ramp.items.target", "reference", true],
      // a number or one per constrained component of a boundary (#225)
      ["start", "ramp.items.start", "numbers", false],
      ["end", "ramp.items.end", "numbers", true],
    ]);
    expect(columns[0]).toMatchObject({ unique: true, label: "Item" });
    expect(columns[0].input).toMatchObject({
      kind: ["boundary", "load", "pressure"],
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

describe("new boundaries and constraints of 2D models (#175)", () => {
  it("constrain x and y", () => {
    const planar = [
      { command: "model.settings", name: "settings", analysis: "axisymmetric" },
      ...commands,
    ] as Command[];
    expect(
      initialDraft("boundary.add", { commands: planar }).constrained,
    ).toEqual(["x", "y"]);
    expect(initialDraft("mpc.add", { commands: planar }).constrained).toEqual([
      "x",
      "y",
    ]);
    expect(initialDraft("boundary.add", { commands }).constrained).toEqual([
      "x",
      "y",
      "z",
    ]);
  });
});

describe("rigid surfaces (#219)", () => {
  it("are a plane or a cylinder", () => {
    const draft = initialDraft("rigid.add", { commands });
    expect(draft).toMatchObject({
      coordinates: [0, 0, 0],
      shape: { normal: [0, 0, 1] },
    });
    const keys = (d: Draft) =>
      fieldSpecs("rigid.add", d).map((spec) => spec.key);
    expect(keys(draft)).toEqual([
      "name",
      "coordinates",
      "shape",
      "shape.normal",
    ]);
    expect(keys({ ...draft, shape: { radius: 1 } })).toEqual([
      "name",
      "coordinates",
      "shape",
      "shape.radius",
      "shape.axis",
      "shape.inside",
    ]);
  });
});

describe("new contacts (#220)", () => {
  it("take the latest rigid surface and face set", () => {
    const plate = {
      command: "rigid.add",
      name: "plate",
      coordinates: [4, 0.5, 0.5],
      shape: { normal: [-1, 0, 0] },
    } as Command;
    // the latest point set without face sets
    expect(
      initialDraft("contact.add", { commands: [...commands, plate] }),
    ).toMatchObject({ points: "right", surface: "plate" });
    const faces = {
      command: "faceset.add",
      name: "end",
      section: "section_soft",
      select: { axis: "x", value: 3 },
    } as Command;
    expect(
      initialDraft("contact.add", { commands: [...commands, faces, plate] }),
    ).toMatchObject({ points: "end", surface: "plate" });
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

  it("offers all objects of a kind, also the ones created later (#80)", () => {
    expect(available({ commands }, "material")).toEqual([
      "umat_hard",
      "umat_soft",
    ]);
    // a material after the edited section, but not the edited object itself
    const later = [
      ...commands,
      {
        command: "material.add",
        name: "later",
        model: "NeoHooke",
        parameters: { mu: 1 },
      },
    ] as Command[];
    expect(
      available({ commands: later, editing: "section_hard" }, "material"),
    ).toEqual(["umat_hard", "umat_soft", "later"]);
    expect(available(editing("umat_soft"), "material")).toEqual(["umat_hard"]);
    expect(available(editing("section_hard"), "cellset")).toEqual([
      "hard",
      "soft",
    ]);

    const context = editing("section_hard");
    const draft = { ...find("section_hard"), material: "missing" };
    expect(draftErrors("section.add", draft, context).material).toBe(
      "There is no material 'missing'.",
    );
    const none = draftErrors(
      "job.add",
      { command: "job.add", name: "j" },
      { commands: [] },
    );
    expect(none.steps).toBe("Create a step first.");
  });

  it("lets the steps of a job repeat one, in order (#331)", () => {
    const input = (type: CommandType, draft: Draft, key: string) =>
      fieldSpecs(type, draft).find((s) => s.key === key)?.input;
    // a list without uniqueItems and without a fixed number of items
    expect(input("job.add", find("job_1"), "steps")).toMatchObject({
      type: "reference",
      multiple: true,
      minItems: 1,
      repeats: true,
    });
    expect(input("step.add", find("step_1"), "sections")).not.toHaveProperty(
      "repeats",
    );
    const job = { ...find("job_1"), steps: ["step_1", "step_1"] } as Draft;
    expect(draftErrors("job.add", job, editing("job_1")).steps).toBeUndefined();
    const step = {
      ...find("step_1"),
      sections: ["section_hard", "section_hard"],
    };
    expect(
      draftErrors("step.add", step as Draft, editing("step_1")).sections,
    ).toBe("Each object may appear only once.");
  });

  it("adds the step after the last one, after the last the first (#331)", () => {
    const names = ["load", "unload"];
    expect(nextReference(names, [])).toBe("load");
    expect(nextReference(names, ["load"])).toBe("unload");
    expect(nextReference(names, ["load", "unload"])).toBe("load");
    expect(nextReference(["load"], ["load"])).toBe("load");
    // after a missing step, the first one
    expect(nextReference(names, ["gone"])).toBe("load");
    expect(nextReference([], [])).toBeUndefined();
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
    // a strain-based material (#191): its framework, small strain by default
    const plastic = setValue(
      "material.add",
      linear,
      ["model"],
      "LinearElasticPlasticIsotropicHardening",
      context,
    );
    // (E and ν kept)
    expect(plastic.parameters).toEqual({
      E: 1,
      nu: 0.3,
      sigma_y: 250,
      K: 1000,
    });
    const framework = fieldSpecs("material.add", plastic).find(
      (s) => s.key === "framework",
    )!;
    expect(framework).toMatchObject({ label: "Framework", required: false });
    expect(choiceOptions(framework, undefined)).toEqual({
      empty: "Small strain (default)",
      options: [
        { value: "total-lagrange", label: "Total Lagrange (large rotations)" },
        { value: "co-rotational", label: "Co-rotational (Biot strain)" },
        { value: "seth-hill", label: "Seth-Hill (strain exponent m)" },
      ],
    });
    // the strain exponent of the Seth-Hill framework, only with it (FElupe 12.1)
    const exponent = (draft: typeof plastic) =>
      fieldSpecs("material.add", draft).find(
        (s) => s.key === "strain_exponent",
      );
    expect(exponent(plastic)).toBeUndefined();
    const seth = setValue(
      "material.add",
      plastic,
      ["framework"],
      "seth-hill",
      context,
    );
    expect(seth.strain_exponent).toBe(0);
    expect(exponent(seth)).toMatchObject({
      label: "Strain exponent m",
      required: true,
    });
    expect(draftErrors("material.add", seth, context)).not.toHaveProperty(
      "strain_exponent",
    );
    const corotational = setValue(
      "material.add",
      seth,
      ["framework"],
      "co-rotational",
      context,
    );
    expect(corotational).not.toHaveProperty("strain_exponent");
    // another model has no framework
    const total = { ...plastic, framework: "total-lagrange" };
    expect(
      setValue("material.add", total, ["model"], "NeoHooke", context),
    ).not.toHaveProperty("framework");
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

  it("shows the coordinates of the chosen symmetry planes only (#186)", () => {
    const keys = (draft: Draft) =>
      fieldSpecs("symmetry.add", draft).map((spec) => spec.key);
    const draft = initialDraft("symmetry.add", context);
    expect(draft.axes).toEqual(["x"]);
    expect(keys(draft)).toEqual(["name", "axes", "x"]);
    const two = setValue(
      "symmetry.add",
      { ...draft, x: 1 },
      ["axes"],
      ["x", "z"],
      context,
    );
    expect(keys(two)).toEqual(["name", "axes", "x", "z"]);
    // a plane that is no longer chosen loses its coordinate
    const one = setValue(
      "symmetry.add",
      { ...two, z: 2 },
      ["axes"],
      ["z"],
      context,
    );
    expect(one).toMatchObject({ axes: ["z"], z: 2 });
    expect("x" in one).toBe(false);
    expect(schemaAccepts(one)).toBe(true);
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

    // at a bound and on a cylinder (#181): the variant with the other required
    // properties filled
    const bound = setValue(
      "pointset.add",
      axis,
      ["select"],
      spec.input.seeds.bound,
      context,
    );
    expect(bound.select).toEqual({ bound: "max", axis: "x" });
    expect(summary("pointset.add", bound)).toEqual([
      "name:name*",
      "select:variant*",
      "select.bound:choice*",
      "select.axis:choice*",
      "select.atol:number",
    ]);
    expect(schemaAccepts(bound)).toBe(true);
    const cylinder = setValue(
      "pointset.add",
      bound,
      ["select"],
      spec.input.seeds.radius,
      context,
    );
    expect(cylinder.select).toEqual({ radius: 1, axis: "x" });
    expect(summary("pointset.add", cylinder)).toEqual([
      "name:name*",
      "select:variant*",
      "select.radius:number*",
      "select.axis:choice*",
      "select.center:numbers",
      "select.atol:number",
    ]);
    expect(schemaAccepts(cylinder)).toBe(true);

    // on the outer surface (#222): no fields
    const surface = setValue(
      "pointset.add",
      cylinder,
      ["select"],
      spec.input.seeds.surface,
      context,
    );
    expect(surface.select).toEqual({ surface: true });
    expect(summary("pointset.add", surface)).toEqual([
      "name:name*",
      "select:variant*",
    ]);
    expect(schemaAccepts(surface)).toBe(true);
    expect(
      spec.input.options.map((o) => o.label).includes("On the outer surface"),
    ).toBe(true);
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
      "constraints:reference",
      "loads:reference",
      "ramp:toggle",
    ]);
    const on = setValue("step.add", off, ["ramp"], {}, context);
    expect(on.ramp).toEqual({ num: 5, items: [{ target: "move", end: 1 }] });
    expect(draftErrors("step.add", on, editing("step_1"))).toEqual({});
  });

  it("edits the ramped items of a step as rows", () => {
    const step = find("step_1");
    const spec = fieldSpecs("step.add", step).find(
      (s) => s.key === "ramp.items",
    )!;
    const [[target, start, end]] = cells(spec, step);
    expect(target).toMatchObject({
      key: "ramp.items.0.target",
      path: ["ramp", "items", "0", "target"],
      row: 0,
    });
    expect(getValue(step, end.path)).toBe(0.5);
    expect(getValue(step, start.path)).toBe(0);

    // a new row takes the boundary that is not ramped yet
    const rows = addRow("step.add", spec, step, editing("step_1"));
    expect(rows.at(-1)).toEqual({ target: "fixed", end: 1 });
    const two = setValue("step.add", step, spec.path, rows, context);
    expect(draftErrors("step.add", two, editing("step_1"))).toEqual({});
    const second = cells(spec, two)[1];
    expect(offered(second[0], two, editing("step_1"))).toEqual(["fixed"]);
    expect(offered(target, two, editing("step_1"))).toEqual(["move"]);
    // every boundary is ramped: no further row
    expect(addRow("step.add", spec, two, editing("step_1")).at(-1)).toEqual({
      end: 1,
    });

    // a cell is set by its path; a boundary ramped twice is an error
    const changed = setValue("step.add", two, second[2].path, -0.1, context);
    expect(changed.ramp).toEqual({
      num: 5,
      items: [
        { target: "move", start: 0, end: 0.5 },
        { target: "fixed", end: -0.1 },
      ],
    });
    const twice = setValue("step.add", two, second[0].path, "move", context);
    expect(draftErrors("step.add", twice, editing("step_1"))).toEqual({
      "ramp.items": "Each item may appear only once.",
    });
    const empty = setValue("step.add", two, second[2].path, undefined, context);
    expect(draftErrors("step.add", empty, editing("step_1"))).toEqual({
      "ramp.items.1.end": "Required.",
    });
    const none = setValue("step.add", two, spec.path, [], context);
    expect(draftErrors("step.add", none, editing("step_1"))).toMatchObject({
      "ramp.items": "Add at least one row.",
    });
  });

  it("takes one value or one per component of a boundary (#225)", () => {
    const boundary = {
      name: "diagonal",
      pointset: "right",
      constrained: ["x", "z"],
    } as Draft;
    const [, , , value] = fieldSpecs("boundary.add", boundary);
    expect(value.input).toMatchObject({
      type: "numbers",
      minItems: 1,
      maxItems: 3,
      collapse: true,
    });
    const errors = (v: unknown) =>
      draftErrors("boundary.add", { ...boundary, value: v }, context);
    // empty is 0, one number for all components, one per component
    expect(errors(undefined)).toEqual({});
    expect(errors(0.5)).toEqual({});
    expect(errors([0.5, -0.1])).toEqual({});
    expect(errors(Number.NaN)).toEqual({
      value: "Enter a number, with a point as decimal separator.",
    });
    expect(errors([0.5, 0.1, 0, 1])).toEqual({
      value:
        "Enter 1 to 3 numbers, separated by commas, with a point as decimal separator.",
    });
  });

  it("takes the coordinates of a control point as three numbers", () => {
    const draft = initialDraft("point.add", { commands });
    expect(draft).toEqual({
      command: "point.add",
      name: "control_1",
      coordinates: [0, 0, 0],
    });
    const errors = (coordinates: unknown) =>
      draftErrors("point.add", { ...draft, coordinates }, { commands });
    expect(errors([4, 0.5, 0.5])).toEqual({});
    expect(errors([4, 0.5])).toEqual({
      coordinates:
        "Enter 3 numbers, separated by commas, with a point as decimal separator.",
    });
    expect(errors([4, Number.NaN, 0])).toHaveProperty("coordinates");
  });

  it("connects a new constraint to the latest point set and control point", () => {
    const control: Command = {
      command: "point.add",
      name: "plate",
      coordinates: [4, 0.5, 0.5],
    };
    const draft = initialDraft("mpc.add", { commands: [...commands, control] });
    expect(draft).toEqual({
      command: "mpc.add",
      name: "mpc_1",
      points: "right",
      center: "plate",
      constrained: ["x", "y", "z"],
    });
  });

  it("labels the empty option of an axis by its default", () => {
    const draft = { name: "pull", type: "biaxial" } as Draft;
    const spec = (key: string) =>
      fieldSpecs("loadcase.add", draft).find((s) => s.key === key)!;
    const labels = (key: string, value?: string) => {
      const { empty, options } = choiceOptions(spec(key), value);
      return [empty, ...options.map((o) => o.label)];
    };
    expect(labels("axis")).toEqual(["x (default)", "y", "z"]);
    expect(labels("second")).toEqual(["y (default)", "x", "z"]);
    // a value set explicitly to the default stays selectable
    expect(labels("axis", "x")).toEqual(["x (default)", "x", "y", "z"]);
    // a required choice has no empty option
    const points = fieldSpecs("pointset.add", find("left")).find(
      (s) => s.key === "select.axis",
    )!;
    expect(choiceOptions(points, "x")).toEqual({
      options: [
        { value: "x", label: "x" },
        { value: "y", label: "y" },
        { value: "z", label: "z" },
      ],
    });
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
    expect(store.get("step_1")).toMatchObject({
      ramp: { items: [{ target: "pull" }] },
    });
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

describe("expressions of parameters (#242)", () => {
  const input = (type: CommandType, draft: Draft, key: string) =>
    fieldSpecs(type, draft).find((s) => s.key === key)!.input;

  it("are allowed in the number fields of the schema", () => {
    const point = { name: "p", select: { axis: "x", value: 0 } };
    expect(input("pointset.add", point, "select.value")).toMatchObject({
      type: "number",
      expressions: true,
    });
    const nodes = { name: "p", select: { points: [[0, 0, 0]] } };
    expect(input("pointset.add", nodes, "select.points")).toMatchObject({
      type: "coordinates",
      expressions: true,
    });
    expect(input("point.add", { name: "c" }, "coordinates")).toMatchObject({
      type: "numbers",
      expressions: true,
    });
    // the value of a parameter: a number, or a derived parameter (ADR 0021)
    expect(
      input("parameter.add", { name: "p", value: 1 }, "value"),
    ).toMatchObject({ type: "number", expressions: true });
    // not in the range of a parameter and the numbers that name things
    for (const [type, draft, key] of [
      ["parameter.add", { name: "p", value: 1 }, "min"],
      ["mesh.merge", { name: "merge" }, "decimals"],
      ["cellset.from_tag", { name: "c", value: 1 }, "value"],
    ] as const)
      expect(input(type, draft, key)).not.toHaveProperty("expressions");
  });

  it("are checked with the values of the parameters", () => {
    const context = {
      commands: [
        { command: "parameter.add", name: "h", value: 4 },
      ] as Command[],
    };
    const errors = (type: CommandType, draft: Draft) =>
      draftErrors(type, { name: "x", ...draft }, context);
    expect(
      errors("point.add", { coordinates: ["h", "sqrt(h)", "-h / 2"] }),
    ).toEqual({});
    expect(
      errors("pointset.add", {
        select: {
          points: [
            [0, 0, "h"],
            [0, 0, "2 * w"],
          ],
        },
      }),
    ).toEqual({
      "select.points": "Line 2: 'w' is not a parameter in '2 * w'.",
    });
    expect(
      errors("material.add", {
        model: "Ogden",
        parameters: { mu: [1], alpha: ["h - 4"] },
      }),
    ).toEqual({
      "parameters.alpha": "'h - 4' is 0. Enter numbers other than 0.",
    });
  });
});
