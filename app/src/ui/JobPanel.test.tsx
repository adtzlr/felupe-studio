// @vitest-environment happy-dom
import { cleanup, render, screen } from "@testing-library/preact";
import { afterEach, describe, expect, it } from "vitest";
import fixture from "../../../tests/data/two_sections.json";
import type { Command, CommandList } from "../core/commands";
import { type JobProgress, startProgress } from "../core/jobs";
import { ModelStore } from "../core/store";
import { JobPanel } from "./JobPanel";

afterEach(cleanup);

const commands = (fixture as CommandList).commands;

/** The lines of the panel of a running job. */
function lines(
  progress: Partial<JobProgress>,
  job: { cutback?: object; maxiter?: number; solver?: object } = {},
) {
  const run = {
    state: "running" as const,
    progress: { ...startProgress(), ...progress },
    commands: commands.map((c) =>
      c.command === "job.add" ? { ...c, ...job } : c,
    ) as Command[],
    live: { jobs: {} },
  };
  render(
    <JobPanel
      run={run}
      store={new ModelStore(fixture as CommandList)}
      onDismiss={() => {}}
    />,
  );
  const panel = screen.getByRole("region", { name: "Job" });
  const texts = [...panel.querySelectorAll(".job-line")].map(
    (line) => line.textContent,
  );
  cleanup();
  return texts;
}

describe("the panel of a running job", () => {
  const substep = {
    jobs: ["job_1"],
    job: "job_1",
    step: 1,
    steps: 1,
    substep: 3,
    substeps: 4,
  };

  it("has the same lines before, during and between the iterations", () => {
    expect(lines({})).toEqual(["Preparing the model …", " "]);
    expect(lines(substep)).toEqual(["Step 1 of 1 · substep 3 of 4", " "]);
    expect(lines({ ...substep, iteration: 2, fnorm: 1.5e-7 })).toEqual([
      "Step 1 of 1 · substep 3 of 4",
      "Newton iteration 2 of 16 · residuals 1.50e-7",
    ]);
    // the maximum iterations of the job (#133)
    expect(
      lines({ ...substep, iteration: 2, fnorm: null }, { maxiter: 30 }),
    ).toEqual(["Step 1 of 1 · substep 3 of 4", "Newton iteration 2 of 30"]);
    // the linear solver of the job, if it is not the default (#203)
    expect(
      lines(
        { ...substep, iteration: 1, fnorm: 0.5 },
        { solver: { type: "iterative", method: "cg" } },
      ),
    ).toEqual([
      "Step 1 of 1 · substep 3 of 4",
      "Newton iteration 1 of 16 · residuals 5.00e-1 · cg, rtol 1e-4",
    ]);
  });

  it("has a line for the retries of a cutback from the start", () => {
    expect(lines({}, { cutback: {} })).toEqual([
      "Preparing the model …",
      " ",
      "Cutback: no retries",
    ]);
    expect(
      lines(
        { ...substep, failed: ["Step 1, substep 3: NewtonConvergenceError"] },
        { cutback: { factor: 0.25 } },
      ),
    ).toEqual([
      "Step 1 of 1 · substep 3 of 4",
      " ",
      "Cutback: 1 attempt retried with smaller increments",
    ]);
  });
});
