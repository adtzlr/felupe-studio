// Symmetry planes (#186, fem.dof.symmetry): planes normal to x, y or z on which the
// normal displacement component is zero. Like felupe_studio.commands.notes() in
// Python: a plane that a load case or another symmetry object already has is a note.
import type { Command } from "./commands";
import { loadcasePlanes } from "./loadcases";
import type { Issue } from "./validate";

export type Symmetry = Extract<Command, { command: "symmetry.add" }>;

const AXES = ["x", "y", "z"] as const;

/** A symmetry plane: its normal and its coordinate along it. */
export interface Plane {
  axis: (typeof AXES)[number];
  value: number;
}

/** The planes of a symmetry object, in the order x, y, z. */
export function symmetryPlanes(symmetry: Symmetry): Plane[] {
  return AXES.filter((a) => symmetry.axes.includes(a)).map((axis) => ({
    axis,
    value: symmetry[axis] ?? 0,
  }));
}

/** A short description of the planes, e.g. `x = 0, z = 12.5`. */
export function describeSymmetry(symmetry: Symmetry, unit = ""): string {
  return symmetryPlanes(symmetry)
    .map(
      (p) => `${p.axis} = ${p.value}${p.value !== 0 && unit ? ` ${unit}` : ""}`,
    )
    .join(", ");
}

/**
 * Notes about planes of symmetry objects that a load case or an earlier symmetry
 * object already has: the same degrees of freedom are prescribed twice, which does
 * no harm (messages like in Python).
 */
export function symmetryNotes(commands: readonly Command[]): Issue[] {
  const owners = new Map<string, string>();
  const key = (p: Plane) => `${p.axis}=${p.value}`;
  for (const cmd of commands) {
    if (cmd.command !== "loadcase.add") continue;
    for (const axis of loadcasePlanes(cmd)) {
      const k = key({ axis, value: 0 });
      if (!owners.has(k)) owners.set(k, `load case '${cmd.name}'`);
    }
  }
  const notes: Issue[] = [];
  commands.forEach((cmd, index) => {
    if (cmd.command !== "symmetry.add") return;
    for (const plane of symmetryPlanes(cmd)) {
      const owner = owners.get(key(plane));
      if (owner) {
        notes.push({
          index,
          name: cmd.name,
          message:
            `commands/${index}: the plane ${plane.axis} = ${plane.value} of ` +
            `symmetry '${cmd.name}' is already a symmetry plane of ${owner}.`,
          field: plane.axis,
        });
      } else {
        owners.set(key(plane), `symmetry '${cmd.name}'`);
      }
    }
  });
  return notes;
}
