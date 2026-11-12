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

/** The groups of the browser: by kind, the control points in a group of their own. */
const GROUPS: { kind: Kind | "point"; label: string }[] = [
  { kind: "settings", label: "Settings" },
  { kind: "parameter", label: "Parameters" },
  { kind: "mesh", label: "Meshes" },
  { kind: "merge", label: "Merge" },
  { kind: "pointset", label: "Point Sets" },
  { kind: "point", label: "Points" },
  { kind: "faceset", label: "Face Sets" },
  { kind: "material", label: "Materials" },
  { kind: "section", label: "Sections" },
  { kind: "boundary", label: "Boundaries" },
  { kind: "constraint", label: "Constraints" },
  { kind: "load", label: "Loads" },
  { kind: "pressure", label: "Pressures" },
  { kind: "step", label: "Steps" },
  { kind: "job", label: "Jobs" },
];

const AXES = ["x", "y", "z"] as const;

function detail(cmd: Command, commands: readonly Command[]): string {
  // the values with the units of the model (#132)
  const units = unitsOf(commands);
  const length = unitOf("length", units);
  switch (cmd.command) {
    case "model.settings":
      return cmd.units ? unitsText(cmd.units) : "no units";
    case "parameter.add":
      return describeParameter(cmd, units);
    case "mesh.import":
      return [
        cmd.file,
        cmd.tag && `tag ${cmd.tag}`,
        cmd.scale !== undefined && cmd.scale !== 1 && `× ${cmd.scale}`,
      ]
        .filter(Boolean)
        .join(" · ");
    case "mesh.script":
      return [
        cmd.item ? `${cmd.file} [${cmd.item}]` : cmd.file,
        cmd.tag && `tag ${cmd.tag}`,
      ]
        .filter(Boolean)
        .join(" · ");
    case "mesh.merge":
      return `decimals = ${cmd.decimals}`;
    case "cellset.from_tag":
      return `tag = ${cmd.value}`;
    case "cellset.from_file":
      return "all cells";
    case "material.add":
      return (
        MATERIAL_MODELS.find((m) => m.name === cmd.model)?.label ?? cmd.model
      );
    case "section.add":
      return [
        cmd.material,
        cmd.formulation,
        cmd.volumetric && cmd.volumetric !== "volume-ratio" && cmd.volumetric,
      ]
        .filter(Boolean)
        .join(" · ");
    case "pointset.add":
      if ("value" in cmd.select)
        return `${cmd.select.axis} == ${valueWithUnit(String(cmd.select.value), length)}`;
      if ("bound" in cmd.select)
        return `${cmd.select.axis} == ${cmd.select.bound}`;
      if ("radius" in cmd.select) {
        const { radius, axis, center } = cmd.select;
        const through = center?.some((c) => c !== 0)
          ? ` through ${valueWithUnit(`(${center.join(", ")})`, length)}`
          : "";
        return `r = ${valueWithUnit(String(radius), length)} about ${axis}${through}`;
      }
      if ("points" in cmd.select) {
        const [first, ...rest] = cmd.select.points;
        return rest.length
          ? `${cmd.select.points.length} nodes`
          : `node ${valueWithUnit(`(${first.join(", ")})`, length)}`;
      }
      return `${cmd.select.ids.length} points`;
    case "point.add":
      return `control ${valueWithUnit(`(${cmd.coordinates.join(", ")})`, length)}`;
    case "faceset.add":
      return `${cmd.section} · ${
        "axis" in cmd.select
          ? `${cmd.select.axis} == ${valueWithUnit(String(cmd.select.value), length)}`
          : `${cmd.select.centers.length} ${cmd.select.centers.length === 1 ? "face" : "faces"}`
      }`;
    case "load.add":
      return `${cmd.points} · ${valueWithUnit(`(${cmd.force.join(", ")})`, unitOf("force", units))}`;
    case "pressure.add":
      return `${cmd.faces} · ${valueWithUnit(String(cmd.pressure), unitOf("stress", units))}`;
    case "mpc.add":
      return [
        `${cmd.points} → ${cmd.center}`,
        cmd.constrained.length < 3 &&
          AXES.filter((a) => cmd.constrained.includes(a)).join(", "),
        cmd.rotation && `rotation ${cmd.rotation}`,
      ]
        .filter(Boolean)
        .join(" · ");
    case "boundary.add": {
      const value = cmd.value ?? 0;
      const constrained = AXES.filter((a) => cmd.constrained.includes(a)).join(
        ", ",
      );
      const unit = unitOf(boundaryQuantity(commands, cmd.pointset), units);
      return `${cmd.pointset} · ${constrained}${value !== 0 ? ` = ${valueWithUnit(String(value), unit)}` : ""}`;
    }
    case "loadcase.add":
      return describeLoadcase(cmd);
    case "symmetry.add":
      return describeSymmetry(cmd, length);
    case "step.add":
      return cmd.ramp
        ? cmd.ramp.items
            .map((i) => {
              const unit = unitOf(rampedQuantity(commands, i.target), units);
              return `${i.target}: ${i.start ?? 0} → ${valueWithUnit(String(i.end), unit)}`;
            })
            .join(", ") + ` (${cmd.ramp.num})`
        : "no ramp";
    case "job.add":
      return [
        cmd.steps.join(", "),
        cmd.curve && `curve ${cmd.curve}`,
        cmd.cutback && "cutback",
        describeSolver(cmd),
        cmd.tol !== undefined && `tol ${cmd.tol}`,
        cmd.maxiter !== undefined && `maxiter ${cmd.maxiter}`,
      ]
        .filter(Boolean)
        .join(" · ");
  }
}

/** Derive the browser tree. Cell sets are children of their mesh. */
export function deriveTree(
  commands: readonly Command[],
  issues: readonly Issue[] = [],
  report?: CheckReport,
): TreeNode[] {
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

  const node = (cmd: Command): TreeNode => ({
    id: cmd.name,
    label: cmd.name,
    kind: KINDS[cmd.command],
    ...(cmd.command === "point.add" ? { icon: "point" } : {}),
    detail: detail(cmd, commands),
    issues: messages.get(cmd.name) ?? [],
    children: [],
  });

  const nodes = new Map<string, TreeNode>();
  for (const cmd of commands) {
    if (!nodes.has(cmd.name)) nodes.set(cmd.name, node(cmd));
  }

  const groups = GROUPS.map(({ kind, label }) => ({
    id: `group:${kind}`,
    label,
    kind: "group" as const,
    issues: [],
    children: [] as TreeNode[],
  }));
  const groupOf = (kind: Kind | "point") =>
    groups.find((g) => g.id === `group:${kind}`);

  const placed = new Set<string>();
  for (const cmd of commands) {
    if (placed.has(cmd.name)) continue;
    placed.add(cmd.name);
    const child = nodes.get(cmd.name)!;
    if (cmd.command.startsWith("cellset.")) {
      const mesh = nodes.get((cmd as { mesh: string }).mesh);
      if (mesh?.kind === "mesh") {
        mesh.children.push(child);
        continue;
      }
    }
    // cell sets without a valid mesh are shown at the top of the mesh group
    const group =
      cmd.command === "point.add"
        ? "point"
        : child.kind === "cellset"
          ? "mesh"
          : // symmetry planes are boundaries of all steps (#186)
            child.kind === "symmetry"
            ? "boundary"
            : (child.kind as Kind);
    groupOf(group)!.children.push(child);
  }

  // the groups of the settings, the merge setting, the control points and the face
  // sets only if they are used
  const optional = new Set([
    "group:settings",
    "group:parameter",
    "group:merge",
    "group:point",
    "group:faceset",
    "group:pressure",
    "group:constraint",
    "group:load",
  ]);
  return groups
    .filter((g) => !optional.has(g.id) || g.children.length > 0)
    .map((g) => ({ ...g, count: g.children.length }));
}
