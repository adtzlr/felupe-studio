// The linear solvers that not every runtime has (#308): PARDISO of Intel oneMKL
// (the package pypardiso) runs only in Python on the computer (felupe-studio serve),
// because MKL has no build for WebAssembly (Pyodide). Like
// felupe_studio.capabilities: the issues are of the runtime, not of the model, which
// stays the same in every runtime.
import type { Issue } from "./rules";
import type { Command as ResolvedCommand } from "./resolved";

/** What the runtime has, from its `ready` message (`capabilities()` in Python). */
export interface Capabilities {
  /** Pyodide in the browser, or Python of `felupe-studio serve`. */
  runtime: "pyodide" | "python";
  /** PyPardiso, if installed: its version and whether it solves in float32. */
  pardiso?: { version: string; single: boolean };
}

type Job = Extract<ResolvedCommand, { command: "job.add" }>;

/**
 * Whether the linear equation system of a job is in single precision: of its
 * solver (ADR 0016), or of the model (#297).
 */
function singlePrecision(job: Job, commands: readonly ResolvedCommand[]) {
  const model = commands.some(
    (c) => c.command === "model.settings" && c.precision === "single",
  );
  return model || job.solver?.precision === "single";
}

/** The problem of a job with PARDISO in a runtime, like Python. */
function pardisoProblem(
  job: Job,
  commands: readonly ResolvedCommand[],
  available: Capabilities,
): Pick<Issue, "message" | "field"> | undefined {
  const { pardiso } = available;
  if (!pardiso && available.runtime === "pyodide")
    return {
      message:
        "PARDISO needs Python on your computer (felupe-studio serve): Intel oneMKL has no build for the browser.",
      field: "solver.type",
    };
  if (!pardiso)
    return {
      message: "PARDISO needs the package pypardiso: pip install pypardiso.",
      field: "solver.type",
    };
  if (pardiso.single || !singlePrecision(job, commands)) return undefined;
  return {
    message:
      `PyPardiso ${pardiso.version} solves only in double precision: choose ` +
      "double precision, or install a PyPardiso that factorizes in float32 (e.g. adtzlr/PyPardiso).",
    field:
      job.solver?.precision === "single" ? "solver.precision" : "solver.type",
  };
}

/**
 * The issues of the jobs whose linear solver the runtime does not have, like
 * `capability_issues()` in Python; none before the runtime is ready. The store
 * shows them for a model without errors, like the MCP server.
 */
export function capabilityIssues(
  commands: readonly ResolvedCommand[],
  available: Capabilities | undefined,
): Issue[] {
  if (!available) return [];
  return commands.flatMap((job, index) => {
    if (job.command !== "job.add" || job.solver?.type !== "pardiso") return [];
    const problem = pardisoProblem(job, commands, available);
    if (!problem) return [];
    const { message, field } = problem;
    return [
      {
        index,
        name: job.name,
        message: `commands/${index}: ${message}`,
        field,
      },
    ];
  });
}
