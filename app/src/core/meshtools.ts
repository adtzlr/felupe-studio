// The mesh tools (ADR 0019, #193): the registry of the tools of `mesh.generate` in
// the command schema, with the dimensions of the points and the cells of the meshes
// they make, like felupe_studio.meshtools in Python. A mesh whose points and cells
// have the dimension of the model is a model mesh with cell sets; a lower one is a
// construction mesh.
import type { Command } from "./resolved";
import { schema } from "./schema";

/** The dimensions of a made mesh and its cell type (`x-dimension`). */
export interface MeshDimension {
  points: number;
  cells: number;
  cell_type: string;
}

interface ToolNode {
  description: string;
  "x-label": string;
  "x-group": string;
  "x-felupe": string;
  "x-dimension": MeshDimension;
  properties: { tool: { const: string } };
}

export interface MeshTool {
  name: string;
  label: string;
  /** The menu of the ribbon, e.g. `Primitives`. */
  group: string;
  description: string;
  /** The FElupe call, e.g. `fem.Cube`. */
  felupe: string;
  dimension: MeshDimension;
}

const defs = schema.$defs as unknown as Record<string, ToolNode> & {
  MeshGenerate: { oneOf: { $ref: string }[] };
};

/** The mesh tools, in the order of the schema. */
export const MESH_TOOLS: readonly MeshTool[] = defs.MeshGenerate.oneOf.map(
  ({ $ref }) => {
    const node = defs[$ref.split("/").pop()!];
    return {
      name: node.properties.tool.const,
      label: node["x-label"],
      group: node["x-group"],
      description: node.description,
      felupe: node["x-felupe"],
      dimension: node["x-dimension"],
    };
  },
);

const TOOLS = new Map(MESH_TOOLS.map((t) => [t.name, t]));

type MeshGenerate = Extract<Command, { command: "mesh.generate" }>;

/**
 * The dimensions of the points and of the cells and the cell type of every mesh
 * made by a tool, by its name, from the commands alone (like Python).
 */
export function dimensions(
  commands: readonly { command: string; name: string; tool?: string }[],
): Map<string, MeshDimension> {
  const result = new Map<string, MeshDimension>();
  for (const c of commands) {
    const tool = c.command === "mesh.generate" && TOOLS.get(c.tool ?? "");
    if (tool) result.set(c.name, { ...tool.dimension });
  }
  return result;
}

/** Whether a mesh of these dimensions is a mesh of a model of dimension `dim`. */
export const modelMesh = (dimension: MeshDimension, dim: number): boolean =>
  dimension.points === dim && dimension.cells === dim;

const AXES = ["x", "y", "z"];

/** The axes in a message, e.g. `x`, `x and y` or `x, y and z`. */
const axesText = (axes: string[]) =>
  axes.length === 1
    ? axes[0]
    : `${axes.slice(0, -1).join(", ")} and ${axes.at(-1)}`;

/**
 * What is wrong with the values of a tool beyond the schema: the corner `b` (the
 * end of a line) is larger than `a` in every axis, like Python.
 */
export function toolProblems(command: MeshGenerate): string[] {
  const parameters = command.parameters as Record<string, unknown>;
  const { a, b } = parameters;
  if (a === undefined || b === undefined) return [];
  if (!Array.isArray(a))
    return Number(b) > Number(a) ? [] : ["b must be larger than a."];
  const axes = AXES.filter(
    (_, i) => i < a.length && Number((b as unknown[])[i]) <= Number(a[i]),
  );
  return axes.length ? [`b must be larger than a in ${axesText(axes)}.`] : [];
}
