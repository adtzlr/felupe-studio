// The linear solver of a job (#203): SuperLU of FElupe (the default), spsolve of
// SciPy, PARDISO of Intel oneMKL in Python on the computer (#308), all three also in
// single precision (ADR 0016), or an iterative method of SciPy, like
// felupe_studio.codegen.solver_source().
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
 * A short description of the linear solver of a job, e.g. `minres, rtol 1e-4` or
 * `SuperLU, single precision`
 * (undefined without a solver: the default of FElupe); an expression of the
 * parameters as written (#242).
 */
export function describeSolver(job: Job): string | undefined {
  const solver = job.solver;
  if (!solver) return undefined;
  // the linear equation system in single precision (ADR 0016)
  const single = solver.precision === "single" ? ", single precision" : "";
  if (solver.type === "superlu") return `SuperLU${single}`;
  if (solver.type === "spsolve") return `spsolve${single}`;
  if (solver.type === "pardiso") return `PARDISO${single}`;
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

/**
 * The estimate of the round-off of the forces of a model in single precision
 * (#297), relative to the reaction forces, of `felupe_studio.runner.RoundOff`: the
 * curves deviate from double precision by about a tenth of it. From 1e-2 on, the
 * job panel warns.
 */
export const ROUNDOFF_WARNING = 1e-2;

/** The note of the round-off of a job of a model in single precision (#297). */
export function roundoffNote(
  estimate: number | null | undefined,
): { text: string; warning: boolean } | undefined {
  if (estimate === undefined) return undefined;
  if (estimate === null)
    return { text: "Single precision (no reaction forces)", warning: false };
  const percent = estimate * 100;
  const value =
    percent < 0.01 ? "< 0.01" : Number(percent.toPrecision(2)).toString();
  if (estimate < ROUNDOFF_WARNING)
    return {
      text: `Single precision: round-off ${value} % of the reaction forces`,
      warning: false,
    };
  return {
    text:
      `Single precision: the round-off of the forces may be ${value} % of the ` +
      "reaction forces. Check the results in double precision (Model settings).",
    warning: true,
  };
}
