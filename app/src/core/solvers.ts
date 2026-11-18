// The linear solver of a job (#203): SuperLU of FElupe (the default), spsolve of
// SciPy or an iterative method of SciPy, like felupe_studio.codegen.solver_source().
import type { Command } from "./commands";
import type { Command as ResolvedCommand } from "./resolved";

type Job = Extract<Command, { command: "job.add" }>;
type ResolvedJob = Extract<ResolvedCommand, { command: "job.add" }>;

/** The default tolerance of a job (#176), like `TOL` of the code generator. */
export const TOL = 0.01;

/**
 * The relative tolerance of the iterative solver of a job: its `rtol`, else two
 * orders of magnitude finer than the tolerance of the job (six digits), like
 * `solver_rtol()` in Python.
 */
export function solverRtol(job: ResolvedJob): number {
  if (job.solver?.rtol !== undefined) return job.solver.rtol;
  return Number(((job.tol ?? TOL) / 100).toPrecision(6));
}

/** A number in short exponential notation, e.g. 1e-4 or 1.49e-10. */
const exponential = (value: number) => value.toExponential().replace("e+", "e");

/**
 * A short description of the linear solver of a job, e.g. `minres, rtol 1e-4`
 * (undefined without a solver: the default of FElupe); an expression of the
 * parameters as written (#242).
 */
export function describeSolver(job: Job): string | undefined {
  const solver = job.solver;
  if (!solver) return undefined;
  if (solver.type === "superlu") return "SuperLU";
  if (solver.type === "spsolve") return "spsolve";
  const rtol =
    typeof solver.rtol === "string"
      ? solver.rtol
      : typeof job.tol === "string" && solver.rtol === undefined
        ? `(${job.tol}) / 100`
        : exponential(solverRtol(job as ResolvedJob));
  return [
    solver.method ?? "minres",
    `rtol ${rtol}`,
    solver.maxiter !== undefined && `maxiter ${solver.maxiter}`,
  ]
    .filter(Boolean)
    .join(", ");
}
