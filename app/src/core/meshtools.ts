// The mesh tools (ADR 0019, #193): the registry of the tools of `mesh.generate` in
// the command schema, with the dimensions of the points and the cells of the meshes
// they make, like felupe_studio.meshtools in Python. Their inputs are meshes of the
// model before: made by tools, of files or of scripts (#438). A mesh whose points
// and cells have the dimension of the model is a model mesh with cell sets; a lower
// one is a construction mesh.
import { type Analysis, analysisOf, is2d } from "./analysis";
import type { Command } from "./resolved";
import { schema } from "./schema";

/**
 * The dimensions of a mesh and its cell type (`x-dimension`). The cell type of a
 * mesh of a file or a script is unknown before its read, unless it is given (#438).
 */
export interface MeshDimension {
  points: number;
  cells: number;
  cell_type?: string;
}

/**
 * The rule of the dimensions of an operation (`x-dimension`): the number of its
 * inputs (`list` for two or more, stacked into one), the cell type of its mesh by
 * the cell type of its input (or the same), and the dimensions that its points gain.
 */
export interface OperationRule {
  inputs: number | "list";
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

/**
 * The dimension of the cells of a cell type: of the tools, and of the solid cells of
 * files and scripts (#438).
 */
const CELLS: Record<string, number> = {
  vertex: 0,
  line: 1,
  quad: 2,
  quad8: 2,
  quad9: 2,
  triangle: 2,
  triangle6: 2,
  hexahedron: 3,
  hexahedron20: 3,
  hexahedron27: 3,
  tetra: 3,
  tetra10: 3,
};

/** The mesh objects of files and scripts, inputs of the tools like made meshes. */
const SOURCES = ["mesh.import", "mesh.script"];

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

/**
 * The command of a tool for the rules of its inputs: its values resolved, or with
 * expressions, whose vectors have their lengths (#438).
 */
interface ToolCommand {
  tool: string;
  parameters: object;
}

const isOperation = (
  rule: MeshDimension | OperationRule,
): rule is OperationRule => "inputs" in rule;

/**
 * The dimensions of the mesh of an operation from those of its input, or
 * undefined if the input does not fit (like `output()` in Python). An input of an
 * unknown cell type (of a file before its read, #438) is taken as the cell type of
 * its dimension that the operation takes, if there is one; the app checks it with
 * the read (`readProblems()`).
 */
function output(
  rule: OperationRule,
  dimension: MeshDimension,
): MeshDimension | undefined {
  const types = rule.cell_type;
  let type = dimension.cell_type;
  if (type === undefined && types !== "same") {
    const fitting = Object.keys(types).filter(
      (t) => CELLS[t] === dimension.cells,
    );
    type = fitting.length === 1 ? fitting[0] : undefined;
  }
  if (types !== "same" && (type === undefined || !(type in types)))
    return undefined;
  const made = types === "same" ? type : types[type!];
  const added =
    typeof rule.points === "number" ? rule.points : rule.points[type!];
  return {
    points: dimension.points + added,
    cells: made === undefined ? dimension.cells : CELLS[made],
    ...(made === undefined ? {} : { cell_type: made }),
  };
}

/**
 * The dimensions of a mesh of a file or of a script (#438), from its command: the
 * points and the cells of the model of dimension `dim`, which it reads, or of the
 * dimension of its cell type, which is unknown before the read unless it is given
 * (like `source_dimension()` in Python).
 */
function sourceDimension(
  command: { cell_type?: string },
  dim: number,
): MeshDimension {
  const type = command.cell_type;
  const cells = (type === undefined ? undefined : CELLS[type]) ?? dim;
  return type === undefined
    ? { points: cells, cells }
    : { points: cells, cells, cell_type: type };
}

/**
 * The dimensions of the inputs of an operation, if they have the same points and
 * cells and the same cell type where it is known (with the known one), else
 * undefined (like `same()` in Python).
 */
function same(inputs: readonly MeshDimension[]): MeshDimension | undefined {
  const types = new Set(inputs.flatMap((d) => d.cell_type ?? []));
  const sizes = new Set(inputs.map((d) => `${d.points} ${d.cells}`));
  if (types.size > 1 || sizes.size > 1) return undefined;
  const [type] = types;
  const { points, cells } = inputs[0];
  return type === undefined
    ? { points, cells }
    : { points, cells, cell_type: type };
}

/**
 * The cells of a mesh in a message: its cell type, or the dimension of its cells if
 * the cell type is unknown before the read (#438).
 */
const cellsOf = (dimension: MeshDimension) =>
  dimension.cell_type ?? `${dimension.cells}D`;

/**
 * The dimensions of the points and of the cells and the cell type of every mesh of
 * the model, by its name, from the commands alone (like Python): of a mesh of a
 * file or a script from the model (#438) unless it is `known` (e.g. of its read),
 * of a primitive from its tool, of an operation from its input (none if it does not
 * fit).
 */
export function dimensions(
  commands: readonly {
    command: string;
    name: string;
    tool?: string;
    inputs?: readonly string[];
    cell_type?: string;
    analysis?: Analysis;
  }[],
  known: ReadonlyMap<string, MeshDimension> = new Map(),
): Map<string, MeshDimension> {
  const dim = is2d(analysisOf(commands)) ? 2 : 3;
  const result = new Map(known);
  for (const c of commands) {
    if (SOURCES.includes(c.command)) {
      if (!result.has(c.name)) result.set(c.name, sourceDimension(c, dim));
      continue;
    }
    const tool = c.command === "mesh.generate" && TOOLS.get(c.tool ?? "");
    if (!tool) continue;
    const rule = tool.dimension;
    if (!isOperation(rule)) {
      result.set(c.name, { ...rule });
      continue;
    }
    const inputs = (c.inputs ?? []).map((name) => result.get(name));
    // inputs of the same cells and points, and an output of up to 3D points with
    // at least the dimension of its cells
    if (!inputs.length || inputs.some((d) => !d)) continue;
    const input = same(inputs as MeshDimension[]);
    const made = input && output(rule, input);
    if (made && made.cells <= made.points && made.points <= 3)
      result.set(c.name, made);
  }
  return result;
}

/**
 * Why the inputs of an operation do not fit it, with the dimensions of the meshes
 * before (like `input_problems()` in Python).
 */
export function inputProblems(
  command: ToolCommand,
  known: ReadonlyMap<string, MeshDimension>,
): string[] {
  const rule = TOOLS.get(command.tool)?.dimension;
  if (!rule || !isOperation(rule)) return [];
  const inputs = (command as { inputs?: string[] }).inputs ?? [];
  const problems = sameInputs(command.tool, inputs, known);
  return problems.concat(
    inputs.flatMap((name) => {
      const dimension = known.get(name);
      if (!dimension) return [];
      const made = output(rule, dimension);
      if (!made) {
        const types = Object.keys(rule.cell_type);
        const names = `${types.slice(0, -1).join(", ")} or ${types.at(-1)}`;
        return [
          `${command.tool} needs a mesh of ${names} cells; '${name}' has ${cellsOf(dimension)} cells.`,
        ];
      }
      if (made.points > 3)
        return [
          `${command.tool} of '${name}' would need ${made.points}D points; its points are ${dimension.points}D.`,
        ];
      if (made.points < made.cells)
        return [
          `${command.tool} of '${name}' needs ${made.cells}D points; its points are ${dimension.points}D: embed it first.`,
        ];
      return axisProblems(command, name, dimension, made);
    }),
  );
}

/**
 * The inputs of an operation of several meshes have the same cell type (where it is
 * known, #438) and the same dimension of their points.
 */
function sameInputs(
  tool: string,
  names: readonly string[],
  known: ReadonlyMap<string, MeshDimension>,
): string[] {
  const inputs = names.flatMap((name) => {
    const d = known.get(name);
    return d ? [[name, d] as const] : [];
  });
  if (inputs.length < 2 || same(inputs.map(([, d]) => d))) return [];
  const meshes = inputs
    .map(
      ([name, d]) => `'${name}' ${cellsOf(d)} cells with ${d.points}D points`,
    )
    .join(", ");
  return [`${tool} needs meshes of the same cells and points: ${meshes}.`];
}

/**
 * The axis of an operation is one of the points of its input (of its output for
 * revolve), and a rotation of 2D points turns about z.
 */
function axisProblems(
  command: ToolCommand,
  name: string,
  dimension: MeshDimension,
  made: MeshDimension,
): string[] {
  const parameters = command.parameters as {
    axis?: string;
    center?: unknown[];
    centerpoint?: unknown[];
    values?: unknown[];
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
  for (const key of ["center", "centerpoint"] as const) {
    const center = parameters[key];
    if (center !== undefined && center.length !== points)
      problems.push(
        `the ${key} needs ${points} coordinates, one per dimension of the points of '${name}'.`,
      );
  }
  const { values } = parameters;
  if (command.tool === "add_runouts" && values?.length !== points - 1) {
    const count = points === 2 ? "1 value" : `${points - 1} values`;
    problems.push(
      `'${name}' has ${points}D points: the runouts need ${count}, one per coordinate perpendicular to the axis.`,
    );
  }
  return problems;
}

/** Whether a mesh of these dimensions is a mesh of a model of dimension `dim`. */
export const modelMesh = (dimension: MeshDimension, dim: number): boolean =>
  dimension.points === dim && dimension.cells === dim;

/**
 * Whether a mesh is a construction mesh below the dimension of the model: made by a
 * tool (ADR 0019), or of a file or a script with 2D cells in a 3D model (#438).
 */
export function isConstruction(
  name: string,
  commands: Parameters<typeof dimensions>[0],
): boolean {
  const dimension = dimensions(commands).get(name);
  const dim = is2d(analysisOf(commands)) ? 2 : 3;
  return dimension !== undefined && !modelMesh(dimension, dim);
}

const AXES = ["x", "y", "z"];

/** The axes in a message, e.g. `x`, `x and y` or `x, y and z`. */
const axesText = (axes: string[]) =>
  axes.length === 1
    ? axes[0]
    : `${axes.slice(0, -1).join(", ")} and ${axes.at(-1)}`;

/**
 * What is wrong with the values of a tool beyond the schema, like Python: the
 * corner `b` (the end of a line) is larger than `a` in every axis, the corners of
 * a triangle go around counterclockwise, and the quarters of a circle do not
 * overlap.
 */
export function toolProblems(command: MeshGenerate): string[] {
  const parameters = command.parameters as Record<string, unknown>;
  if (command.tool === "Triangle") return triangleProblems(parameters);
  if (command.tool === "Circle") return circleProblems(parameters);
  return cornerProblems(parameters);
}

/**
 * The corners of a triangle go around counterclockwise, else its cells are
 * inverted, and they do not lie on a line.
 */
function triangleProblems(parameters: Record<string, unknown>): string[] {
  const corners = ["a", "b", "c"].map((key) => parameters[key]);
  if (!corners.every((p) => Array.isArray(p) && p.length === 2)) return [];
  const [[ax, ay], [bx, by], [cx, cy]] = (corners as unknown[][]).map((p) =>
    p.map(Number),
  );
  const area = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
  const size = Math.max(
    (bx - ax) ** 2 + (by - ay) ** 2,
    (cx - ax) ** 2 + (cy - ay) ** 2,
  );
  if (Math.abs(area) <= 1e-12 * size) return ["a, b and c lie on a line."];
  if (area < 0) return ["a, b and c go around clockwise; swap b and c."];
  return [];
}

/** The quarters of a circle start at least 90 degrees apart, else they overlap. */
function circleProblems(parameters: Record<string, unknown>): string[] {
  if (!Array.isArray(parameters.sections)) return [];
  const sections = parameters.sections.map(Number);
  for (const [i, first] of sections.entries())
    for (const second of sections.slice(i + 1)) {
      const gap = Math.abs(second - first) % 360;
      if (Math.min(gap, 360 - gap) < 90 - 1e-9)
        return [
          `sections ${first} and ${second} overlap: the quarters need 90 degrees between them.`,
        ];
    }
  return [];
}

/** The corner `b` (the end of a line) is larger than `a` in every axis. */
function cornerProblems(parameters: Record<string, unknown>): string[] {
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
