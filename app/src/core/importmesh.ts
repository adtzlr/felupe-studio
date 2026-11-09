// Plan the commands of a mesh import: the mesh and its cell sets, with readable,
// valid and unused names derived from the file and its cell tags.
import type { Command } from "./commands";
import type { MeshInfo } from "../worker/protocol";
import { NAME_MAX_LENGTH } from "./schema";
import { nameProblem } from "./validate";

export type CellSetMode =
  { mode: "tag"; tag: string } | { mode: "all" } | { mode: "none" };

/** A valid name from arbitrary text, not in `taken`; `fallback` if nothing is left. */
export function toName(
  text: string,
  taken: ReadonlySet<string>,
  fallback: string,
): string {
  let base = text
    .replace(/[^A-Za-z0-9_]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "");
  if (/^[0-9]/.test(base)) base = `${fallback}_${base}`;
  base = base.slice(0, NAME_MAX_LENGTH).replace(/_+$/, "");
  if (!base || nameProblem(base)) base = fallback;
  if (!taken.has(base)) return base;
  for (let n = 2; ; n++) {
    const suffix = `_${n}`;
    const name = `${base.slice(0, NAME_MAX_LENGTH - suffix.length)}${suffix}`;
    if (!taken.has(name) && !nameProblem(name)) return name;
  }
}

const stem = (file: string) => file.replace(/\.[^.]*$/, "");

/** Name of a new mesh, from the file name. */
export function suggestMeshName(
  file: string,
  commands: readonly Command[],
): string {
  return toName(stem(file), new Set(commands.map((c) => c.name)), "mesh");
}

/** One cell set per tag value if the file has tags, else one with all cells. */
export function defaultMode(info: MeshInfo): CellSetMode {
  const tag = info.tags?.[0];
  return tag && tag.values.length > 1
    ? { mode: "tag", tag: tag.name }
    : { mode: "all" };
}

/** The commands that import a mesh and create its cell sets (one undo step). */
export function planImport(
  info: MeshInfo,
  name: string,
  mode: CellSetMode,
  commands: readonly Command[],
): Command[] {
  const taken = new Set([...commands.map((c) => c.name), name]);
  const take = (text: string, fallback: string) => {
    const result = toName(text, taken, fallback);
    taken.add(result);
    return result;
  };

  if (mode.mode === "tag") {
    const tag = info.tags?.find((t) => t.name === mode.tag);
    if (!tag) throw new Error(`The file has no cell tag '${mode.tag}'.`);
    const base = tag.name.split(":").pop() ?? "cells";
    const mesh: Command = {
      command: "mesh.import",
      name,
      file: info.file,
      tag: tag.name,
    };
    const cellsets: Command[] = tag.values.map((v) => ({
      command: "cellset.from_tag",
      name: take(v.label ?? `${base}_${v.value}`, "cells"),
      mesh: name,
      value: v.value,
    }));
    return [mesh, ...cellsets];
  }

  const mesh: Command = { command: "mesh.import", name, file: info.file };
  if (mode.mode === "none") return [mesh];
  return [
    mesh,
    {
      command: "cellset.from_file",
      name: take(`${name}_cells`, "cells"),
      mesh: name,
    },
  ];
}
