// The directions of the constraints in local coordinates, like
// felupe_studio.directions: of a Cartesian constraint (#421) the base vectors 1, 2
// and 3 of its coordinate system, of a cylindrical constraint (#422) r, theta and z
// about its axis. Their values are one number for all constrained directions or one
// per constrained direction; a step ramps them like a boundary, and they may be the
// curve of a job.
import type { Command } from "./resolved";

/** A constraint in local coordinates with the values of its expressions (#242). */
export type Local = Extract<
  Command,
  { command: "cartesian.add" | "cylindrical.add" }
>;

/** The directions of the commands, in the order of the components of FElupe. */
export const DIRECTIONS = {
  "cartesian.add": ["1", "2", "3"],
  "cylindrical.add": ["r", "theta", "z"],
} as const;

/** The names of the commands in the messages. */
export const NAMES = {
  "cartesian.add": "Cartesian constraint",
  "cylindrical.add": "cylindrical constraint",
} as const;

/** The names of the directions in the app, e.g. of the curve: θ for theta. */
export const LABELS = {
  "cartesian.add": ["1", "2", "3"],
  "cylindrical.add": ["r", "θ", "z"],
} as const;

/** Whether a command is a constraint in local coordinates. */
export const isLocal = (c: { command: string }): c is Local =>
  c.command in DIRECTIONS;

/** The directions of a constraint in a model of `dim` dimensions. */
export const directionsOf = (c: Pick<Local, "command">, dim = 3) =>
  DIRECTIONS[c.command].slice(0, dim) as readonly string[];

/**
 * The values of the directions of a constraint, one per direction of the model:
 * the given values of the constrained directions (one value for all of them, or
 * one per constrained direction in the order of the directions) and 0 of the free
 * ones.
 */
export function components(
  c: Pick<Local, "command" | "constrained">,
  values: number | readonly number[],
  dim = 3,
): number[] {
  const all = directionsOf(c, dim);
  const constrained = all.filter((d) =>
    (c.constrained as readonly string[]).includes(d),
  );
  const given = new Map(
    constrained.map((d, i) => [
      d,
      Array.isArray(values) ? (values[i] ?? 0) : (values as number),
    ]),
  );
  return all.map((d) => given.get(d) ?? 0);
}

/**
 * The index of the direction of the curve of a constraint by default, like
 * `first_moved()` of felupe_studio.directions: of its constrained directions the
 * first that its value or a ramp of a step moves, else the first one; `moved` is
 * whether one moves.
 */
export function firstMoved(
  commands: readonly Command[],
  c: Local,
  dim = 3,
): { index: number; moved: boolean } {
  const values = [components(c, c.value ?? 0, dim)];
  for (const step of commands) {
    if (step.command !== "step.add") continue;
    for (const item of step.ramp?.items ?? []) {
      if (item.target !== c.name) continue;
      values.push(components(c, item.start ?? 0, dim));
      values.push(components(c, item.end, dim));
    }
  }
  const indices = directionsOf(c, dim).flatMap((d, k) =>
    (c.constrained as readonly string[]).includes(d) ? [k] : [],
  );
  const moved = indices.filter((k) => values.some((v) => v[k] !== 0));
  return { index: (moved[0] ?? indices[0]) || 0, moved: moved.length > 0 };
}
