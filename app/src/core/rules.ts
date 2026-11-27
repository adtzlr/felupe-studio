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
  tagInputs,
  tagNames,
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
  MOVED,
  RAMPED,
  REFERENCE_NAMES,
  REFERENCES,
  SINGLE,
  valueAt,
  type Vertex,
  VERTICES,
} from "./kinds";
import { norm, orthogonal, vectors } from "./cartesian";
import { hasAxis } from "./cylindrical";
import { directionsOf, isLocal, NAMES } from "./directions";
import { loadcaseFieldErrors, loadcaseProblems } from "./loadcases";
import {
  first,
  fits,
  type Formulation,
  formulationOf,
  sibling,
} from "./formulations";
import {
  isFunction,
  isMaterial,
  MATERIAL_MODELS,
  type MaterialCommand,
  type MaterialFunction,
  materialProblems,
  MULLINS,
  strainBased,
} from "./materials";
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
  private tags?: Map<string, string>;

  constructor(readonly commands: readonly ResolvedCommand[]) {
    this.analysis = analysisOf(commands);
    this.axes = is2d(this.analysis) ? AXES.slice(0, 2) : AXES;
    this.rotations = new Set(
      commands.flatMap((c) =>
        c.command === "mpc.add" && c.rotation !== undefined ? [c.rotation] : [],
      ),
    );
  }

  /** The dimensions of the meshes of the model, by their names (ADR 0019). */
  get dimensions(): Map<string, MeshDimension> {
    this.made ??= dimensions(this.commands);
    return this.made;
  }

  /**
   * The names of the cell tags of the meshes with cell tags, also of those made by
   * tools (#438).
   */
  get tagNames(): Map<string, string> {
    this.tags ??= tagNames(this.commands);
    return this.tags;
  }

  /** The selections of the point sets, by their names. */
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
    const text =
      REFERENCE_NAMES[`${cmd.command} ${field}`] ??
      kinds.map(kindName).join(" or ");
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

/** The names of the commands of the kind constraint in the messages. */
const CONSTRAINTS: Partial<Record<CommandType, string>> = {
  "mpc.add": "multi-point constraint",
  ...NAMES,
  "contact.add": "contact",
  "bodycontact.add": "contact between bodies",
};

/** What a step ramps, and what a curve is of, in the messages (#421, #422). */
const RAMPS =
  "a boundary, a load case, a Cartesian or cylindrical constraint, a point load or a pressure";
const CURVES =
  "a boundary, a load case, a Cartesian or cylindrical constraint or a point load";

/**
 * Whether an object is a boundary, a load or a pressure, or a constraint that a
 * step ramps and that is the curve of a job (#421, #422).
 */
function moved(model: Model, name: string): boolean {
  const command = model.before(name);
  return (
    command !== undefined &&
    (RAMPED.includes(KINDS[command.command]) || MOVED.includes(command.command))
  );
}

/**
 * The ramped items of a step are boundaries, load cases, Cartesian or cylindrical
 * constraints, loads or pressures.
 */
const rampTargets: Rule<CommandOf<"step.add">> = (model, cmd) =>
  (cmd.ramp?.items ?? []).flatMap((item) => {
    if (moved(model, item.target)) return [];
    const target = model.before(item.target);
    const constraint = target && CONSTRAINTS[target.command];
    return [
      {
        message: constraint
          ? `step '${cmd.name}' ramps the ${constraint} '${item.target}': a step ramps ${RAMPS}.`
          : `step '${cmd.name}' ramps unknown boundary or load '${item.target}'.`,
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

/**
 * The commands that ramp one value per constrained component or direction, with
 * their names in the messages (#225, #421, #422).
 */
const PER_COMPONENT: Partial<Record<CommandType, [string, string]>> = {
  "boundary.add": ["boundary", "component"],
  "cartesian.add": [NAMES["cartesian.add"], "direction"],
  "cylindrical.add": [NAMES["cylindrical.add"], "direction"],
};

/**
 * The ramp of a boundary with one value per constrained component (#225), or of a
 * Cartesian or cylindrical constraint with one value per constrained direction
 * (#421, #422).
 */
const rampValues: Rule<CommandOf<"step.add">> = (model, cmd) => {
  const problems: Problem[] = [];
  for (const item of cmd.ramp?.items ?? []) {
    const values = [item.start ?? 0, item.end].filter((v) =>
      Array.isArray(v),
    ) as number[][];
    const target = model.before(item.target);
    if (!values.length || !target) continue;
    const names = PER_COMPONENT[target.command];
    if (!names || !("constrained" in target)) {
      problems.push({
        message: `step '${cmd.name}' ramps '${item.target}' with ${countOf(values[0].length, "value")}: only a boundary, a Cartesian constraint or a cylindrical constraint ramps one value per constrained component.`,
        field: "ramp.items",
      });
      continue;
    }
    const [kind, word] = names;
    const constrained = target.constrained.length;
    const counts = [
      ...new Set(
        values.filter((v) => v.length !== constrained).map((v) => v.length),
      ),
    ].sort((a, b) => a - b);
    for (const count of counts) {
      problems.push({
        message: `step '${cmd.name}' ramps '${item.target}' with ${countOf(count, "value")}, but the ${kind} constrains ${countOf(constrained, word)}.`,
        field: "ramp.items",
      });
    }
  }
  return problems;
};

/** The field of a step that chooses the objects of a kind (#393). */
const CHOSEN: Partial<Record<Kind, "boundaries" | "constraints">> = {
  boundary: "boundaries",
  constraint: "constraints",
};

/**
 * A step ramps no boundary, load case or constraint in local coordinates that is
 * off in it (#393, #421, #422).
 */
const rampOff: Rule<CommandOf<"step.add">> = (model, cmd) =>
  (cmd.ramp?.items ?? [])
    .filter((item) => {
      const kind = model.kindOf(item.target);
      const field = kind && CHOSEN[kind];
      const chosen: readonly string[] | undefined = field && cmd[field];
      return chosen !== undefined && !chosen.includes(item.target);
    })
    .map((item) => ({
      message: `step '${cmd.name}' ramps '${item.target}', which is off in it.`,
      field: "ramp.items",
    }));

/**
 * The curve of a job is a boundary, a load case, a point load or a Cartesian or
 * cylindrical constraint, not another constraint (#421, #422).
 */
const curveKind: Rule<CommandOf<"job.add">> = (model, cmd) => {
  const target = cmd.curve === undefined ? undefined : model.before(cmd.curve);
  const constraint = target && CONSTRAINTS[target.command];
  if (!constraint || moved(model, cmd.curve as string)) return [];
  return [
    {
      message: `job '${cmd.name}' records the curve of the ${constraint} '${cmd.curve}': a curve is of ${CURVES}.`,
      field: "curve",
    },
  ];
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

/**
 * The base vectors of a Cartesian constraint have a length and are orthogonal
 * (#421); e2 of a 2D model is e1 turned by 90° (a rule of the analysis).
 */
const cartesianVectors: Rule<CommandOf<"cartesian.add">> = (model, cmd) => {
  const [e1, e2] = vectors(cmd);
  const zero = (
    [
      ["e1", e1],
      ["e2", e2],
    ] as const
  ).filter(([, v]) => norm(v) === 0);
  if (zero.length)
    return zero.map(([name]) => ({
      message: `Cartesian constraint '${cmd.name}' has ${name} of zero length.`,
      field: name,
    }));
  return model.axes.length === 3 && !orthogonal(e1, e2)
    ? [
        {
          message: `Cartesian constraint '${cmd.name}' has e1 and e2 that are not orthogonal.`,
          field: "e2",
        },
      ]
    : [];
};

/**
 * A Cartesian or cylindrical constraint with a value per constrained direction
 * (#421, #422).
 */
const directionValues: Rule<CommandOf<"cartesian.add" | "cylindrical.add">> = (
  _,
  cmd,
) => {
  const constrained = cmd.constrained.length;
  if (!Array.isArray(cmd.value) || cmd.value.length === constrained) return [];
  return [
    {
      message: `${NAMES[cmd.command]} '${cmd.name}' has ${countOf(cmd.value.length, "value")}, but it constrains ${countOf(constrained, "direction")}.`,
      field: "value",
    },
  ];
};

/** The axis of a cylindrical constraint has a length (#422). */
const cylindricalAxis: Rule<CommandOf<"cylindrical.add">> = (_, cmd) =>
  hasAxis(cmd)
    ? []
    : [
        {
          message: `cylindrical constraint '${cmd.name}' has an axis of zero length.`,
          field: "axis",
        },
      ];

/**
 * A cell set from tags needs a mesh with cell tags: of a file or a script imported
 * with a tag, or made by a tool of such meshes, which keeps their tags (#438). A
 * primitive of the tools has none.
 */
const cellsetTag: Rule<CommandOf<"cellset.from_tag">> = (model, cmd) => {
  const mesh = model.before(cmd.mesh);
  if (!mesh || model.tagNames.has(mesh.name)) return [];
  const start = `cell set '${cmd.name}' uses tag values, but mesh '${mesh.name}'`;
  const problem = (message: string) => [{ message, field: "mesh" }];
  if (mesh.command === "mesh.import" || mesh.command === "mesh.script")
    return problem(`${start} was imported without a tag.`);
  if (mesh.command !== "mesh.generate") return [];
  const untagged = tagInputs(mesh).filter((name) => !model.tagNames.has(name));
  if (!untagged.length)
    return problem(`${start} is made by a tool, without cell tags.`);
  const names = untagged.map((name) => `'${name}'`).join(", ");
  const meshes = untagged.length === 1 ? "a mesh" : "meshes";
  return problem(
    `${start} is made by a tool of ${meshes} without cell tags: ${names}.`,
  );
};

/**
 * A cell set needs a mesh of the model: its points and its cells have the dimension
 * of the model; a lower one is a construction mesh (ADR 0019), also of a file or a
 * script with 2D cells in a 3D model (#438).
 */
const cellsetModelMesh: Rule<
  CommandOf<"cellset.from_tag" | "cellset.from_file">
> = (model, cmd) => {
  const mesh = model.before(cmd.mesh);
  if (!mesh) return [];
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
 * The inputs of an operation of the mesh tools are meshes of the model before, made
 * by tools, of files or of scripts (#438), whose dimensions fit the operation (ADR
 * 0019). A rule of the cell type of a mesh of a file or a script that is not given
 * is checked with its read (`readProblems()`).
 */
const meshInputs: Rule<CommandOf<"mesh.generate">> = (model, cmd) => {
  const problems = inputProblems(cmd, model.dimensions);
  return problems.map((problem) => ({
    message: `mesh '${cmd.name}': ${problem}`,
    field:
      problem.includes("axis") || problem.includes("rotate")
        ? "parameters.axis"
        : "inputs",
  }));
};

/**
 * The material of a section, if it is defined before: of the registry, or of a file
 * (ADR 0025).
 */
function materialOf(model: Model, section: CommandOf<"section.add">) {
  const material = model.before(section.material);
  return material && isMaterial(material) ? material : undefined;
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
 * material with a volumetric part of its own (`u`, the three-field variation of
 * #420), the isochoric part of a strain energy (`u-p-J`, #417, #191) or without a
 * volumetric part (`u-isochoric`, #241). A formulation of the same menu that takes
 * the material is named too, e.g. the three-field variation of a nearly
 * incompressible one (#420).
 */
function misfit(formulation: Formulation, material: MaterialCommand): string {
  if (material.command === "material.script")
    return scriptMisfit(formulation, material);
  const { name } = formulation;
  const what = `${material.model} '${material.name}'`;
  const other = sibling(formulation, material);
  // a nearly incompressible formulation, e.g. the three-field variation
  if (formulation.material === "volumetric" && other)
    return (
      `the ${name} formulation with ${what} without a bulk modulus: it takes the ` +
      `volumetric part of the material. Add 'bulk' to the material, or use ` +
      `'${other}' with the bulk modulus of the section.`
    );
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
  const displacement =
    `the displacement formulation '${first("volumetric")}'` +
    (other ? ` or '${other}'` : "");
  if (strainBased(material))
    return `the ${name} formulation with the strain-based ${what}. Use ${displacement}.`;
  const optionalBulk = MATERIAL_MODELS.find(
    (m) => m.name === material.model,
  )?.optionalBulk;
  return optionalBulk
    ? `the ${name} formulation with ${what}, which has a volumetric part (its ` +
        `bulk modulus). Remove 'bulk' from the material, or use ${displacement}.`
    : `the ${name} formulation with ${what}, which is compressible. Use ` +
        `${displacement}, or a nearly incompressible model without a bulk modulus.`;
}

/**
 * Why a formulation does not take a material of a file (ADR 0025), by whether it
 * has a volumetric part of its own (`volumetric` of a constitutive model, the bulk
 * modulus of a strain energy function, #424, always of a strain-based function,
 * #425), and the formulations that take it, like `misfit()` (like `script_misfit` in
 * Python).
 */
function scriptMisfit(
  formulation: Formulation,
  material: Extract<MaterialCommand, { command: "material.script" }>,
): string {
  const { name } = formulation;
  const what = `the material '${material.name}' of '${material.file}'`;
  const other = sibling(formulation, material);
  const fn = isFunction(material);
  // the displacement formulation, or the three-field variation (#420)
  if (formulation.material === "volumetric")
    return (
      `${other ? `the ${name} formulation` : "the displacement formulation"} ` +
      `with ${what} without a volumetric part. Use ` +
      `'${other ?? first("isochoric")}' with the bulk modulus of the section, ` +
      `or ${fn ? "add 'bulk' to the material" : "set 'volumetric' to true if its umat has one"}.`
    );
  // a strain-based function has a volumetric part, like a strain-based model (#425)
  const strain = strainBased(material);
  const remedy = strain
    ? ""
    : fn
      ? ", or remove 'bulk' from the material"
      : ", or set 'volumetric' to false if its umat has none";
  if (formulation.material === "none")
    return (
      `the formulation ${name} with ${what}, which has a volumetric part. Use ` +
      `'${first("volumetric")}'${remedy}.`
    );
  const displacement =
    `the displacement formulation '${first("volumetric")}'` +
    (other ? ` or '${other}'` : "");
  if (strain)
    return `the ${name} formulation with the strain-based material '${material.name}' of '${material.file}'. Use ${displacement}.`;
  return (
    `the ${name} formulation with ${what}, which has a volumetric part. Use ` +
    `${displacement}${remedy}.`
  );
}

// the arguments that the material of a function of a file gives it or takes itself,
// and the message, by its kind: fem.Hyperelastic of a strain energy function (#424)
// and fem.MaterialStrain of a strain-based function (#425) (like `GIVEN` of
// felupe_studio.rules); and the arguments of the Mullins effect (#346)
const GIVEN: Record<
  MaterialFunction["kind"],
  { names: readonly string[]; message: string }
> = {
  hyperelastic: {
    names: ["C", "statevars", "fun", "nstatevars", "parallel"],
    message:
      "fem.Hyperelastic gives C and statevars, and takes fun, nstatevars and " +
      "parallel itself.",
  },
  strain: {
    names: [
      "dε",
      "εn",
      "σn",
      "ζn",
      "tangent",
      "material",
      "dim",
      "statevars",
    ].concat(["framework", "symmetry", "strain_exponent"]),
    message:
      "fem.MaterialStrain gives dε, εn, σn, ζn and tangent, and takes material, " +
      "dim, statevars, framework, symmetry and strain_exponent itself.",
  },
};
const SOFTENING: readonly string[] = [...MULLINS, "material"];

/**
 * The arguments of a function of a file (#424, #425): not those that its material
 * (fem.Hyperelastic or fem.MaterialStrain) gives or takes itself, nor a keyword of
 * Python, nor those of fem.ogden_roxburgh with the Mullins effect, which has a state
 * variable of its own, so the function has none.
 */
const functionArguments: Rule<CommandOf<"material.script">> = (_, cmd) => {
  if (!isFunction(cmd)) return [];
  const what = `material '${cmd.name}'`;
  const given = GIVEN[cmd.kind];
  const mullins = cmd.kind === "hyperelastic" ? cmd.mullins : undefined;
  const problems: Problem[] = [];
  for (const key of Object.keys(cmd.arguments ?? {})) {
    const field = `arguments.${key}`;
    if (given.names.includes(key))
      problems.push({
        message:
          `${what}: '${key}' is not an argument of the function to give: ` +
          given.message,
        field,
      });
    else if (RESERVED_KEYWORDS.has(key))
      problems.push({
        message: `${what}: the argument '${key}' is a keyword of Python.`,
        field,
      });
    else if (mullins && SOFTENING.includes(key))
      problems.push({
        message:
          `${what}: the argument '${key}' is one of the Mullins effect ` +
          "(fem.ogden_roxburgh) too. Rename it in the function, or remove the " +
          "Mullins effect.",
        field,
      });
  }
  if (mullins && cmd.kind === "hyperelastic" && cmd.nstatevars !== undefined)
    problems.push({
      message:
        `${what}: a function with state variables has no Mullins effect, which ` +
        "has a state variable of its own. Remove 'nstatevars' or the Mullins " +
        "effect.",
      field: "nstatevars",
    });
  return problems;
};

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

/** The sections of a contact between bodies, its section first (#462). */
const bodycontactNames = (cmd: CommandOf<"bodycontact.add">) => [
  ...new Set([cmd.section, cmd.primary ?? cmd.section]),
];

/**
 * The point sets of a contact between bodies limit the faces of its sections, so
 * they are points of the sections (#462).
 */
const bodycontactPoints: Rule<CommandOf<"bodycontact.add">> = (model, cmd) =>
  (["points", "points_primary"] as const).flatMap((key) => {
    const name = cmd[key];
    const other = name === undefined ? undefined : model.before(name);
    return other?.command === "point.add"
      ? [
          {
            message: `contact '${cmd.name}' takes the control point '${other.name}': a contact between bodies needs points of its sections.`,
            field: key,
          },
        ]
      : [];
  });

/**
 * A section of the third medium is no surface of a contact between bodies (#462):
 * the third medium fills the gap between bodies instead of a contact.
 */
const bodycontactSections: Rule<CommandOf<"bodycontact.add">> = (model, cmd) =>
  bodycontactNames(cmd).flatMap((name) => {
    const other = model.before(name);
    if (other?.command !== "section.add") return [];
    if (formulationOf(other.formulation)?.group !== "Third medium") return [];
    return [
      {
        message: `contact '${cmd.name}' takes the section '${name}' of the third medium, which fills the gap between bodies instead of a contact.`,
        field: name === cmd.section ? "section" : "primary",
      },
    ];
  });

/**
 * A step that leaves out a section has no contact between bodies of it (#462): the
 * contact acts on both of its sections.
 */
const stepContacts: Rule<CommandOf<"step.add">> = (model, cmd) => {
  const sections = cmd.sections;
  if (sections === undefined) return [];
  return (cmd.constraints ?? []).flatMap((name) => {
    const other = model.before(name);
    if (other?.command !== "bodycontact.add") return [];
    const off = bodycontactNames(other).filter((s) => !sections.includes(s));
    return off.length
      ? [
          {
            message: `step '${cmd.name}' has the contact '${name}' between bodies, but not its section '${off[0]}'.`,
            field: "constraints",
          },
        ]
      : [];
  });
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
    } else if (isLocal(c) && c.points === vertex.name) {
      // a constraint in local coordinates (#421, #422) of all directions of the
      // model: all components
      const constrained: readonly string[] = c.constrained;
      const all = directionsOf(c, model.axes.length);
      if (all.every((d) => constrained.includes(d)))
        AXES.forEach((a) => fixed.add(a));
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
  "step.add": [rampTargets, rampTwice, rampValues, rampOff, stepContacts],
  "job.add": [curveKind],
  "boundary.add": [boundaryValues],
  "cartesian.add": [cartesianVectors, directionValues],
  "cylindrical.add": [cylindricalAxis, directionValues],
  "mesh.generate": [meshTool, meshInputs],
  "cellset.from_tag": [cellsetTag, cellsetModelMesh],
  "cellset.from_file": [cellsetModelMesh],
  "section.add": [sectionMaterial],
  "loadcase.add": [loadcase],
  "point.add": [vertexCoordinates],
  "rigid.add": [vertexCoordinates, rigidShape],
  "contact.add": [contactPoints],
  "bodycontact.add": [bodycontactPoints, bodycontactSections],
  "mpc.add": [rotationComponents],
  "material.add": [material],
  "material.script": [functionArguments],
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
