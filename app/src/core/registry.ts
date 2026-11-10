// Registry of labels, hints and defaults for the commands. The structure of a form
// (fields, types, ranges, variants) comes from the command schema, see form.ts; this
// file only adds what the schema does not know.
import type { CommandType, Kind } from "./validate";

export interface FieldInfo {
  label: string;
  /** Short explanation shown below the field. */
  hint?: string;
  /** Shown in an empty optional field, usually what happens without a value. */
  placeholder?: string;
  /** Initial value of a required field of a new object. */
  default?: unknown;
}

export type Tab = "mesh" | "materials" | "sections" | "loads" | "steps";

export interface CommandInfo {
  /** Label of the command, e.g. on the ribbon. */
  label: string;
  /** Ribbon tab of the command. */
  tab: Tab;
  /** Prefix of suggested names, e.g. `material` gives `material_1`. */
  prefix: string;
  /** Fields by their path in the command, e.g. `parameters.mu`. */
  fields: Record<string, FieldInfo>;
  /** Labels of the options of a field: enum values, material models, variants. */
  options?: Record<string, Record<string, string>>;
  /** At most one object of this command per model. */
  single?: boolean;
}

export const KIND_LABELS: Record<Kind, string> = {
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

const AXES = { x: "x", y: "y", z: "z" };

export const REGISTRY: Record<CommandType, CommandInfo> = {
  "mesh.import": {
    label: "Import mesh",
    tab: "mesh",
    prefix: "mesh",
    fields: {
      file: { label: "File", hint: "File name of the mesh, read with meshio" },
      tag: {
        label: "Cell tag",
        hint: "Integer cell data for cell sets, e.g. material or gmsh:physical",
        placeholder: "none",
      },
      cell_type: {
        label: "Cell type",
        hint: "Type of the solid cells, if the file has more than one",
        placeholder: "the only one",
      },
    },
  },
  "mesh.merge": {
    label: "Merge points",
    tab: "mesh",
    prefix: "merge",
    single: true,
    fields: {
      decimals: {
        label: "Decimals",
        hint: "Points are merged if their coordinates agree to this many decimals",
        default: 6,
      },
    },
  },
  "cellset.from_tag": {
    label: "Cell set from tag",
    tab: "mesh",
    prefix: "cells",
    fields: {
      mesh: { label: "Mesh" },
      value: { label: "Tag value", default: 1 },
    },
  },
  "cellset.from_file": {
    label: "Cell set of a mesh",
    tab: "mesh",
    prefix: "cells",
    fields: {
      mesh: { label: "Mesh" },
    },
  },
  "material.add": {
    label: "Material",
    tab: "materials",
    prefix: "material",
    fields: {
      model: { label: "Model", default: "NeoHooke" },
      "parameters.mu": { label: "mu", hint: "Shear modulus", default: 1 },
      "parameters.bulk": {
        label: "bulk",
        hint: "Bulk modulus; without it, use the mixed formulation",
        placeholder: "none",
      },
      "parameters.lmbda": {
        label: "lmbda",
        hint: "First Lamé parameter",
        default: 2,
      },
      "parameters.E": { label: "E", hint: "Young's modulus", default: 1 },
      "parameters.nu": { label: "nu", hint: "Poisson's ratio", default: 0.3 },
    },
    options: {
      model: {
        NeoHooke: "Neo-Hooke",
        NeoHookeCompressible: "Neo-Hooke (compressible)",
        LinearElasticLargeStrain: "Linear elastic (large strain)",
      },
    },
  },
  "section.add": {
    label: "Section",
    tab: "sections",
    prefix: "section",
    fields: {
      cellset: { label: "Cell set" },
      material: { label: "Material" },
      formulation: { label: "Formulation", default: "u" },
      bulk: { label: "Bulk modulus", default: 5000 },
    },
    options: {
      formulation: { u: "Displacement (u)", "u-p-J": "Mixed (u, p, J)" },
    },
  },
  "pointset.add": {
    label: "Point set",
    tab: "mesh",
    prefix: "points",
    fields: {
      select: { label: "Select" },
      "select.axis": { label: "Axis", default: "x" },
      "select.value": { label: "Coordinate", default: 0 },
      "select.atol": { label: "Tolerance", placeholder: "1e-8" },
      "select.ids": {
        label: "Point ids",
        hint: "Separated by commas",
        default: [],
      },
    },
    options: {
      select: { axis: "By coordinate", ids: "By point ids" },
      "select.axis": AXES,
    },
  },
  "boundary.add": {
    label: "Boundary",
    tab: "loads",
    prefix: "boundary",
    fields: {
      pointset: { label: "Point set" },
      constrained: { label: "Constrained", default: ["x", "y", "z"] },
      value: {
        label: "Value",
        hint: "Prescribed displacement",
        placeholder: "0",
      },
    },
    options: {
      constrained: AXES,
    },
  },
  "step.add": {
    label: "Step",
    tab: "steps",
    prefix: "step",
    fields: {
      sections: { label: "Sections", placeholder: "all" },
      ramp: { label: "Ramp a boundary" },
      "ramp.boundary": { label: "Boundary" },
      "ramp.start": { label: "Start", placeholder: "0" },
      "ramp.end": { label: "End", default: 1 },
      "ramp.num": { label: "Increments", default: 5 },
    },
  },
  "job.add": {
    label: "Job",
    tab: "steps",
    prefix: "job",
    fields: {
      steps: { label: "Steps" },
      curve: {
        label: "Curve boundary",
        hint: "Records the reaction force over the displacement",
        placeholder: "none",
      },
    },
  },
};
