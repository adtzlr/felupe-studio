// Plan the commands of a mesh import: the mesh and its cell sets, with readable,
// valid and unused names derived from the file and its cell tags. A file with more
// than one type of solid cells gives one mesh per cell type. A file of 2D cells in a
// 3D model may be a construction mesh, e.g. a profile to revolve (#438).
import { analysisOf, CELLS_2D, is2d } from "./analysis";
import type { Command, MeshImport } from "./commands";
import type { Units } from "./units";
import { fileTags, solidOf, solidTypes } from "./meshinfo";
import { isConstruction } from "./meshtools";
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

/**
 * Whether the file may be a construction mesh of the model (#438): its solid cells
 * are 2D cells, e.g. a profile, and the model is 3D. A construction mesh is an
 * input of the mesh tools (`revolve`, `expand`), without cell sets.
 */
export function offersConstruction(
  info: MeshInfo,
  commands: readonly Command[],
): boolean {
  const solids = info.solids ?? [];
  return (
    !is2d(analysisOf(commands)) &&
    solids.length > 0 &&
    solids.every((s) => CELLS_2D.includes(s.cell_type))
  );
}

/** One cell set per tag value if the file has tags, else one with all cells. */
export function defaultMode(info: MeshInfo): CellSetMode {
  const tag = fileTags(info)[0];
  return tag && tag.values.length > 1
    ? { mode: "tag", tag: tag.name }
    : { mode: "all" };
}

/** The size of the bounding box of the solid cells of a file, by axis. */
export function meshSize(info: MeshInfo): [number, number, number] {
  const solids = info.solids ?? [];
  if (solids.length === 0) return [0, 0, 0];
  const size = [0, 1, 2].map(
    (i) =>
      Math.max(...solids.map((s) => s.bounds[1][i])) -
      Math.min(...solids.map((s) => s.bounds[0][i])),
  );
  return size as [number, number, number];
}

/** A scale of a mesh that looks like it is in other units than the model. */
export interface ScaleSuggestion {
  scale: number;
  reason: string;
}

/**
 * A scale for a mesh that is very small or very large for the units of the model
 * (#135): smaller than 1 mm (made in m?) or larger than 10 m (made in mm?). Without
 * units, only smaller than 0.01 or larger than 10000.
 */
export function suggestScale(
  size: readonly number[],
  units: Units | undefined,
): ScaleSuggestion | undefined {
  const largest = Math.max(...size);
  if (!(largest > 0)) return undefined;
  const length = units?.length;
  if (length === "mm" ? largest < 1 : !length && largest < 1e-2) {
    return {
      scale: 1000,
      reason: length
        ? "The mesh is smaller than 1 mm: was it made in m?"
        : "The mesh is very small: is it in m and the model in mm?",
    };
  }
  if (length === "m" ? largest > 10 : !length && largest > 1e4) {
    return {
      scale: 0.001,
      reason: length
        ? "The mesh is larger than 10 m: was it made in mm?"
        : "The mesh is very large: is it in mm and the model in m?",
    };
  }
  return undefined;
}

type Solid = NonNullable<MeshInfo["solids"]>[number];
type Tag = Solid["tags"][number];

/**
 * How many cell types each value of the chosen tag has: values of more than one
 * cell type get the cell type in their names.
 */
function tagTypes(solids: readonly Solid[], mode: CellSetMode) {
  const types = new Map<number, number>();
  if (mode.mode !== "tag") return types;
  for (const solid of solids) {
    const tag = solid.tags.find((t) => t.name === mode.tag);
    for (const v of tag?.values ?? []) {
      types.set(v.value, (types.get(v.value) ?? 0) + 1);
    }
  }
  return types;
}

/** The cell sets of the mesh of a solid: one per tag value, or all its cells. */
function cellsetsOf(
  solid: Solid,
  tag: Tag | undefined,
  meshName: string,
  mode: CellSetMode,
  types: ReadonlyMap<number, number>,
  take: (text: string, fallback: string) => string,
): Command[] {
  if (tag) {
    const base = tag.name.split(":").pop() ?? "cells";
    return tag.values.map((v) => {
      const text = v.label ?? `${base}_${v.value}`;
      const suffix = (types.get(v.value) ?? 0) > 1 ? `_${solid.cell_type}` : "";
      return {
        command: "cellset.from_tag",
        name: take(`${text}${suffix}`, "cells"),
        mesh: meshName,
        value: v.value,
      };
    });
  }
  // all cells, also if the tag is not offered for the cells of this type
  if (mode.mode === "none") return [];
  return [
    {
      command: "cellset.from_file",
      name: take(`${meshName}_cells`, "cells"),
      mesh: meshName,
    },
  ];
}

/**
 * The commands that import a mesh and create its cell sets (one undo step). With
 * more than one type of solid cells in the file, every mesh takes one cell type and
 * is named `<name>_<cell type>`. A scale other than 1 multiplies the coordinates.
 * A `construction` mesh (#438) takes its cell type, without cell sets.
 */
export function planImport(
  info: MeshInfo,
  name: string,
  cellsets: CellSetMode,
  commands: readonly Command[],
  scale = 1,
  construction = false,
): Command[] {
  const taken = new Set([...commands.map((c) => c.name), name]);
  const take = (text: string, fallback: string) => {
    const result = toName(text, taken, fallback);
    taken.add(result);
    return result;
  };

  const mode: CellSetMode = construction ? { mode: "none" } : cellsets;
  const solids = info.solids ?? [];
  const byType = solidTypes(info).length > 1;
  if (mode.mode === "tag" && !fileTags(info).some((t) => t.name === mode.tag)) {
    throw new Error(`The file has no cell tag '${mode.tag}'.`);
  }
  const types = tagTypes(solids, mode);
  const plan: Command[] = [];
  for (const solid of solids) {
    const meshName =
      solids.length > 1 ? take(`${name}_${solid.cell_type}`, "mesh") : name;
    const tag =
      mode.mode === "tag"
        ? solid.tags.find((t) => t.name === mode.tag)
        : undefined;
    const mesh: MeshImport = {
      command: "mesh.import",
      name: meshName,
      file: info.file,
      ...(tag ? { tag: tag.name } : {}),
      ...(byType || construction
        ? { cell_type: solid.cell_type as MeshImport["cell_type"] }
        : {}),
      ...(scale !== 1 ? { scale } : {}),
    };
    plan.push(mesh, ...cellsetsOf(solid, tag, meshName, mode, types, take));
  }
  return plan;
}

/**
 * What a planned command creates, e.g. `hexahedron, 96 cells`, and whether a mesh
 * is a construction mesh in the model (#438).
 */
export function describePlanned(
  command: Command,
  plan: readonly Command[],
  info: MeshInfo,
  commands: readonly Command[] = [],
): string {
  const solid = (meshName: string) => {
    const mesh = plan.find((c) => c.name === meshName);
    const choice =
      mesh?.command === "mesh.import"
        ? solidOf(info, mesh.cell_type)
        : undefined;
    return choice && "solid" in choice ? choice.solid : undefined;
  };
  const cells = (n: number) =>
    `${n.toLocaleString("en")} cell${n === 1 ? "" : "s"}`;
  switch (command.command) {
    case "mesh.import": {
      const s = solid(command.name);
      const construction = isConstruction(command.name, [...commands, ...plan]);
      return s
        ? `${s.cell_type}, ${cells(s.cells)}${construction ? ", construction" : ""}`
        : "";
    }
    case "cellset.from_tag": {
      const s = solid(command.mesh);
      const mesh = plan.find((c) => c.name === command.mesh);
      const tagName = mesh?.command === "mesh.import" ? mesh.tag : undefined;
      const tag = s?.tags.find((t) => t.name === tagName);
      const n = tag?.values.find((v) => v.value === command.value)?.cells ?? 0;
      return `${tagName} = ${command.value}, ${cells(n)}`;
    }
    case "cellset.from_file":
      return cells(solid(command.mesh)?.cells ?? 0);
    default:
      return "";
  }
}
