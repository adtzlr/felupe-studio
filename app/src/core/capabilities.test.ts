import { describe, expect, it } from "vitest";
import { type Capabilities, capabilityIssues } from "./capabilities";
import type { Command } from "./resolved";

type Job = Extract<Command, { command: "job.add" }>;

const job = (solver?: Job["solver"]): Job => ({
  command: "job.add",
  name: "job_1",
  steps: ["step_1"],
  ...(solver ? { solver } : {}),
});

const settings = (precision: "single" | "double"): Command => ({
  command: "model.settings",
  name: "settings",
  precision,
});

const browser: Capabilities = { runtime: "pyodide" };
const python: Capabilities = { runtime: "python" };
const pardiso = (single: boolean): Capabilities => ({
  runtime: "python",
  pardiso: { version: "0.4.7", single },
});

describe("the linear solvers of the runtime (#308)", () => {
  it("are no issues before the runtime is ready, or of other solvers", () => {
    expect(capabilityIssues([job({ type: "pardiso" })], undefined)).toEqual([]);
    expect(
      capabilityIssues([job(), job({ type: "spsolve" })], browser),
    ).toEqual([]);
  });

  it("need Python on the computer for PARDISO, like Python", () => {
    expect(
      capabilityIssues([settings("double"), job({ type: "pardiso" })], browser),
    ).toEqual([
      {
        index: 1,
        name: "job_1",
        message:
          "commands/1: PARDISO needs Python on your computer (felupe-studio serve): Intel oneMKL has no build for the browser.",
        field: "solver.type",
      },
    ]);
    expect(
      capabilityIssues([job({ type: "pardiso" })], python)[0].message,
    ).toBe(
      "commands/0: PARDISO needs the package pypardiso: pip install pypardiso.",
    );
    expect(
      capabilityIssues([job({ type: "pardiso" })], pardiso(false)),
    ).toEqual([]);
  });

  it("need a PyPardiso in float32 for single precision", () => {
    const single = job({ type: "pardiso", precision: "single" });
    expect(capabilityIssues([single], pardiso(false))).toEqual([
      {
        index: 0,
        name: "job_1",
        message:
          "commands/0: PyPardiso 0.4.7 solves only in double precision: choose double precision, or install a PyPardiso that factorizes in float32 (e.g. adtzlr/PyPardiso).",
        field: "solver.precision",
      },
    ]);
    // a model in single precision (#297): the matrix is in float32 anyway
    const model = [settings("single"), job({ type: "pardiso" })];
    expect(capabilityIssues(model, pardiso(false))[0].field).toBe(
      "solver.type",
    );
    expect(capabilityIssues([single], pardiso(true))).toEqual([]);
    expect(capabilityIssues(model, pardiso(true))).toEqual([]);
  });
});
