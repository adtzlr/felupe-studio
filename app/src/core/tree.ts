// Browser tree derived from the command list, the validation issues and the
// optional check report of the worker.
import type { CheckReport } from "./checks";
import type { Command } from "./commands";
import type { Issue, Kind } from "./validate";
import { KINDS } from "./validate";

export interface TreeNode {
  /** Unique id: the object name, or `group:<kind>` for a group. */
  id: string;
  label: string;
  kind: Kind | "group";
  /** Short description, e.g. the file of a mesh or the model of a material. */
  detail?: string;
  /** Number of children of a group. */
  count?: number;
  /** Validation issues and check messages of this object. */
  issues: string[];
  children: TreeNode[];
}

const GROUPS: { kind: Kind; label: string }[] = [
  { kind: "mesh", label: "Meshes" },
  { kind: "merge", label: "Merge" },
  { kind: "pointset", label: "Point Sets" },
  { kind: "material", label: "Materials" },
  { kind: "section", label: "Sections" },
  { kind: "boundary", label: "Boundaries" },
  { kind: "step", label: "Steps" },
  { kind: "job", label: "Jobs" },
];

const AXES = ["x", "y", "z"] as const;

function detail(cmd: Command): string {
  switch (cmd.command) {
    case "mesh.import":
      return cmd.tag ? `${cmd.file} · tag ${cmd.tag}` : cmd.file;
    case "mesh.merge":
      return `decimals = ${cmd.decimals}`;
    case "cellset.from_tag":
      return `tag = ${cmd.value}`;
    case "cellset.from_file":
      return "all cells";
    case "material.add":
      return cmd.model;
    case "section.add":
      return `${cmd.material} · ${cmd.formulation}`;
    case "pointset.add":
      return "axis" in cmd.select
        ? `${cmd.select.axis} == ${cmd.select.value}`
        : `${cmd.select.ids.length} points`;
    case "boundary.add": {
      const value = cmd.value ?? 0;
      const constrained = AXES.filter((a) => cmd.constrained.includes(a)).join(
        ", ",
      );
      return `${cmd.pointset} · ${constrained}${value !== 0 ? ` = ${value}` : ""}`;
    }
    case "step.add":
      return cmd.ramp
        ? `${cmd.ramp.boundary}: ${cmd.ramp.start ?? 0} → ${cmd.ramp.end} (${cmd.ramp.num})`
        : "no ramp";
    case "job.add":
      return cmd.curve
        ? `${cmd.steps.join(", ")} · curve ${cmd.curve}`
        : cmd.steps.join(", ");
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
    detail: detail(cmd),
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
  const groupOf = (kind: Kind) => groups.find((g) => g.id === `group:${kind}`);

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
    groupOf(
      child.kind === "cellset" ? "mesh" : (child.kind as Kind),
    )!.children.push(child);
  }

  return groups
    .filter((g) => g.id !== "group:merge" || g.children.length > 0)
    .map((g) => ({ ...g, count: g.children.length }));
}
