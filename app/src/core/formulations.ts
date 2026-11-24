// The formulation registry: the formulations of `section.add` in the command schema,
// with their labels and what FElupe makes of them (like felupe_studio.formulations in
// Python, ADR 0024).
import type { Command } from "./commands";
import { hasVolumetric, strainBased } from "./materials";
import { schema } from "./schema";

/**
 * What the material of a formulation has: a volumetric part of its own, the
 * isochoric part of a strain energy (the section adds the volumetric part), no
 * volumetric part (and the section adds none), or any material.
 */
export type FormulationMaterial = "volumetric" | "isochoric" | "none" | "any";

interface DefinitionNode {
  description: string;
  "x-label": string;
  "x-group": string;
  "x-felupe": {
    body: string;
    fields: string;
    cells: "all" | string[];
    material: FormulationMaterial;
  };
  properties: { formulation: { const: string } };
}

export interface Formulation {
  /** The value of `formulation`, e.g. `u-p-J`. */
  name: string;
  label: string;
  /** The menu of the ribbon (`x-group`). */
  group: string;
  description: string;
  /** The solid body, e.g. `fem.SolidBody`. */
  body: string;
  /** The fields: `u` (the displacements) or `mixed`. */
  fields: string;
  /** The cell types, or undefined for all. */
  cells?: readonly string[];
  material: FormulationMaterial;
}

const defs = schema.$defs as unknown as Record<string, DefinitionNode> & {
  SectionAdd: { oneOf: { $ref: string }[] };
};

/** The formulations, in the order of the schema. */
export const FORMULATIONS: readonly Formulation[] = defs.SectionAdd.oneOf.map(
  ({ $ref }) => {
    const node = defs[$ref.split("/").pop()!];
    const { body, fields, cells, material } = node["x-felupe"];
    return {
      name: node.properties.formulation.const,
      label: node["x-label"],
      group: node["x-group"],
      description: node.description,
      body,
      fields,
      ...(cells === "all" ? {} : { cells }),
      material,
    };
  },
);

type Material = Extract<Command, { command: "material.add" }>;

/** The formulation of a name, e.g. `u-p-J`. */
export const formulationOf = (name: string): Formulation | undefined =>
  FORMULATIONS.find((f) => f.name === name);

/** True if a formulation takes a material (like `Formulation.fits` in Python). */
export function fits(formulation: Formulation, material: Material): boolean {
  switch (formulation.material) {
    case "any":
      return true;
    case "volumetric":
      return hasVolumetric(material);
    case "isochoric":
      return !hasVolumetric(material) && !strainBased(material);
    case "none":
      return !hasVolumetric(material);
  }
}

/**
 * The name of the first formulation of the registry that takes a material of a
 * kind, e.g. `u` for `volumetric`.
 */
export const first = (material: FormulationMaterial): string =>
  FORMULATIONS.find((f) => f.material === material)!.name;

/** The first formulation of the registry that takes a material. */
export const fitting = (material: Material): Formulation | undefined =>
  FORMULATIONS.find((f) => fits(f, material));
