import { describe, expect, it } from "vitest";
import type { Command } from "./resolved";
import { describeSolver, roundoffNote, solverRtol } from "./solvers";

type Job = Extract<Command, { command: "job.add" }>;

const job = (extra: Partial<Job>): Job => ({
  command: "job.add",
  name: "job_1",
  steps: ["step_1"],
  ...extra,
});

describe("the linear solver of a job (#203)", () => {
  it("has a relative tolerance from the tolerance of the job, like Python", () => {
    const iterative = { type: "iterative", method: "minres" } as const;
    expect(solverRtol(job({ solver: iterative }))).toBe(1e-4);
    expect(solverRtol(job({ tol: 1.49e-8, solver: iterative }))).toBe(1.49e-10);
    expect(solverRtol(job({ tol: 0.03, solver: iterative }))).toBe(3e-4);
    expect(solverRtol(job({ solver: { ...iterative, rtol: 1e-6 } }))).toBe(
      1e-6,
    );
  });

  it("is described shortly", () => {
    expect(describeSolver(job({}))).toBeUndefined();
    expect(describeSolver(job({ solver: { type: "superlu" } }))).toBe(
      "SuperLU",
    );
    expect(describeSolver(job({ solver: { type: "spsolve" } }))).toBe(
      "spsolve",
    );
    // the linear equation system in single precision (ADR 0016)
    expect(
      describeSolver(job({ solver: { type: "superlu", precision: "single" } })),
    ).toBe("SuperLU, single precision");
    expect(
      describeSolver(job({ solver: { type: "spsolve", precision: "single" } })),
    ).toBe("spsolve, single precision");
    expect(
      describeSolver(job({ solver: { type: "superlu", precision: "double" } })),
    ).toBe("SuperLU");
    expect(
      describeSolver(
        job({
          tol: 1.49e-8,
          solver: { type: "iterative", method: "gmres", maxiter: 200 },
        }),
      ),
    ).toBe("gmres, rtol 1.49e-10, maxiter 200");
  });
});

describe("roundoffNote", () => {
  it("is none of a model in double precision", () => {
    expect(roundoffNote(undefined)).toBeUndefined();
  });

  it("says the estimate of a model in single precision (#297)", () => {
    expect(roundoffNote(null)).toEqual({
      text: "Single precision (no reaction forces)",
      warning: false,
    });
    expect(roundoffNote(0.0065043)).toEqual({
      text: "Single precision: round-off 0.65 % of the reaction forces",
      warning: false,
    });
    expect(roundoffNote(1e-7)?.text).toBe(
      "Single precision: round-off < 0.01 % of the reaction forces",
    );
  });

  it("warns from 1e-2 on, e.g. steel bonded to rubber", () => {
    expect(roundoffNote(0.4267)).toEqual({
      text:
        "Single precision: the round-off of the forces may be 43 % of the " +
        "reaction forces. Check the results in double precision (Model settings).",
      warning: true,
    });
  });
});
