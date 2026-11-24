// The rules of the validation of a command list beyond its JSON schema (#310),
// like felupe_studio.rules with the same names; both are tested with
// tests/data/validation_cases.json, so the messages are identical.
//
// A rule is a function `(model, command) => problems` of a command and the `Model`
// of the command list: the type of its analysis, the rotation points of its
// constraints, and the objects of the commands before. Every command is checked by
// the rules of all commands (its type of analysis, its references, and its name)
// and by the rules of its command type (`RULES`), in this order.
import {
  dimensions,
  inputProblems,
  type MeshDimension,
  modelMesh,
  toolProblems,
} from "./meshtools";
import type { Command as ResolvedCommand, PointSetAdd } from "./resolved";
import { type Analysis, analysisOf, analysisProblems, is2d } from "./analysis";
import {
  AXES,
  type CommandType,
  KINDS,
  type Kind,
  kindName,
  kindsOf,
  RAMPED,
  REFERENCES,
  SINGLE,
  valueAt,
  type Vertex,
  VERTICES,
} from "./kinds";
import { loadcaseFieldErrors, loadcaseProblems } from "./loadcases";
import { first, fits, type Formulation, formulationOf } from "./formulations";
import { MATERIAL_MODELS, materialProblems, strainBased } from "./materials";
import { parameterProblems } from "./parameters";
import {
  NAME_MAX_LENGTH,
  NAME_PATTERN,
  RESERVED_KEYWORDS,
  RESERVED_NAMES,
  RESERVED_PREFIXES,
} from "./schema";

/** A problem of a command, with the field of the command that has it (#137). */
export interface Problem {
  message: string;
  field?: string;
}

export interface Issue {
  /** Index of the command in the command list. */
  index: number;
  /** Name of the command. */
  name: string;
  /** Message, prefixed with `commands/<index>: ` like in Python. */
  message: string;
  /** The field of the command that has the issue, e.g. `material` (#137). */
  field?: string;
}

/** Like `np.isclose` of the generated script (relative tolerance 1e-5). */
const isClose = (a: number, b: number, atol: number) =>
  Math.abs(a - b) <= atol + 1e-5 * Math.abs(b);

/** A number with its noun, in the plural if needed, e.g. `1 value`. */
const countOf = (count: number, word: string) =>
  count === 1 ? `${count} ${word}` : `${count} ${word}s`;

/**
 * Whether a point set by a coordinate, on a cylinder or by nodes selects the
 * coordinates of a point, like the script: also a control point or the reference
 * point of a rigid surface, e.g. on the plane of a bonded face (#222). Point sets at
 * a bound, on the surface, of a section or by ids select no such point.
 */
function selectsPoint(
  select: PointSetAdd["select"],
  point: readonly number[],
): boolean {
  if (
    "ids" in select ||
    "surface" in select ||
    "bound" in select ||
    "section" in select
  )
    return false;
  const atol = select.atol ?? 1e-8;
  if ("points" in select)
    return select.points.some((node) =>
      node.every((value, k) => isClose(point[k], value, atol)),
    );
  const k = AXES.indexOf(select.axis);
  if ("value" in select) return isClose(point[k], select.value, atol);
  const [i, j] = [0, 1, 2].filter((n) => n !== k);
  const center = select.center ?? [0, 0, 0];
  const distance = Math.hypot(point[i] - center[i], point[j] - center[j]);
  return isClose(distance, select.radius, atol);
}

/** Reason why a name is not allowed, or undefined if it is allowed. */
export function nameProblem(name: string): string | undefined {
  if (!NAME_PATTERN.test(name)) {
    return "A name starts with a letter or _ and contains only letters, digits and _.";
  }
  if (name.length > NAME_MAX_LENGTH) {
    return `A name has at most ${NAME_MAX_LENGTH} characters.`;
  }
  if (
    RESERVED_KEYWORDS.has(name) ||
    RESERVED_NAMES.has(name) ||
    RESERVED_PREFIXES.some((prefix) => name.startsWith(prefix))
  ) {
    return `name '${name}' is reserved for the generated script.`;
  }
  return undefined;
}

/**
 * A command list and the values that the rules use: the type of its analysis
 * (#175) with its axes, the rotation points of its constraints, and the objects of
 * the commands before the checked one (`defined`).
 */
export class Model {
  readonly analysis: Analysis;
  readonly axes: readonly string[];
  readonly rotations: ReadonlySet<string>;
  /** Name → [index, command] of the commands before, the first of a name. */
  readonly defined = new Map<string, [number, ResolvedCommand]>();
  private selections?: Map<string, PointSetAdd["select"]>;
  private made?: Map<string, MeshDimension>;

  constructor(readonly commands: readonly ResolvedCommand[]) {
    this.analysis = analysisOf(commands);
    this.axes = is2d(this.analysis) ? AXES.slice(0, 2) : AXES;
    this.rotations = new Set(
      commands.flatMap((c) =>
        c.command === "mpc.add" && c.rotation !== undefined ? [c.rotation] : [],
      ),
    );
  }

  /** The selections of the point sets, by their names. */
  /** The dimensions of the meshes made by tools, by their names (ADR 0019). */
  get dimensions(): Map<string, MeshDimension> {
    this.made ??= dimensions(this.commands);
    return this.made;
  }

  get selects(): Map<string, PointSetAdd["select"]> {
    this.selections ??= new Map(
      this.commands.flatMap((c) =>
        c.command === "pointset.add" ? [[c.name, c.select] as const] : [],
      ),
    );
    return this.selections;
  }

  /** The command of an object defined before, or undefined. */
  before(name: string): ResolvedCommand | undefined {
    return this.defined.get(name)?.[1];
  }

  /** The kind of an object defined before, or undefined. */
  kindOf(name: string): Kind | undefined {
    const command = this.before(name);
    return command ? KINDS[command.command] : undefined;
  }
}

type CommandOf<K extends CommandType> = Extract<
  ResolvedCommand,
  { command: K }
>;

/** A rule of a command, or of the commands of a type. */
export type Rule<C extends ResolvedCommand = ResolvedCommand> = (
  model: Model,
  cmd: C,
) => Problem[];

/** The cells of a mesh and, in a 2D model, the z components of a command. */
const analysis: Rule = (model, cmd) =>
  analysisProblems(cmd, model.analysis, model.rotations);

/** The references of a command point to objects of the right kind, created before. */
const references: Rule = (model, cmd) => {
  const problems: Problem[] = [];
  for (const [field, [refKind, isList]] of Object.entries(
    REFERENCES[cmd.command] ?? {},
  )) {
    const value = valueAt(cmd, field);
    if (value === undefined) continue;
    const kinds = kindsOf(refKind);
    const text = kinds.map(kindName).join(" or ");
    // a name once, also one that a list repeats, e.g. a step of a job (#331)
    for (const ref of isList ? new Set(value as string[]) : [value as string]) {
      const other = model.kindOf(ref);
      if (other === undefined) {
        problems.push({
          message: `${cmd.command} '${cmd.name}' references unknown ${text} '${ref}' in '${field}'.`,
          field,
        });
      } else if (!kinds.includes(other)) {
        problems.push({
          message: `'${ref}' in '${field}' of '${cmd.name}' is a ${kindName(other)}, not a ${text}.`,
          field,
        });
      }
    }
  }
  return problems;
};

/** A command of which a model has at most one. */
const single: Rule = (model, cmd) =>
  SINGLE.includes(cmd.command) &&
  [...model.defined.values()].some(([, c]) => c.command === cmd.command)
    ? [{ message: `only one ${cmd.command} is allowed.` }]
    : [];

/** A name that the generated script uses. */
const reservedName: Rule = (_, cmd) => {
  const problem = nameProblem(cmd.name);
  return problem?.endsWith("reserved for the generated script.")
    ? [{ message: problem, field: "name" }]
    : [];
};

/** A name of an object before. */
const duplicateName: Rule = (model, cmd) => {
  const previous = model.defined.get(cmd.name);
  return previous
    ? [
        {
          message: `name '${cmd.name}' is already used by commands/${previous[0]}.`,
          field: "name",
        },
      ]
    : [];
};

/** The ramped items of a step are boundaries, load cases, loads or pressures. */
const rampTargets: Rule<CommandOf<"step.add">> = (model, cmd) =>
  (cmd.ramp?.items ?? []).flatMap((item) => {
    const kind = model.kindOf(item.target);
    return kind !== undefined && RAMPED.includes(kind)
      ? []
      : [
          {
            message: `step '${cmd.name}' ramps unknown boundary or load '${item.target}'.`,
            field: "ramp.items",
          },
        ];
  });

/** An item is ramped once by a step. */
const rampTwice: Rule<CommandOf<"step.add">> = (_, cmd) => {
  const targets = (cmd.ramp?.items ?? []).map((item) => item.target);
  const twice = targets.filter((t, i) => targets.indexOf(t) !== i);
  return [...new Set(twice)].sort().map((ref) => ({
    message: `step '${cmd.name}' ramps '${ref}' twice.`,
    field: "ramp.items",
  }));
};

/** The ramp of a boundary with one value per constrained component (#225). */
const rampValues: Rule<CommandOf<"step.add">> = (model, cmd) => {
  const problems: Problem[] = [];
  for (const item of cmd.ramp?.items ?? []) {
    const values = [item.start ?? 0, item.end].filter((v) =>
      Array.isArray(v),
    ) as number[][];
    const target = model.before(item.target);
    if (!values.length || !target) continue;
    if (target.command !== "boundary.add") {
      problems.push({
        message: `step '${cmd.name}' ramps '${item.target}' with ${countOf(values[0].length, "value")}: only a boundary ramps one value per constrained component.`,
        field: "ramp.items",
      });
      continue;
    }
    const constrained = target.constrained.length;
    const counts = [
      ...new Set(
        values.filter((v) => v.length !== constrained).map((v) => v.length),
      ),
    ].sort((a, b) => a - b);
    for (const count of counts) {
      problems.push({
        message: `step '${cmd.name}' ramps '${item.target}' with ${countOf(count, "value")}, but the boundary constrains ${countOf(constrained, "component")}.`,
        field: "ramp.items",
      });
    }
  }
  return problems;
};

/** A step ramps no boundary or load case that is off in it (#393). */
const rampOff: Rule<CommandOf<"step.add">> = (model, cmd) => {
  const boundaries = cmd.boundaries;
  if (!boundaries) return [];
  return (cmd.ramp?.items ?? [])
    .filter(
      (item) =>
        model.kindOf(item.target) === "boundary" &&
        !boundaries.includes(item.target),
    )
    .map((item) => ({
      message: `step '${cmd.name}' ramps '${item.target}', which is off in it.`,
      field: "ramp.items",
    }));
};

/** A boundary with a value per constrained component (#225). */
const boundaryValues: Rule<CommandOf<"boundary.add">> = (_, cmd) => {
  const constrained = cmd.constrained.length;
  if (!Array.isArray(cmd.value) || cmd.value.length === constrained) return [];
  return [
    {
      message: `boundary '${cmd.name}' has ${countOf(cmd.value.length, "value")}, but it constrains ${countOf(constrained, "component")}.`,
      field: "value",
    },
  ];
};

/** A cell set from tags needs a mesh imported with a tag. */
const cellsetTag: Rule<CommandOf<"cellset.from_tag">> = (model, cmd) => {
  const mesh = model.before(cmd.mesh);
  // a mesh made by a tool has no cell tags (ADR 0019)
  if (mesh?.command === "mesh.generate")
    return [
      {
        message: `cell set '${cmd.name}' uses tag values, but mesh '${mesh.name}' is made by a tool, without cell tags.`,
        field: "mesh",
      },
    ];
  if (mesh?.command !== "mesh.import" && mesh?.command !== "mesh.script")
    return [];
  if (mesh.tag !== undefined) return [];
  return [
    {
      message: `cell set '${cmd.name}' uses tag values, but mesh '${mesh.name}' was imported without a tag.`,
      field: "mesh",
    },
  ];
};

/**
 * A cell set needs a mesh of the model: of a mesh made by a tool, its points and
 * its cells have the dimension of the model; a lower one is a construction mesh
 * (ADR 0019).
 */
const cellsetModelMesh: Rule<
  CommandOf<"cellset.from_tag" | "cellset.from_file">
> = (model, cmd) => {
  const mesh = model.before(cmd.mesh);
  if (mesh?.command !== "mesh.generate") return [];
  const dimension = model.dimensions.get(mesh.name);
  const dim = model.axes.length;
  if (!dimension || modelMesh(dimension, dim)) return [];
  return [
    {
      message: `cell set '${cmd.name}' takes mesh '${mesh.name}' of ${dimension.cell_type} cells (${dimension.cells}D), but a cell set of a ${dim}D model needs ${dim}D cells with ${dim}D points.`,
      field: "mesh",
    },
  ];
};

/** The values of a mesh tool (ADR 0019), at the field of the sections of a circle. */
const meshTool: Rule<CommandOf<"mesh.generate">> = (_, cmd) =>
  toolProblems(cmd).map((problem) => ({
    message: `mesh '${cmd.name}': ${problem}`,
    field: cmd.tool === "Circle" ? "parameters.sections" : "parameters.b",
  }));

/**
 * The inputs of an operation of the mesh tools are meshes made by tools before,
 * whose dimensions fit the operation (ADR 0019).
 */
const meshInputs: Rule<CommandOf<"mesh.generate">> = (model, cmd) => {
  const inputs = (cmd as { inputs?: string[] }).inputs ?? [];
  const problems = inputs.flatMap((name) => {
    const mesh = model.before(name);
    return mesh && mesh.command !== "mesh.generate"
      ? [`${cmd.tool} takes meshes made by tools; '${name}' is not.`]
      : [];
  });
  problems.push(...inputProblems(cmd, model.dimensions));
  return problems.map((problem) => ({
    message: `mesh '${cmd.name}': ${problem}`,
    field:
      problem.includes("axis") || problem.includes("rotate")
        ? "parameters.axis"
        : "inputs",
  }));
};

/** The material of a section, if it is defined before. */
function materialOf(model: Model, section: CommandOf<"section.add">) {
  const material = model.before(section.material);
  return material?.command === "material.add" ? material : undefined;
}

/**
 * The material fits the formulation of the section (ADR 0024): by `material` of the
 * formulation registry, its volumetric part. The message names a formulation that
 * fits.
 */
const sectionMaterial: Rule<CommandOf<"section.add">> = (model, cmd) => {
  const material = materialOf(model, cmd);
  const formulation = formulationOf(cmd.formulation);
  if (!material || !formulation || fits(formulation, material)) return [];
  return [
    {
      message: `section '${cmd.name}' uses ${misfit(formulation, material)}`,
      field: "formulation",
    },
  ];
};

/**
 * Why a formulation does not take a material, and the formulations that do: of a
 * material with a volumetric part of its own (`u`), the isochoric part of a strain
 * energy (`u-p-J`, #417, #191) or without a volumetric part (`u-isochoric`, #241).
 */
function misfit(
  formulation: Formulation,
  material: CommandOf<"material.add">,
): string {
  const { name } = formulation;
  const what = `${material.model} '${material.name}'`;
  if (formulation.material === "volumetric")
    return (
      `the displacement formulation with ${what} without a bulk modulus. Add ` +
      `'bulk' to the material, use '${first("isochoric")}', or ` +
      `'${first("none")}' for a material without a volumetric part, e.g. air ` +
      `as a third medium.`
    );
  if (formulation.material === "none")
    return (
      `the formulation ${name} with ${what}, which has a volumetric part. Use ` +
      `'${first("volumetric")}'.`
    );
  const displacement = first("volumetric");
  if (strainBased(material))
    return (
      `the ${name} formulation with the strain-based ${what}. Use the ` +
      `displacement formulation '${displacement}'.`
    );
  const optionalBulk = MATERIAL_MODELS.find(
    (m) => m.name === material.model,
  )?.optionalBulk;
  return optionalBulk
    ? `the ${name} formulation with ${what}, which has a volumetric part (its ` +
        `bulk modulus). Remove 'bulk' from the material, or use the displacement ` +
        `formulation '${displacement}'.`
    : `the ${name} formulation with ${what}, which is compressible. Use ` +
        `'${displacement}', or a nearly incompressible model without a bulk modulus.`;
}

/** The axes of a load case, at the field of the error of the form. */
const loadcase: Rule<CommandOf<"loadcase.add">> = (_, cmd) => {
  const [field] = Object.keys(loadcaseFieldErrors(cmd));
  return loadcaseProblems(cmd).map((message) => ({ message, field }));
};

/**
 * Control points (and reference points of rigid surfaces, #219) at the same
 * coordinates are merged by the script.
 */
const vertexCoordinates: Rule<CommandOf<Vertex>> = (model, cmd) => {
  for (const [, other] of model.defined.values()) {
    if (
      (other.command === "point.add" || other.command === "rigid.add") &&
      other.coordinates.every((x, k) => x === cmd.coordinates[k])
    )
      return [
        {
          message: `${VERTICES[cmd.command]} '${cmd.name}' is at the coordinates of ${VERTICES[other.command]} '${other.name}': the script merges them.`,
          field: "coordinates",
        },
      ];
  }
  return [];
};

/** The points of a contact are points of the sections (#220). */
const contactPoints: Rule<CommandOf<"contact.add">> = (model, cmd) => {
  const other = model.before(cmd.points);
  return other?.command === "point.add"
    ? [
        {
          message: `contact '${cmd.name}' takes the control point '${other.name}': a contact needs points of the sections.`,
          field: "points",
        },
      ]
    : [];
};

/** The normal of a plane and the axis of a cylinder of a rigid surface. */
const rigidShape: Rule<CommandOf<"rigid.add">> = (_, cmd) => {
  const shape = cmd.shape as { normal?: number[]; axis?: number[] };
  const labels = [
    ["normal", "a normal"],
    ["axis", "an axis"],
  ] as const;
  return labels.flatMap(([key, label]) => {
    const vector = shape[key];
    return vector && vector.every((x) => x === 0)
      ? [
          {
            message: `rigid surface '${cmd.name}' has ${label} of zero length.`,
            field: `shape.${key}`,
          },
        ]
      : [];
  });
};

/**
 * A rotation point needs all components of the center point (x and y of a 2D
 * model, #175).
 */
const rotationComponents: Rule<CommandOf<"mpc.add">> = (model, cmd) => {
  const { axes } = model;
  if (
    cmd.rotation === undefined ||
    (new Set(cmd.constrained).size === axes.length &&
      axes.every((a) => cmd.constrained.includes(a as "x" | "y" | "z")))
  )
    return [];
  const components = axes.length === 2 ? "x and y" : "x, y and z";
  return [
    {
      message: `constraint '${cmd.name}' with a rotation point connects all components ${components}.`,
      field: "constrained",
    },
  ];
};

/** The parameters of a material. */
const material: Rule<CommandOf<"material.add">> = (_, cmd) =>
  materialProblems(cmd).map((problem) => ({
    message: `material '${cmd.name}': ${problem.message}`,
    field: problem.field,
  }));

/** The value and the range of a parameter of the model (#180). */
const parameter: Rule<CommandOf<"parameter.add">> = (_, cmd) =>
  parameterProblems(cmd).map((problem) => ({
    message: `parameter '${cmd.name}': ${problem.message}`,
    field: problem.field,
  }));

/**
 * The components of a control point with a boundary (also of a point set that
 * selects it, e.g. of a plane through it, #222) or a constraint (as the center
 * point, or all of them as the rotation point).
 */
function fixedComponents(model: Model, vertex: CommandOf<Vertex>): Set<string> {
  const fixed = new Set<string>();
  for (const c of model.commands) {
    if (c.command === "boundary.add") {
      const select = model.selects.get(c.pointset);
      if (
        c.pointset === vertex.name ||
        (select !== undefined && selectsPoint(select, vertex.coordinates))
      )
        c.constrained.forEach((a) => fixed.add(a));
    } else if (c.command === "mpc.add") {
      if (c.center === vertex.name) c.constrained.forEach((a) => fixed.add(a));
      if (c.rotation === vertex.name) AXES.forEach((a) => fixed.add(a));
    }
  }
  return fixed;
}

/**
 * A control point has no stiffness of its own: its components need a boundary or
 * a constraint; the reference point of a rigid surface needs boundaries (#219).
 * Checked after all commands.
 */
const vertexStiffness: Rule<CommandOf<Vertex>> = (model, cmd) => {
  const fixed = fixedComponents(model, cmd);
  const missing = model.axes.filter((a) => !fixed.has(a));
  if (!missing.length) return [];
  const components =
    missing.length > 1
      ? `${missing.slice(0, -1).join(", ")} and ${missing.at(-1)}`
      : missing[0];
  return [
    {
      message:
        cmd.command === "rigid.add"
          ? `rigid surface '${cmd.name}' has no stiffness in ${components}: its ` +
            "reference point needs a boundary of these components."
          : `control point '${cmd.name}' has no stiffness in ${components}: it ` +
            "needs a boundary or a multi-point constraint of these components.",
    },
  ];
};

type Rules = { [K in CommandType]?: readonly Rule<CommandOf<K>>[] };

/** The rules of every command: before and after the rules of its type. */
export const FIRST: readonly Rule[] = [analysis, references];
export const LAST: readonly Rule[] = [single, reservedName, duplicateName];

/** The rules of a command type, in this order. */
export const RULES: Rules = {
  "step.add": [rampTargets, rampTwice, rampValues, rampOff],
  "boundary.add": [boundaryValues],
  "mesh.generate": [meshTool, meshInputs],
  "cellset.from_tag": [cellsetTag, cellsetModelMesh],
  "cellset.from_file": [cellsetModelMesh],
  "section.add": [sectionMaterial],
  "loadcase.add": [loadcase],
  "point.add": [vertexCoordinates],
  "rigid.add": [vertexCoordinates, rigidShape],
  "contact.add": [contactPoints],
  "mpc.add": [rotationComponents],
  "material.add": [material],
  "parameter.add": [parameter],
};

/** The rules of a command type that are checked after all commands. */
export const AFTER: Rules = {
  "point.add": [vertexStiffness],
  "rigid.add": [vertexStiffness],
};

/** The rules of the type of a command (the rules of all types as a union). */
const rulesOf = (rules: Rules, cmd: ResolvedCommand) =>
  (rules[cmd.command] ?? []) as readonly Rule[];

/**
 * The issues of the commands of a command list (with the values of the
 * expressions of its parameters), like `problems()` of felupe_studio.rules.
 */
export function problems(commands: readonly ResolvedCommand[]): Issue[] {
  const model = new Model(commands);
  const issues: Issue[] = [];
  const check = (rules: readonly Rule[], cmd: ResolvedCommand, i: number) => {
    for (const rule of rules)
      for (const { message, field } of rule(model, cmd))
        issues.push({
          index: i,
          name: cmd.name,
          message: `commands/${i}: ${message}`,
          ...(field ? { field } : {}),
        });
  };
  commands.forEach((cmd, i) => {
    check([...FIRST, ...rulesOf(RULES, cmd), ...LAST], cmd, i);
    if (!model.defined.has(cmd.name)) model.defined.set(cmd.name, [i, cmd]);
  });
  commands.forEach((cmd, i) => check(rulesOf(AFTER, cmd), cmd, i));
  return issues;
}
