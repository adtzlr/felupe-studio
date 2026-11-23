import { describe, expect, it } from "vitest";
import type { Command } from "./resolved";
import { startProgress } from "./jobs";
import {
  advance,
  curvePoint,
  type Direction,
  type Finished,
  formatValue,
  nextSubstep,
  quantityGroups,
  resultModel,
  stepOf,
  substepsAhead,
  substepsOf,
  viewOf,
} from "./results";

const commands = [
  { command: "job.add", name: "job_1", steps: ["load", "unload"] },
] as unknown as Command[];

const run: Finished = {
  state: "finished",
  commands,
  progress: { ...startProgress(), plan: { job_1: [3, 2] } },
  results: {
    job_1: {
      substeps: 5,
      time: 1,
      x: [
        [0, 0, 0],
        [0.1, 0.01, 0],
        [0.2, 0.02, 0],
        [0.1, 0.01, 0],
        [-0.3, 0, 0],
      ],
      y: [
        [0, 0, 0],
        [1, 0, 0],
        [2, 0, 0],
        [1, 0, 0],
        [null, 0, 0],
      ],
    },
    job_2: { substeps: 2, time: 1 },
  },
};

const units = { length: "mm", force: "N" } as const;

/** The results of a file (#414). */
const imported: Finished = {
  state: "finished",
  commands: [],
  progress: { ...startProgress(), jobs: ["bushing-radial"] },
  results: { "bushing-radial": { substeps: 4, time: 0 } },
  imported: {
    file: "bushing-radial.xdmf",
    job: "bushing-radial",
    substeps: 4,
    sections: ["rubber", "sleeve"],
    planar: false,
    units,
    quantities: ["displacement", "plastic_strain"],
  },
};

describe("results view", () => {
  it("starts at the last substep and keeps the choices", () => {
    expect(viewOf(run, undefined)).toEqual({
      job: "job_1",
      substep: 5,
      quantity: "displacement",
      scale: 1,
      undeformed: true,
      curve: true,
    });
    const previous = {
      job: "job_2",
      substep: 1,
      quantity: "stress_mises" as const,
      scale: 5,
      undeformed: false,
      curve: false,
      axis: 1,
    };
    expect(viewOf(run, previous)).toEqual({ ...previous, substep: 2 });
    expect(viewOf(run, { ...previous, job: "gone" }).job).toBe("job_1");
    // the choices of a first view, e.g. without the curve on a phone (#378)
    expect(viewOf(run, { curve: false })).toEqual({
      job: "job_1",
      substep: 5,
      quantity: "displacement",
      scale: 1,
      undeformed: true,
      curve: false,
    });
    // the sections of the range of the contour (#377): a removed or renamed
    // section leaves them, none left is all sections
    const sections = [
      ...commands,
      { command: "section.add", name: "rubber" },
      { command: "section.add", name: "steel" },
    ] as unknown as Command[];
    const solved = { ...run, commands: sections };
    const chosen = { ...previous, rangeSections: ["glass", "rubber"] };
    expect(viewOf(solved, chosen).rangeSections).toEqual(["rubber"]);
    expect(
      viewOf(solved, { ...previous, rangeSections: ["glass"] }),
    ).not.toHaveProperty("rangeSections");
    expect(substepsOf(run, "job_2")).toBe(2);
    expect(substepsOf(run, "gone")).toBe(0);
  });

  it("shows a quantity of the results only (#414)", () => {
    // e.g. the equivalent plastic strain of a model without plasticity
    const previous = { quantity: "plastic_strain" as const, scale: 5 };
    expect(viewOf(run, previous)).toMatchObject({
      quantity: "displacement",
      scale: 5,
    });
    expect(viewOf(imported, previous).quantity).toBe("plastic_strain");
    expect(
      viewOf(imported, { quantity: "stress_max", rangeSections: ["steel"] }),
    ).toMatchObject({
      job: "bushing-radial",
      substep: 4,
      quantity: "displacement",
    });
    expect(
      viewOf(imported, { rangeSections: ["steel", "sleeve"] }).rangeSections,
    ).toEqual(["sleeve"]);
  });

  it("finds the step of a substep", () => {
    expect(stepOf(run, "job_1", 1)).toEqual({
      name: "load",
      step: 1,
      substep: 1,
      substeps: 3,
    });
    expect(stepOf(run, "job_1", 3)).toMatchObject({ name: "load", substep: 3 });
    expect(stepOf(run, "job_1", 4)).toEqual({
      name: "unload",
      step: 2,
      substep: 1,
      substeps: 2,
    });
    expect(stepOf(run, "job_2", 2)).toMatchObject({ name: "", substep: 2 });
  });

  it("finds a repeated step by its position (#331)", () => {
    const cycle: Finished = {
      ...run,
      commands: [
        {
          command: "job.add",
          name: "job_1",
          steps: ["load", "unload", "load"],
        },
      ] as unknown as Command[],
      progress: { ...startProgress(), plan: { job_1: [2, 2, 2] } },
    };
    expect(stepOf(cycle, "job_1", 2)).toMatchObject({ name: "load", step: 1 });
    expect(stepOf(cycle, "job_1", 3)).toMatchObject({
      name: "unload",
      step: 2,
    });
    expect(stepOf(cycle, "job_1", 6)).toEqual({
      name: "load",
      step: 3,
      substep: 2,
      substeps: 2,
    });
  });

  it("takes the curve along the axis of the largest last displacement", () => {
    const result = run.results.job_1;
    expect(curvePoint(result, 3)).toEqual({ axis: "x", u: 0.2, f: 2 });
    expect(curvePoint(result, 3, 1)).toEqual({ axis: "y", u: 0.02, f: 0 });
    // non-finite values are null
    expect(curvePoint(result)).toBeUndefined();
    expect(curvePoint(run.results.job_2)).toBeUndefined();
  });

  it("formats values", () => {
    expect(formatValue(0.123456)).toBe("0.1235");
    expect(formatValue(12345.6)).toBe("1.235e+4");
    expect(formatValue(0.0001234)).toBe("1.234e-4");
    expect(formatValue(0)).toBe("0");
  });
});

describe("the substeps ahead (#141)", () => {
  it("loop after the last substep", () => {
    expect(nextSubstep(2, 5)).toBe(3);
    expect(nextSubstep(5, 5)).toBe(1);
    expect(substepsAhead(3, 5, 4)).toEqual([4, 5, 1, 2]);
    // never the substep itself
    expect(substepsAhead(2, 3, 4)).toEqual([3, 1]);
    expect(substepsAhead(1, 1, 4)).toEqual([]);
  });

  it("go back and forth", () => {
    // forward, turn at the last substep, backward, turn at the first one
    const played: number[] = [];
    let state: [number, Direction] = [1, 1];
    for (let i = 0; i < 9; i++) {
      state = advance(state[0], 4, "bounce", state[1]);
      played.push(state[0]);
    }
    expect(played).toEqual([2, 3, 4, 3, 2, 1, 2, 3, 4]);
    // from the last substep backward, also from a substep beyond the ends
    expect(advance(5, 5, "bounce", 1)).toEqual([4, -1]);
    expect(advance(7, 5, "bounce", 1)).toEqual([6, -1]);
    expect(advance(1, 5, "bounce", -1)).toEqual([2, 1]);
    expect(advance(3, 5, "bounce", -1)).toEqual([2, -1]);
    // a single substep stays
    expect(advance(1, 1, "bounce", 1)).toEqual([1, 1]);
    // looping is always forward
    expect(advance(5, 5, "loop", -1)).toEqual([1, 1]);
    // the substeps ahead in the order of playing, each once
    expect(substepsAhead(3, 5, 4, "bounce", 1)).toEqual([4, 5]);
    expect(substepsAhead(4, 5, 4, "bounce", -1)).toEqual([3, 2, 1]);
    expect(substepsAhead(2, 2, 4, "bounce", 1)).toEqual([1]);
  });
});

describe("what the results have of their model", () => {
  it("of a run: of its commands", () => {
    const commands = [
      { command: "model.settings", analysis: "plane-strain", units },
      { command: "section.add", name: "rubber" },
    ] as unknown as Command[];
    const model = resultModel({ ...run, commands });
    expect(model).toMatchObject({ sections: ["rubber"], planar: true, units });
    expect(model.groups).toEqual(quantityGroups(commands));
  });

  it("of a file: of the file (#414)", () => {
    expect(resultModel(imported)).toEqual({
      sections: ["rubber", "sleeve"],
      planar: false,
      units,
      groups: [
        {
          label: "Displacement",
          options: [{ id: "displacement", label: "Displacement (magnitude)" }],
        },
        {
          label: "Plasticity",
          options: [
            { id: "plastic_strain", label: "Equivalent plastic strain" },
          ],
        },
      ],
    });
    const file = { ...imported.imported!, units: null };
    expect(resultModel({ ...imported, imported: file }).units).toBeUndefined();
  });
});

describe("quantities of the contour", () => {
  const ids = (commands: Command[]) =>
    quantityGroups(commands).flatMap((g) => g.options.map((o) => o.id));

  it("has no displacement in z in a 2D model (#175)", () => {
    expect(ids([])).toContain("displacement_z");
    const settings = (analysis: string) =>
      [{ command: "model.settings", analysis }] as Command[];
    expect(ids(settings("3d"))).toContain("displacement_z");
    expect(ids(settings("axisymmetric"))).not.toContain("displacement_z");
    expect(ids(settings("plane-strain"))).toEqual(
      ids([]).filter((id) => id !== "displacement_z"),
    );
  });

  it("has the equivalent plastic strain with plasticity (#191)", () => {
    const material = (model: string) =>
      [
        { command: "material.add", name: "m", model, parameters: {} },
      ] as unknown as Command[];
    expect(ids([])).not.toContain("plastic_strain");
    expect(ids(material("LinearElastic"))).not.toContain("plastic_strain");
    expect(ids(material("LinearElasticPlasticIsotropicHardening")).at(-1)).toBe(
      "plastic_strain",
    );
  });

  it("has the maximum strain energy density with the Mullins effect (#346)", () => {
    const material = (extra: object) =>
      [
        {
          command: "material.add",
          name: "m",
          model: "NeoHooke",
          parameters: { mu: 1 },
          ...extra,
        },
      ] as unknown as Command[];
    expect(ids(material({}))).not.toContain("mullins_energy");
    const mullins = { mullins: { r: 3, m: 0.2, beta: 0.1 } };
    expect(ids(material(mullins)).at(-1)).toBe("mullins_energy");
    expect(ids(material(mullins))).not.toContain("plastic_strain");
    const groups = quantityGroups(material(mullins)).map((g) => g.label);
    expect(groups.at(-1)).toBe("Mullins effect");
  });
});
