// Browser tree derived from the command list, the validation issues and the
// optional check report of the worker.
import type { CheckReport } from "./checks";
import type { Command } from "./commands";
import type { Issue, Kind } from "./validate";
import { KINDS } from "./validate";
import { describeLoadcase } from "./loadcases";
import { describeSolver } from "./solvers";
import { describeSymmetry } from "./symmetry";
import {
  boundaryQuantity,
  rampedQuantity,
  unitOf,
  unitsOf,
  unitsText,
  valueWithUnit,
} from "./units";
import { MATERIAL_MODELS } from "./materials";
import { describeParameter } from "./parameters";

export interface TreeNode {
  /** Unique id: the object name, or `group:<kind>` for a group. */
  id: string;
  label: string;
  kind: Kind | "group";
  /** Short description, e.g. the file of a mesh or the model of a material. */
  detail?: string;
  /** Number of children of a group. */
  count?: number;
  /** An icon other than the one of the kind, e.g. of a control point. */
  icon?: string;
  /** Validation issues and check messages of this object. */
  issues: string[];
  children: TreeNode[];
}

/**
 * The groups of the browser: by kind, the control points and the rigid surfaces
 * (#219) in groups of their own.
 */
const GROUPS: { kind: Kind | "point" | "contact"; label: string }[] = [
  { kind: "settings", label: "Settings" },
  { kind: "parameter", label: "Parameters" },
  { kind: "mesh", label: "Meshes" },
  { kind: "merge", label: "Merge" },
  { kind: "pointset", label: "Point Sets" },
  { kind: "point", label: "Points" },
  { kind: "rigid", label: "Rigid Surfaces" },
  { kind: "faceset", label: "Face Sets" },
  { kind: "material", label: "Materials" },
  { kind: "section", label: "Sections" },
  { kind: "boundary", label: "Boundaries" },
  { kind: "constraint", label: "Constraints" },
  { kind: "contact", label: "Contacts" },
  { kind: "load", label: "Loads" },
  { kind: "pressure", label: "Pressures" },
  { kind: "step", label: "Steps" },
  { kind: "job", label: "Jobs" },
];

const AXES = ["x", "y", "z"] as const;

/** The commands of the model and its units, for the details of a command. */
interface DetailContext {
  commands: readonly Command[];
  units: ReturnType<typeof unitsOf>;
  length: string | undefined;
}

type Detail<C extends Command["command"]> = (
  cmd: Extract<Command, { command: C }>,
  context: DetailContext,
) => string;

/** The parts of a detail that are given, joined by a dot. */
const joined = (...parts: unknown[]) => parts.filter(Boolean).join(" · ");

/** A point as text with the unit of length, e.g. `(0, 1, 0) mm`. */
const at = (coordinates: readonly unknown[], length: string | undefined) =>
  valueWithUnit(`(${coordinates.join(", ")})`, length);

/** The constrained components, e.g. `x, z`, in the order of the axes. */
const components = (constrained: readonly string[]) =>
  AXES.filter((a) => constrained.includes(a)).join(", ");

/** One value, or one value per constrained component of a boundary (#225). */
const valueText = (v: unknown) =>
  Array.isArray(v) ? `(${v.join(", ")})` : String(v);

const pointsetDetail: Detail<"pointset.add"> = ({ select }, { length }) => {
  if ("value" in select)
    return `${select.axis} == ${valueWithUnit(String(select.value), length)}`;
  if ("bound" in select) return `${select.axis} == ${select.bound}`;
  if ("radius" in select) {
    const { radius, axis, center } = select;
    const through = center?.some((c) => c !== 0)
      ? ` through ${at(center, length)}`
      : "";
    return `r = ${valueWithUnit(String(radius), length)} about ${axis}${through}`;
  }
  if ("points" in select) {
    const [first, ...rest] = select.points;
    return rest.length
      ? `${select.points.length} nodes`
      : `node ${at(first, length)}`;
  }
  if ("surface" in select) return "outer surface";
  if ("section" in select) return `of ${select.section}`;
  return `${select.ids.length} points`;
};

const rigidDetail: Detail<"rigid.add"> = (cmd, { length }) => {
  const shape = cmd.shape as {
    normal?: number[];
    radius?: number;
    axis?: number[];
    inside?: boolean;
  };
  const where = `at ${at(cmd.coordinates, length)}`;
  if (shape.normal) return `plane n = (${shape.normal.join(", ")}) · ${where}`;
  return [
    `cylinder r = ${valueWithUnit(String(shape.radius), length)}`,
    `axis (${shape.axis!.join(", ")})`,
    ...(shape.inside ? ["inside"] : []),
    where,
  ].join(" · ");
};

const facesetDetail: Detail<"faceset.add"> = (
  { section, select },
  { length },
) => {
  if ("axis" in select)
    return `${section} · ${select.axis} == ${valueWithUnit(String(select.value), length)}`;
  const n = select.centers.length;
  return `${section} · ${n} ${n === 1 ? "face" : "faces"}`;
};

const boundaryDetail: Detail<"boundary.add"> = (cmd, { commands, units }) => {
  // one value for all constrained components, or one per component (#225)
  const value = cmd.value ?? 0;
  const zero = Array.isArray(value) ? !value.some((v) => v !== 0) : value === 0;
  const unit = unitOf(boundaryQuantity(commands, cmd.pointset), units);
  const text = zero ? "" : ` = ${valueWithUnit(valueText(value), unit)}`;
  return `${cmd.pointset} · ${components(cmd.constrained)}${text}`;
};

const stepDetail: Detail<"step.add"> = ({ ramp }, { commands, units }) => {
  if (!ramp) return "no ramp";
  const items = ramp.items.map((i) => {
    const unit = unitOf(rampedQuantity(commands, i.target), units);
    const from = valueText(i.start ?? 0);
    return `${i.target}: ${from} → ${valueWithUnit(valueText(i.end), unit)}`;
  });
  return `${items.join(", ")} (${ramp.num})`;
};

/** The details of the commands by their type: short texts in the browser. */
const DETAILS: { [C in Command["command"]]: Detail<C> } = {
  "model.settings": (cmd) =>
    joined(
      cmd.analysis === "plane-strain"
        ? "plane strain"
        : cmd.analysis === "axisymmetric" && "axisymmetric",
      cmd.units ? unitsText(cmd.units) : "no units",
    ),
  "parameter.add": (cmd, { units }) => describeParameter(cmd, units),
  "mesh.import": (cmd) =>
    joined(
      cmd.file,
      cmd.tag && `tag ${cmd.tag}`,
      cmd.scale !== undefined && cmd.scale !== 1 && `× ${cmd.scale}`,
    ),
  "mesh.script": (cmd) =>
    joined(
      cmd.item ? `${cmd.file} [${cmd.item}]` : cmd.file,
      cmd.tag && `tag ${cmd.tag}`,
    ),
  "mesh.merge": (cmd) => `decimals = ${cmd.decimals}`,
  "cellset.from_tag": (cmd) => `tag = ${cmd.value}`,
  "cellset.from_file": () => "all cells",
  "material.add": (cmd) =>
    MATERIAL_MODELS.find((m) => m.name === cmd.model)?.label ?? cmd.model,
  "section.add": (cmd) =>
    joined(
      cmd.material,
      cmd.formulation,
      cmd.volumetric && cmd.volumetric !== "volume-ratio" && cmd.volumetric,
    ),
  "pointset.add": pointsetDetail,
  "point.add": (cmd, { length }) => `control ${at(cmd.coordinates, length)}`,
  "rigid.add": rigidDetail,
  "faceset.add": facesetDetail,
  "load.add": (cmd, { units }) =>
    `${cmd.points} · ${valueWithUnit(`(${cmd.force.join(", ")})`, unitOf("force", units))}`,
  "pressure.add": (cmd, { units }) =>
    `${cmd.faces} · ${valueWithUnit(String(cmd.pressure), unitOf("stress", units))}`,
  "contact.add": (cmd) =>
    joined(
      `${cmd.points} → ${cmd.surface}`,
      cmd.friction && `μ = ${cmd.friction}`,
    ),
  "mpc.add": (cmd) =>
    joined(
      `${cmd.points} → ${cmd.center}`,
      cmd.constrained.length < 3 && components(cmd.constrained),
      cmd.rotation && `rotation ${cmd.rotation}`,
    ),
  "boundary.add": boundaryDetail,
  "loadcase.add": (cmd) => describeLoadcase(cmd),
  "symmetry.add": (cmd, { length }) => describeSymmetry(cmd, length),
  "step.add": stepDetail,
  "job.add": (cmd) =>
    joined(
      cmd.steps.join(", "),
      cmd.curve && `curve ${cmd.curve}`,
      cmd.cutback && "cutback",
      describeSolver(cmd),
      cmd.tol !== undefined && `tol ${cmd.tol}`,
      cmd.maxiter !== undefined && `maxiter ${cmd.maxiter}`,
    ),
};

function detail(cmd: Command, commands: readonly Command[]): string {
  // the values with the units of the model (#132)
  const units = unitsOf(commands);
  const describe = DETAILS[cmd.command] as Detail<Command["command"]>;
  return describe(cmd, { commands, units, length: unitOf("length", units) });
}

/** The issues and the check messages of the objects, by their names. */
function messagesOf(issues: readonly Issue[], report?: CheckReport) {
  const messages = new Map<string, string[]>();
  const note = (name: string, message: string) =>
    messages.set(name, [...(messages.get(name) ?? []), message]);

  for (const issue of issues) note(issue.name, issue.message);
  for (const u of report?.cells.unassigned ?? []) {
    note(u.mesh, `${u.cells} cells are not assigned to a section.`);
  }
  for (const m of report?.cells.multiple ?? []) {
    for (const section of m.sections) {
      note(
        section,
        `${m.cells} cells of mesh '${m.mesh}' are in more than one section.`,
      );
    }
  }
  for (const face of report?.interfaces ?? []) {
    if (face.hanging === 0) continue;
    const [a, b] = face.sections;
    note(a, `${face.hanging} hanging points at the interface to '${b}'.`);
    note(b, `${face.hanging} hanging points at the interface to '${a}'.`);
  }
  return messages;
}

/** The group of an object: its kind, unless it has a group of its own. */
function groupOf(cmd: Command, kind: Kind): Kind | "point" | "contact" {
  if (cmd.command === "point.add") return "point";
  if (cmd.command === "contact.add") return "contact";
  // cell sets without a valid mesh are shown at the top of the mesh group
  if (kind === "cellset") return "mesh";
  // symmetry planes are boundaries of all steps (#186)
  if (kind === "symmetry") return "boundary";
  return kind;
}

/**
 * The groups of the settings, the merge setting, the control points and the face
 * sets only if they are used.
 */
const OPTIONAL = new Set([
  "group:settings",
  "group:parameter",
  "group:merge",
  "group:point",
  "group:rigid",
  "group:contact",
  "group:faceset",
  "group:pressure",
  "group:constraint",
  "group:load",
]);

/** Derive the browser tree. Cell sets are children of their mesh. */
export function deriveTree(
  commands: readonly Command[],
  issues: readonly Issue[] = [],
  report?: CheckReport,
): TreeNode[] {
  const messages = messagesOf(issues, report);
  const node = (cmd: Command): TreeNode => ({
    id: cmd.name,
    label: cmd.name,
    kind: KINDS[cmd.command],
    ...(cmd.command === "point.add" ? { icon: "point" } : {}),
    ...(cmd.command === "contact.add" ? { icon: "contact" } : {}),
    detail: detail(cmd, commands),
    issues: messages.get(cmd.name) ?? [],
    children: [],
  });

  const nodes = new Map<string, TreeNode>();
  for (const cmd of commands) {
    if (!nodes.has(cmd.name)) nodes.set(cmd.name, node(cmd));
  }

  const groups = new Map(
    GROUPS.map(({ kind, label }) => [
      kind,
      {
        id: `group:${kind}`,
        label,
        kind: "group" as const,
        issues: [],
        children: [] as TreeNode[],
      },
    ]),
  );

  const placed = new Set<string>();
  for (const cmd of commands) {
    if (placed.has(cmd.name)) continue;
    placed.add(cmd.name);
    const child = nodes.get(cmd.name)!;
    const mesh = cmd.command.startsWith("cellset.")
      ? nodes.get((cmd as { mesh: string }).mesh)
      : undefined;
    if (mesh?.kind === "mesh") mesh.children.push(child);
    else groups.get(groupOf(cmd, child.kind as Kind))!.children.push(child);
  }

  return [...groups.values()]
    .filter((g) => !OPTIONAL.has(g.id) || g.children.length > 0)
    .map((g) => ({ ...g, count: g.children.length }));
}
