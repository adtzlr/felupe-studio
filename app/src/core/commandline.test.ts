import { describe, expect, it } from "vitest";
import fixture from "../../../tests/data/two_sections.json";
import {
  accept,
  CommandLineError,
  complete,
  createCommand,
  parseLine,
  runLine,
} from "./commandline";
import type { CommandList } from "./commands";
import { ModelStore } from "./store";
import { validate } from "./validate";

const commands = (fixture as CommandList).commands;
const store = () => new ModelStore(fixture as CommandList);

describe("parseLine", () => {
  it("reads commands with and without JSON", () => {
    expect(
      parseLine(' material.add {"name": "rubber", "model": "NeoHooke"} '),
    ).toEqual({
      type: "create",
      command: "material.add",
      values: { name: "rubber", model: "NeoHooke" },
    });
    expect(parseLine('{"command": "mesh.import", "file": "a.vtu"}')).toEqual({
      type: "create",
      command: "mesh.import",
      values: { file: "a.vtu" },
    });
    expect(parseLine("section.add")).toEqual({
      type: "open",
      command: "section.add",
    });
    expect(parseLine("delete job_1")).toEqual({
      type: "delete",
      name: "job_1",
    });
    expect(parseLine("select  left")).toEqual({ type: "select", name: "left" });
    expect(parseLine("undo")).toEqual({ type: "undo" });
  });

  it.each([
    ["material.add {mu: 1}", "Invalid JSON"],
    ["material.add [1]", "Expected a JSON object"],
    ['material.add {"command": "mesh.import"}', 'Leave out "command"'],
    ['{"command": "mesh.delete"}', 'needs a "command"'],
    ["undo 2", "undo takes no arguments"],
    ["delete", "Usage: delete <name>"],
    ["delete a b", "Usage: delete <name>"],
    [
      "material.ad",
      "Unknown command 'material.ad'. Did you mean material.add?",
    ],
    ["xyz", "Unknown command 'xyz'. Type help"],
  ])("rejects %s", (line, message) => {
    expect(() => parseLine(line)).toThrow(CommandLineError);
    expect(() => parseLine(line)).toThrow(message);
  });
});

describe("createCommand", () => {
  const context = { commands };

  it("fills a suggested name and the defaults", async () => {
    const { command, errors } = await createCommand(
      "material.add",
      { model: "NeoHookeCompressible" },
      context,
    );
    expect(errors).toEqual([]);
    expect(command).toEqual({
      command: "material.add",
      name: "material_1",
      model: "NeoHookeCompressible",
      parameters: { mu: 1, lmbda: 2 },
    });
  });

  it.each<[string, Record<string, unknown>, string]>([
    [
      "material.add",
      { name: "hard" },
      "name: The name 'hard' is already used.",
    ],
    [
      "material.add",
      { parameters: { mu: -1 } },
      "parameters.mu: Must be greater than 0.",
    ],
    [
      "material.add",
      { parameters: { mu: "1" } },
      "parameters.mu: Enter a number",
    ],
    [
      "section.add",
      { cellset: "nothing" },
      "cellset: There is no cell set 'nothing'",
    ],
    [
      "boundary.add",
      { constrained: ["w"] },
      "constrained: Unknown value 'w'; choose from x, y, z.",
    ],
    [
      "boundary.add",
      { constrained: ["x", "x"] },
      "constrained: Each value may appear only once.",
    ],
    [
      "job.add",
      { steps: ["step_1", "step_1"] },
      "steps: Each object may appear only once.",
    ],
    [
      "material.add",
      { parameters: { mu: 1, E: 2 } },
      "Not part of material.add here: parameters.E.",
    ],
    [
      "section.add",
      { formulation: "u", bulk: 10 },
      "Not part of section.add here: bulk.",
    ],
    [
      "mesh.import",
      { file: "a.vtu", color: "red" },
      "Not part of mesh.import here: color.",
    ],
  ])("rejects %s %j", async (type, values, message) => {
    const { command, errors } = await createCommand(
      type as never,
      values,
      context,
    );
    expect(command).toBeUndefined();
    expect(errors.join(" ")).toContain(message);
  });
});

describe("runLine", () => {
  it("creates, selects, deletes, undoes and redoes", async () => {
    const s = store();
    let result = await runLine(
      'material.add {"name": "rubber", "model": "NeoHooke", "parameters": {"mu": 0.5, "bulk": 100}}',
      s,
    );
    expect(result).toEqual({
      ok: true,
      message: "Created rubber.",
      select: "rubber",
    });
    expect(s.get("rubber")).toMatchObject({
      parameters: { mu: 0.5, bulk: 100 },
    });
    expect(validate(s.commands)).toEqual([]);

    expect(await runLine("select left", s)).toMatchObject({
      ok: true,
      select: "left",
    });
    expect(await runLine("select nothing", s)).toMatchObject({ ok: false });

    result = await runLine("delete umat_hard", s);
    expect(result).toEqual({
      ok: false,
      message: "umat_hard is used by section_hard: delete these first.",
    });
    expect(await runLine("delete rubber", s)).toMatchObject({ ok: true });
    expect(s.get("rubber")).toBeUndefined();
    expect(await runLine("undo", s)).toMatchObject({ ok: true });
    expect(s.get("rubber")).toBeDefined();
    expect(await runLine("redo", s)).toMatchObject({ ok: true });
    expect(await runLine("redo", s)).toEqual({
      ok: false,
      message: "Nothing to redo.",
    });
  });

  it("opens the dialog, shows help and reports errors", async () => {
    const s = store();
    expect(await runLine("section.add", s)).toMatchObject({
      ok: true,
      open: "section.add",
    });
    expect((await runLine("help", s)).message).toContain("delete <name>");
    const failed = await runLine('boundary.add {"pointset": "nowhere"}', s);
    expect(failed.ok).toBe(false);
    expect(failed.message).toContain(
      "Not created: pointset: There is no point set 'nowhere'",
    );
    expect(s.commands).toHaveLength(13);
  });
});

describe("complete", () => {
  const labels = (line: string) =>
    complete(line, commands).items.map((i) => i.label);

  it("completes commands and keywords", () => {
    expect(labels("mat")).toEqual(["material.add"]);
    expect(labels("cell")).toEqual(["cellset.from_tag", "cellset.from_file"]);
    expect(labels("de")).toEqual(["delete", "model.settings"]); // contained
    expect(labels("tag")).toEqual(["cellset.from_tag"]); // contained
    expect(labels("undo")).toEqual([]); // complete already
    expect(labels("")).toHaveLength(23);
    expect(labels("param")).toEqual(["parameter.add"]);
  });

  it("completes names after delete and select", () => {
    expect(labels("delete sec")).toEqual(["section_hard", "section_soft"]);
    expect(labels("select umat_s")).toEqual(["umat_soft"]);
  });

  it("offers templates with the defaults, one per material model", () => {
    const items = complete("material.add ", commands).items;
    expect(items.map((i) => i.detail)).toEqual([
      "Neo-Hooke",
      "Neo-Hooke (compressible)",
      "Mooney-Rivlin",
      "Yeoh",
      "Third-order deformation",
      "Ogden",
      "Arruda-Boyce",
      "Extended tube",
      "Linear elastic (large strain)",
    ]);
    // lists of values in the template of Ogden (#136)
    expect(items[5].value).toBe(
      '{"name":"material_1","model":"Ogden","parameters":{"mu":[1,0.2],"alpha":[1.7,-1.5]}}',
    );
    expect(items[0].value).toBe(
      '{"name":"material_1","model":"NeoHooke","parameters":{"mu":1}}',
    );
    expect(labels("job.add ")).toEqual([
      '{"name":"job_1","steps":["step_1"]}'.replace("job_1", "job_2"),
    ]);
  });

  it("accepts a suggestion", async () => {
    let line = "mat";
    line = accept(
      line,
      complete(line, commands),
      complete(line, commands).items[0],
    );
    expect(line).toBe("material.add ");
    const completion = complete(line, commands);
    line = accept(line, completion, completion.items[8]);
    expect(line).toBe(
      'material.add {"name":"material_1","model":"LinearElasticLargeStrain","parameters":{"E":1,"nu":0.3}}',
    );
    const s = store();
    expect(await runLine(line, s)).toMatchObject({
      ok: true,
      select: "material_1",
    });
  });
});
