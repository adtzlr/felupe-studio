// The formulation registry: the formulations of `section.add` in the command schema,
// with their labels and what FElupe makes of them (like felupe_studio.formulations in
// Python, ADR 0024).
import { hasVolumetric, type MaterialCommand, strainBased } from "./materials";
import { schema } from "./schema";

/**
 * What the material of a formulation has: a volumetric part of its own, the
 * isochoric part of a strain energy (the section adds the volumetric part), or no
 * volumetric part (and the section adds none).
 */
export type FormulationMaterial = "volumetric" | "isochoric" | "none";

interface DefinitionNode {
  description: string;
  "x-label": string;
  "x-group": string;
  "x-hint": string;
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
  /** When to use it, the hint of the form (`x-hint`). */
  hint: string;
  description: string;
  /** The solid body, e.g. `fem.SolidBody` or `fem.ThreeFieldVariation`. */
  body: string;
  /** The fields: `u` (the displacements), `condensed`, `mixed` or `automatic`. */
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
      hint: node["x-hint"],
      description: node.description,
      body,
      fields,
      ...(cells === "all" ? {} : { cells }),
      material,
    };
  },
);

/** The formulation of a name, e.g. `u-p-J`. */
export const formulationOf = (name: string): Formulation | undefined =>
  FORMULATIONS.find((f) => f.name === name);

/** True if a formulation takes a material (like `Formulation.fits` in Python). */
export function fits(
  formulation: Formulation,
  material: MaterialCommand,
): boolean {
  switch (formulation.material) {
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
export const fitting = (material: MaterialCommand): Formulation | undefined =>
  FORMULATIONS.find((f) => fits(f, material));

/**
 * The first other formulation of the menu of a formulation (`x-group`) that takes a
 * material, e.g. the three-field variation of a nearly incompressible formulation
 * for a material with a volumetric part (like `sibling` in Python, #420).
 */
export const sibling = (
  formulation: Formulation,
  material: MaterialCommand,
): string | undefined =>
  FORMULATIONS.find(
    (f) =>
      f.group === formulation.group && f !== formulation && fits(f, material),
  )?.name;

/** True if a formulation takes cells of a type (#420). */
export const takes = (formulation: Formulation, cellType: string): boolean =>
  !formulation.cells || formulation.cells.includes(cellType);

// the plural of the cell types of the formulations, for their messages
const CELLS: Record<string, string> = {
  tetra: "tetrahedrons",
  hexahedron: "hexahedrons",
  triangle: "triangles",
  quad: "quads",
};

/**
 * Why the formulation of a section does not take its cells, and the formulations of
 * its menu that take its material and the cells (like `cell_problem` in Python,
 * #420), e.g. *Condensed per cell (u-p-J-condensed) takes hexahedrons and quads,
 * not the tetra cells of 'rubber'. Use 'u-p-J' or 'u-p-J-mixed'.*
 */
export function cellProblem(
  section: string,
  formulation: Formulation,
  cellType: string,
): string | undefined {
  if (takes(formulation, cellType)) return undefined;
  const kinds = [
    ...new Set(
      formulation.cells!.map((c) => CELLS[c.replace(/\d+$/, "")] ?? c),
    ),
  ];
  const others = FORMULATIONS.filter(
    (f) =>
      f.group === formulation.group &&
      f.material === formulation.material &&
      takes(f, cellType),
  ).map((f) => `'${f.name}'`);
  const use = others.length ? ` Use ${others.join(" or ")}.` : "";
  return (
    `${formulation.label} (${formulation.name}) takes ${kinds.join(" and ")}, ` +
    `not the ${cellType} cells of '${section}'.${use}`
  );
}
