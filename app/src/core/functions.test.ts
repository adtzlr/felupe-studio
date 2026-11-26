import { describe, expect, it } from "vitest";
import type { Command } from "./commands";
import {
  type Context,
  draftErrors,
  fieldSpecs,
  toCommand,
  setValue,
} from "./form";
import { argumentFields } from "./functions";
import { FUNCTIONS } from "./materials";
import { schema } from "./schema";
import { inspectMaterials, materialRun, MeshFiles } from "./meshfiles";
import type { MaterialInfo } from "../worker/protocol";

// a file of two functions, run before a job (#424)
const info: MaterialInfo = {
  file: "soft.py",
  functions: {
    strain_energy: {
      arguments: [{ name: "mu" }, { name: "k", default: 0.5 }],
      statevars: false,
    },
    any: { arguments: [], statevars: false, kwargs: true },
  },
  type: "Hyperelastic(strain_energy)",
  statevars: 0,
};

const material = {
  command: "material.script",
  name: "soft",
  kind: "hyperelastic",
  file: "soft.py",
  arguments: { mu: "2 * G" },
} as const;

const commands: Command[] = [
  { command: "parameter.add", name: "G", value: 0.5 },
  material,
];

async function ran(answer: MaterialInfo = info) {
  const runs: unknown[] = [];
  const files = new MeshFiles(undefined, {
    write: async () => {},
    inspect: async (_, __, sent) => {
      runs.push(sent);
      return answer;
    },
  });
  await files.add("soft.py", new Uint8Array([1]));
  inspectMaterials(commands, files);
  const { key } = materialRun(material, commands);
  await files.inspectMaterial(key, "soft.py", {});
  return { files, runs };
}

describe("strain energy functions of files (#424)", () => {
  it("run with the values of their material", async () => {
    const { runs } = await ran();
    expect(runs).toEqual([{ ...material, arguments: { mu: 1 } }]);
    // the key of the run: the file and the values of the material
    const changed = commands.map((c) =>
      c.name === "G" ? ({ ...c, value: 2 } as Command) : c,
    );
    expect(materialRun(material, changed).key).not.toBe(
      materialRun(material, commands).key,
    );
  });

  it("have the arguments of their function as fields", async () => {
    const { files } = await ran();
    const context: Context = { commands, keys: argumentFields(files) };
    const specs = fieldSpecs("material.script", { ...material }, context);
    const fields = specs.filter((s) => s.path[0] === "arguments");
    expect(
      fields.map((s) => [s.key, s.label, s.required, s.placeholder]),
    ).toEqual([
      ["arguments.mu", "mu", true, undefined],
      ["arguments.k", "k", false, "0.5"],
    ]);
    expect(fields[0].input).toMatchObject({
      type: "number",
      expressions: true,
    });
    expect(fields[1].hint).toBe(
      "An argument of strain_energy; empty: its default value",
    );
    // the function of the draft, and a value of an argument that it does not have
    const other = { ...material, function: "any", arguments: { c: 1 } };
    expect(
      fieldSpecs("material.script", other, context)
        .filter((s) => s.path[0] === "arguments")
        .map((s) => s.key),
    ).toEqual(["arguments.c"]);
    const unknown = { ...material, arguments: { mu: 1, c: 2 } };
    const [, , c] = fieldSpecs("material.script", unknown, context).filter(
      (s) => s.path[0] === "arguments",
    );
    expect(c.hint).toBe("strain_energy has no argument 'c': clear the field");
  });

  it("need a value of an argument without a default", async () => {
    const { files } = await ran();
    const context: Context = { commands, keys: argumentFields(files) };
    const draft = { ...material, arguments: { k: 1 } };
    expect(draftErrors("material.script", draft, context)).toHaveProperty(
      "arguments.mu",
    );
    // the values of the arguments are kept, an empty one is none
    const set = setValue(
      "material.script",
      draft,
      ["arguments", "mu"],
      "G",
      context,
    );
    expect(toCommand("material.script", set, context)).toMatchObject({
      arguments: { k: 1, mu: "G" },
    });
    const cleared = setValue(
      "material.script",
      draft,
      ["arguments", "k"],
      undefined,
      context,
    );
    expect(toCommand("material.script", cleared, context)).not.toHaveProperty(
      "arguments",
    );
  });

  it("keep the functions of a file whose material has an error", async () => {
    const { files } = await ran({
      file: "soft.py",
      functions: info.functions,
      error: "The function strain_energy of 'soft.py' needs a value of mu.",
    });
    expect(files.functionsOf("soft.py")).toEqual(info.functions);
    expect(files.functionsOf("other.py")).toBeUndefined();
    // without the run, the fields are those of the draft
    const context: Context = {
      commands,
      keys: argumentFields(new MeshFiles()),
    };
    expect(
      fieldSpecs("material.script", { ...material }, context)
        .filter((s) => s.path[0] === "arguments")
        .map((s) => s.key),
    ).toEqual(["arguments.mu"]);
  });
});

// a file of a strain-based function (#425), run before a job: its arguments after
// dε, εn, σn and ζn; its **kwargs take the keyword argument tangent
const steel: MaterialInfo = {
  file: "steel.py",
  functions: {
    material: {
      arguments: [{ name: "E" }, { name: "nu" }],
      tangent: true,
    },
  },
  type: "MaterialStrain(material)",
  statevars: 0,
};

const strain = {
  command: "material.script",
  name: "steel",
  kind: "strain",
  file: "steel.py",
  arguments: { E: 210000, nu: 0.3 },
} as const;

describe("strain-based functions of files (#425)", () => {
  async function files() {
    const result = new MeshFiles(undefined, {
      write: async () => {},
      inspect: async () => steel,
    });
    await result.add("steel.py", new Uint8Array([1]));
    const all: Command[] = [strain];
    const { key } = materialRun(strain, all);
    await result.inspectMaterial(key, "steel.py", {});
    return result;
  }

  it("have the arguments of their function as fields", async () => {
    const context: Context = {
      commands: [strain],
      keys: argumentFields(await files()),
    };
    const specs = fieldSpecs("material.script", { ...strain }, context);
    expect(
      specs
        .filter((s) => s.path[0] === "arguments")
        .map((s) => [s.key, s.required]),
    ).toEqual([
      ["arguments.E", true],
      ["arguments.nu", true],
    ]);
    // the function material by default, and the framework of the registry
    const byKey = Object.fromEntries(specs.map((s) => [s.key, s]));
    expect(byKey.function.placeholder).toBe("material");
    expect(byKey.framework.placeholder).toBe("small-strain");
    expect(byKey.statevars.input).toEqual({ type: "shapes" });
    // its **kwargs take tangent: a renamed argument stays a field to clear
    const renamed = { ...strain, arguments: { E: 1, nu: 0.3, Nu: 0.3 } };
    const [, , old] = fieldSpecs("material.script", renamed, context).filter(
      (s) => s.path[0] === "arguments",
    );
    expect(old.hint).toBe("material has no argument 'Nu': clear the field");
  });

  it("take the shapes of their state variables as a tuple of Python", () => {
    const context: Context = { commands: [strain] };
    const errors = (statevars: unknown) =>
      draftErrors("material.script", { ...strain, statevars }, context)
        .statevars;
    expect(errors([1, [3, 3]])).toBeUndefined();
    expect(errors([[3, 3]])).toBeUndefined();
    expect(errors([0])).toBeUndefined();
    for (const wrong of [[1, [3, 0]], [], [1.5], "(1, (3, 3)"])
      expect(errors(wrong)).toBe(
        "Enter a tuple of whole numbers, a number or the lengths of the axes per state variable, e.g. (1, (3, 3)).",
      );
  });
});

describe("the functions of files by default (#424, #425)", () => {
  it("are those of the schema", () => {
    const defs = schema.$defs as Record<string, Record<string, unknown>>;
    const kinds = (defs.MaterialScript.oneOf as { $ref: string }[]).map(
      (ref) =>
        defs[ref.$ref.split("/").at(-1)!].properties as Record<
          string,
          { const?: string; default?: string }
        >,
    );
    expect(FUNCTIONS).toEqual(
      Object.fromEntries(
        kinds
          .filter((p) => p.function)
          .map((p) => [p.kind.const, p.function.default]),
      ),
    );
  });
});
