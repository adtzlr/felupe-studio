import { describe, expect, it } from "vitest";
import type { Command } from "./commands";
import { describeSolver, solverRtol } from "./solvers";

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
