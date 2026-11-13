// The view of the results of the last finished run (#28): the job, its substep, the
// quantity of the contour, the scale of the deformation and the undeformed ghost.
import type { JobResult, Quantity } from "../worker/protocol";
import { analysisOf, is2d } from "./analysis";
import type { Command } from "./commands";
import type { JobRun } from "./jobs";
import type { Series } from "./curve";

/** The quantities of the contour, in groups. */
export const QUANTITY_GROUPS: {
  label: string;
  options: { id: Quantity; label: string }[];
}[] = [
  {
    label: "Displacement",
    options: [
      { id: "displacement", label: "Displacement (magnitude)" },
      { id: "displacement_x", label: "Displacement x" },
      { id: "displacement_y", label: "Displacement y" },
      { id: "displacement_z", label: "Displacement z" },
    ],
  },
  {
    label: "Logarithmic strain",
    options: [
      { id: "strain_max", label: "Max. principal strain" },
      { id: "strain_mid", label: "Mid. principal strain" },
      { id: "strain_min", label: "Min. principal strain" },
    ],
  },
  {
    label: "Cauchy stress",
    options: [
      { id: "stress_max", label: "Max. principal stress" },
      { id: "stress_mid", label: "Mid. principal stress" },
      { id: "stress_min", label: "Min. principal stress" },
      { id: "stress_mises", label: "Von Mises stress" },
    ],
  },
];

/** The quantities of the contour of a model: no displacement in z in 2D (#175). */
export function quantityGroups(
  commands: readonly Command[],
): typeof QUANTITY_GROUPS {
  if (!is2d(analysisOf(commands))) return QUANTITY_GROUPS;
  return QUANTITY_GROUPS.map((group) => ({
    ...group,
    options: group.options.filter((o) => o.id !== "displacement_z"),
  }));
}

export interface ResultView {
  job: string;
  /** The substep, counted from 1 over all steps of the job. */
  substep: number;
  quantity: Quantity;
  /** The scale of the displacements of the deformed shape. */
  scale: number;
  /** Show the undeformed shape as a transparent ghost. */
  undeformed: boolean;
  /** Show the force-displacement curve (of a job with a curve boundary). */
  curve: boolean;
  /**
   * The quantities of the axes of the curve (#197), by default the force over the
   * displacement of the component with the largest displacement.
   */
  curveX?: Series;
  curveY?: Series;
}

export type Finished = Extract<JobRun, { state: "finished" }>;

/** The number of substeps of a job of a finished run. */
export const substepsOf = (run: Finished, job: string): number =>
  run.results[job]?.substeps ?? 0;

/** The substep after a substep of a job with a number of substeps, looping (#141). */
export const nextSubstep = (substep: number, total: number): number =>
  substep >= total ? 1 : substep + 1;

/** The next substeps after a substep (looping, without itself), e.g. to load ahead. */
export function substepsAhead(
  substep: number,
  total: number,
  count: number,
): number[] {
  const ahead: number[] = [];
  for (let s = substep, i = 0; i < Math.min(count, total - 1); i++) {
    s = nextSubstep(s, total);
    ahead.push(s);
  }
  return ahead;
}

/**
 * The view of a finished run: the choices of a previous view are kept, the substep
 * is the last one of the job (the final state).
 */
export function viewOf(
  run: Finished,
  previous: ResultView | undefined,
): ResultView {
  const jobs = Object.keys(run.results);
  const job =
    previous && jobs.includes(previous.job) ? previous.job : (jobs[0] ?? "");
  return {
    quantity: "displacement",
    scale: 1,
    undeformed: true,
    curve: true,
    ...previous,
    job,
    substep: substepsOf(run, job),
  };
}

/** The step (its name, counted from 1) and the substep in the step of a substep. */
export function stepOf(
  run: Finished,
  job: string,
  substep: number,
): { name: string; step: number; substep: number; substeps: number } {
  const plan = run.progress.plan[job] ?? [];
  const command = run.commands.find(
    (c): c is Extract<Command, { command: "job.add" }> =>
      c.command === "job.add" && c.name === job,
  );
  let rest = substep;
  for (let i = 0; i < plan.length; i++) {
    if (rest <= plan[i] || i === plan.length - 1) {
      return {
        name: command?.steps[i] ?? `step ${i + 1}`,
        step: i + 1,
        substep: rest,
        substeps: plan[i],
      };
    }
    rest -= plan[i];
  }
  return { name: "", step: 1, substep, substeps: substep };
}

/**
 * The component with the largest displacement of the last substep of a curve; of
 * equal displacements the one with the largest force, e.g. the axial force of a
 * spring that is compressed and then sheared by as much.
 */
export function largestAxis(result: JobResult): number {
  const last = result.x?.at(-1) ?? [];
  const force = result.y?.at(-1) ?? [];
  const size = (row: readonly (number | null)[], i: number) =>
    Math.abs(row[i] ?? 0);
  let axis = 0;
  last.forEach((_, i) => {
    const [u, best] = [size(last, i), size(last, axis)];
    const tie = Math.abs(u - best) <= 1e-9 * Math.max(u, best);
    if (tie ? size(force, i) > size(force, axis) : u > best) axis = i;
  });
  return axis;
}

/**
 * The displacement and the force of a characteristic curve at a substep (counted
 * from 1; the last one by default), of a component (by default the one with the
 * largest displacement of the last substep).
 */
export function curvePoint(
  result: JobResult,
  substep?: number,
  axis = largestAxis(result),
) {
  const index = (substep ?? result.x?.length ?? 0) - 1;
  const x = result.x?.[index];
  const y = result.y?.[index];
  if (!x || !y) return undefined;
  const [u, f] = [x[axis], y[axis]];
  if (u === null || f === null) return undefined;
  return { axis: "xyz"[axis] ?? String(axis), u, f };
}

/** A number for labels: four significant digits, exponential if very large or small. */
export const formatValue = (value: number) =>
  Math.abs(value) >= 1e4 || (value !== 0 && Math.abs(value) < 1e-3)
    ? value.toExponential(3)
    : String(Number(value.toPrecision(4)));
