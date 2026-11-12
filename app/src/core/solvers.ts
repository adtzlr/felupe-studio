// The linear solver of a job (#203): SuperLU of FElupe (the default), spsolve of
// SciPy or an iterative method of SciPy, like felupe_studio.codegen.solver_source().
import type { Command } from "./commands";

type Job = Extract<Command, { command: "job.add" }>;

/** The default tolerance of a job (#176), like `TOL` of the code generator. */
export const TOL = 0.01;

/**
 * The relative tolerance of the iterative solver of a job: its `rtol`, else two
 * orders of magnitude finer than the tolerance of the job (six digits), like
 * `solver_rtol()` in Python.
 */
export function solverRtol(job: Job): number {
  if (job.solver?.rtol !== undefined) return job.solver.rtol;
  return Number(((job.tol ?? TOL) / 100).toPrecision(6));
}

/** A number in short exponential notation, e.g. 1e-4 or 1.49e-10. */
const exponential = (value: number) => value.toExponential().replace("e+", "e");

/**
 * A short description of the linear solver of a job, e.g. `minres, rtol 1e-4`
 * (undefined without a solver: the default of FElupe).
 */
export function describeSolver(job: Job): string | undefined {
  const solver = job.solver;
  if (!solver) return undefined;
  if (solver.type === "superlu") return "SuperLU";
  if (solver.type === "spsolve") return "spsolve";
  return [
    solver.method ?? "minres",
    `rtol ${exponential(solverRtol(job))}`,
    solver.maxiter !== undefined && `maxiter ${solver.maxiter}`,
  ]
    .filter(Boolean)
    .join(", ");
}
