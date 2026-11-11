// Duplicate an object (#138): a copy of its command with the next free name, placed
// after the original. Other objects keep referencing the original.
import type { Command } from "./commands";
import { REGISTRY } from "./registry";
import { NAME_MAX_LENGTH } from "./schema";
import { nameProblem } from "./validate";

/**
 * The next free name of a copy: `rubber` → `rubber_2`, `material_1` → `material_2`
 * (or the next number that is not used), shortened to the longest name.
 */
export function duplicateName(
  name: string,
  commands: readonly Command[],
): string {
  const used = new Set(commands.map((c) => c.name));
  const match = /^(.*)_(\d+)$/.exec(name);
  const base = match ? match[1] : name;
  for (let n = match ? Number(match[2]) + 1 : 2; ; n++) {
    const suffix = `_${n}`;
    const candidate = base.slice(0, NAME_MAX_LENGTH - suffix.length) + suffix;
    if (!used.has(candidate) && !nameProblem(candidate)) return candidate;
  }
}

/** Why an object cannot be duplicated, or undefined if it can. */
export function duplicateBlocker(command: Command): string | undefined {
  return REGISTRY[command.command].single
    ? "A model has at most one of these settings."
    : undefined;
}

/** The copy of a command with a new name. */
export function duplicateCommand(
  command: Command,
  commands: readonly Command[],
): Command {
  return {
    ...structuredClone(command),
    name: duplicateName(command.name, commands),
  };
}
