// The boundaries of the steps (#393): a step has all boundaries, load cases and
// symmetry planes by default, or those that it names. A boundary that a step does
// not have is off in it: its points are free. Like felupe_studio.commands.off_curves()
// in Python, a job whose curve is off in some of its steps gets a note.
import type { Command as ResolvedCommand } from "./resolved";
import type { Issue } from "./rules";

/** A step with the values of its expressions (#242). */
export type Step = Extract<ResolvedCommand, { command: "step.add" }>;

/** Whether a boundary, load case or symmetry plane is on in a step. */
export function isOn(step: Pick<Step, "boundaries">, name: string): boolean {
  return step.boundaries?.includes(name) ?? true;
}

// the items that a step chooses, by the field of the step (#393): the commands of a
// field that the step does not name are off in it
type Chosen = "boundaries" | "constraints" | "loads";
const CHOSEN: readonly [Chosen, readonly string[]][] = [
  ["boundaries", ["boundary.add", "loadcase.add", "symmetry.add"]],
  ["constraints", ["mpc.add", "cartesian.add", "contact.add"]],
  ["loads", ["load.add", "pressure.add"]],
];

/**
 * The boundaries, load cases, symmetry planes, constraints, contacts, point loads
 * and pressures that are off in a step, in the order of the model (#393). The
 * sections are not among them: they are cells of the meshes.
 */
export function offIn(
  step: Pick<Step, Chosen>,
  commands: readonly { command: string; name: string }[],
): string[] {
  return commands
    .filter((c) =>
      CHOSEN.some(([field, types]) => {
        const names: readonly string[] | undefined = step[field];
        return types.includes(c.command) && !!names && !names.includes(c.name);
      }),
    )
    .map((c) => c.name);
}

/**
 * What the viewport fades with a step selected (#393): what is off in it, and the
 * rigid surfaces whose contacts are all off in it.
 */
export function fadedIn(
  step: Pick<Step, Chosen>,
  commands: readonly ResolvedCommand[],
): Set<string> {
  const off = new Set(offIn(step, commands));
  const contacts = commands.filter(
    (c): c is Extract<ResolvedCommand, { command: "contact.add" }> =>
      c.command === "contact.add",
  );
  for (const c of commands) {
    if (c.command !== "rigid.add") continue;
    const of = contacts.filter((contact) => contact.surface === c.name);
    if (of.length && of.every((contact) => off.has(contact.name)))
      off.add(c.name);
  }
  return off;
}

/** Names in a sentence, e.g. `step 'a'` or `steps 'a', 'b' and 'c'`. */
export function namesOf(kind: string, names: readonly string[]): string {
  const quoted = names.map((name) => `'${name}'`);
  if (quoted.length === 1) return `${kind} ${quoted[0]}`;
  return `${kind}s ${quoted.slice(0, -1).join(", ")} and ${quoted.at(-1)}`;
}

/**
 * Notes about jobs whose curve is a boundary or a load case that is off in some of
 * their steps: its force is zero there (messages like in Python).
 */
export function curveNotes(commands: readonly ResolvedCommand[]): Issue[] {
  const steps = new Map<string, Step>();
  const boundaries = new Set<string>();
  for (const cmd of commands) {
    if (cmd.command === "step.add") steps.set(cmd.name, cmd);
    if (cmd.command === "boundary.add" || cmd.command === "loadcase.add")
      boundaries.add(cmd.name);
  }
  const notes: Issue[] = [];
  commands.forEach((cmd, index) => {
    if (cmd.command !== "job.add" || !cmd.curve || !boundaries.has(cmd.curve))
      return;
    const curve = cmd.curve;
    const off = [...new Set(cmd.steps)].filter((name) => {
      const step = steps.get(name);
      return step !== undefined && !isOn(step, curve);
    });
    if (!off.length) return;
    notes.push({
      index,
      name: cmd.name,
      message:
        `commands/${index}: job '${cmd.name}' records the curve of '${curve}', ` +
        `which is off in ${namesOf("step", off)}: its force is zero there.`,
      field: "curve",
    });
  });
  return notes;
}
