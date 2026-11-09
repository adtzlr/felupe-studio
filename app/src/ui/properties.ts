// Fields of a command for the properties panel, with readable labels.
import type { Command } from "../core/commands";

export interface Field {
  label: string;
  value: string;
}

const LABELS: Record<string, string> = {
  file: "File",
  tag: "Cell tag",
  decimals: "Decimals",
  mesh: "Mesh",
  value: "Value",
  model: "Model",
  cellset: "Cell set",
  material: "Material",
  formulation: "Formulation",
  bulk: "Bulk modulus",
  axis: "Axis",
  atol: "Tolerance",
  ids: "Point ids",
  pointset: "Point set",
  constrained: "Constrained",
  sections: "Sections",
  boundary: "Ramped boundary",
  start: "Start",
  end: "End",
  num: "Increments",
  steps: "Steps",
  curve: "Curve boundary",
};

const FORMULATIONS: Record<string, string> = {
  u: "Displacement (u)",
  "u-p-J": "Mixed (u, p, J)",
};

function text(key: string, value: unknown): string {
  if (key === "formulation")
    return FORMULATIONS[value as string] ?? String(value);
  if (key === "ids") {
    const ids = value as number[];
    const shown = ids.slice(0, 8).join(", ");
    return ids.length > 8 ? `${ids.length} points: ${shown}, …` : shown;
  }
  if (Array.isArray(value)) return value.join(", ");
  return String(value);
}

/** Fields of a command (without command and name), nested objects flattened. */
export function fields(command: Command): Field[] {
  const result: Field[] = [];
  const add = (key: string, value: unknown) => {
    if (value && typeof value === "object" && !Array.isArray(value)) {
      for (const [k, v] of Object.entries(value)) add(k, v);
    } else {
      result.push({ label: LABELS[key] ?? key, value: text(key, value) });
    }
  };
  for (const [key, value] of Object.entries(command)) {
    if (key !== "command" && key !== "name") add(key, value);
  }
  // defaults that are not stored in the command
  if (command.command === "boundary.add" && command.value === undefined) {
    result.push({ label: "Value", value: "0" });
  }
  if (command.command === "step.add") {
    if (command.sections === undefined)
      result.unshift({ label: "Sections", value: "all" });
    if (command.ramp && command.ramp.start === undefined) {
      const index = result.findIndex((f) => f.label === "End");
      result.splice(index, 0, { label: "Start", value: "0" });
    }
  }
  return result;
}

export const KIND_LABELS: Record<string, string> = {
  mesh: "Mesh",
  merge: "Merge",
  cellset: "Cell set",
  material: "Material",
  section: "Section",
  pointset: "Point set",
  boundary: "Boundary",
  step: "Step",
  job: "Job",
};
