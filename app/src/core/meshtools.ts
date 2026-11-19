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

/**
 * The rule of the dimensions of an operation (`x-dimension`): the cell type of its
 * mesh by the cell type of its input (or the same), and the dimensions that its
 * points gain.
 */
export interface OperationRule {
  inputs: number;
  cell_type: Record<string, string> | "same";
  points: number | Record<string, number>;
}

interface ToolNode {
  description: string;
  "x-label": string;
  "x-group": string;
  "x-felupe": string;
  "x-dimension": MeshDimension | OperationRule;
  properties: { tool: { const: string } };
}

/** The dimension of the cells of a cell type. */
const CELLS: Record<string, number> = {
  vertex: 0,
  line: 1,
  quad: 2,
  triangle: 2,
  hexahedron: 3,
  tetra: 3,
};

export interface MeshTool {
  name: string;
  label: string;
  /** The menu of the ribbon, e.g. `Primitives`. */
  group: string;
  description: string;
  /** The FElupe call, e.g. `fem.Cube`. */
  felupe: string;
  dimension: MeshDimension | OperationRule;
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

const isOperation = (
  rule: MeshDimension | OperationRule,
): rule is OperationRule => "inputs" in rule;

/**
 * The dimensions of the mesh of an operation from those of its input, or
 * undefined if the input does not fit (like `output()` in Python).
 */
function output(
  rule: OperationRule,
  dimension: MeshDimension,
): MeshDimension | undefined {
  const type = dimension.cell_type;
  const types = rule.cell_type;
  if (types !== "same" && !(type in types)) return undefined;
  const made = types === "same" ? type : types[type];
  const added =
    typeof rule.points === "number" ? rule.points : rule.points[type];
  return {
    points: dimension.points + added,
    cells: CELLS[made],
    cell_type: made,
  };
}

/**
 * The dimensions of the points and of the cells and the cell type of every mesh
 * made by a tool, by its name, from the commands alone (like Python): of a
 * primitive from its tool, of an operation from its input (none if it does not
 * fit).
 */
export function dimensions(
  commands: readonly {
    command: string;
    name: string;
    tool?: string;
    inputs?: readonly string[];
  }[],
): Map<string, MeshDimension> {
  const result = new Map<string, MeshDimension>();
  for (const c of commands) {
    const tool = c.command === "mesh.generate" && TOOLS.get(c.tool ?? "");
    if (!tool) continue;
    const rule = tool.dimension;
    if (!isOperation(rule)) {
      result.set(c.name, { ...rule });
      continue;
    }
    const inputs = (c.inputs ?? []).map((name) => result.get(name));
    if (!inputs.length || inputs.some((d) => !d)) continue;
    const made = output(rule, inputs[0]!);
    if (made && made.points <= 3) result.set(c.name, made);
  }
  return result;
}

/**
 * Why the inputs of an operation do not fit it, with the dimensions of the meshes
 * made before (like `input_problems()` in Python).
 */
export function inputProblems(
  command: MeshGenerate,
  known: ReadonlyMap<string, MeshDimension>,
): string[] {
  const rule = TOOLS.get(command.tool)?.dimension;
  if (!rule || !isOperation(rule)) return [];
  const inputs = (command as { inputs?: string[] }).inputs ?? [];
  return inputs.flatMap((name) => {
    const dimension = known.get(name);
    if (!dimension) return [];
    const made = output(rule, dimension);
    if (!made) {
      const types = Object.keys(rule.cell_type);
      const names = `${types.slice(0, -1).join(", ")} or ${types.at(-1)}`;
      return [
        `${command.tool} needs a mesh of ${names} cells; '${name}' has ${dimension.cell_type} cells.`,
      ];
    }
    if (made.points > 3)
      return [
        `${command.tool} of '${name}' would need ${made.points}D points; its points are ${dimension.points}D.`,
      ];
    return axisProblems(command, name, dimension, made);
  });
}

/**
 * The axis of an operation is one of the points of its input (of its output for
 * revolve), and a rotation of 2D points turns about z.
 */
function axisProblems(
  command: MeshGenerate,
  name: string,
  dimension: MeshDimension,
  made: MeshDimension,
): string[] {
  const parameters = command.parameters as {
    axis?: string;
    center?: unknown[];
  };
  const problems: string[] = [];
  const { axis } = parameters;
  const points = command.tool === "revolve" ? made.points : dimension.points;
  if (command.tool === "rotate" && points === 2 && axis !== "z")
    problems.push(`'${name}' has 2D points, which rotate about z only.`);
  else if (command.tool === "rotate" && points < 2)
    problems.push(`'${name}' has 1D points, which cannot rotate.`);
  else if (
    axis !== undefined &&
    command.tool !== "rotate" &&
    AXES.indexOf(axis) >= points
  )
    problems.push(`'${name}' has ${points}D points, without the axis ${axis}.`);
  const { center } = parameters;
  if (center !== undefined && center.length !== points)
    problems.push(
      `the center needs ${points} coordinates, one per dimension of the points of '${name}'.`,
    );
  return problems;
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

/**
 * The meshes that the operations of the mesh tools take, with the meshes that take
 * them (ADR 0019): a mesh that another tool uses is hidden by default, and shown
 * below the mesh that uses it in the browser.
 */
export function usersOf(
  commands: readonly { command: string; name: string; inputs?: unknown }[],
): Map<string, string[]> {
  const users = new Map<string, string[]>();
  for (const c of commands) {
    if (c.command !== "mesh.generate" || !Array.isArray(c.inputs)) continue;
    for (const input of c.inputs as string[])
      users.set(input, [...(users.get(input) ?? []), c.name]);
  }
  return users;
}

/**
 * The hidden objects: those that the user hid, and the meshes that another tool
 * uses (hidden by default, like the history of a CAD model, ADR 0019) unless the
 * user showed them. `toggled` are the objects whose visibility the user changed.
 */
export function hiddenObjects(
  commands: readonly { command: string; name: string; inputs?: unknown }[],
  toggled: ReadonlySet<string>,
): Set<string> {
  const result = new Set(toggled);
  for (const name of usersOf(commands).keys())
    if (!result.delete(name)) result.add(name);
  return result;
}
