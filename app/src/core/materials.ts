// The material registry: the models of `material.add` in the command schema, with
// their labels and parameters (like felupe_studio.materials in Python).
import type { Command } from "./commands";
import { schema } from "./schema";

interface ParameterNode {
  "x-label": string;
  description: string;
  default?: number | number[];
}

interface DefinitionNode {
  description: string;
  "x-label": string;
  "x-group"?: string;
  properties: {
    model: { const: string };
    parameters: {
      required?: string[];
      "x-same-length"?: string[];
      properties: Record<string, ParameterNode>;
    };
  };
}

export interface MaterialParameter {
  key: string;
  label: string;
  description: string;
  required: boolean;
  /** A number, or a list of numbers, e.g. the moduli of Ogden. */
  default?: number | number[];
}

export interface MaterialModel {
  name: string;
  label: string;
  /** The menu of the ribbon, e.g. `Polynomial` (#136). */
  group?: string;
  description: string;
  parameters: MaterialParameter[];
  /** Incompressible without its (optional) bulk modulus: needs u-p-J. */
  optionalBulk: boolean;
  /** Lists of values that need the same number of values (`x-same-length`). */
  sameLength: string[];
}

const defs = schema.$defs as unknown as Record<string, DefinitionNode> & {
  MaterialAdd: { oneOf: { $ref: string }[] };
};

/** The material models, in the order of the schema. */
export const MATERIAL_MODELS: readonly MaterialModel[] =
  defs.MaterialAdd.oneOf.map(({ $ref }) => {
    const node = defs[$ref.split("/").pop()!];
    const { required = [], properties } = node.properties.parameters;
    const parameters = Object.entries(properties).map(([key, p]) => ({
      key,
      label: p["x-label"],
      description: p.description,
      required: required.includes(key),
      default: p.default,
    }));
    return {
      name: node.properties.model.const,
      label: node["x-label"],
      ...(node["x-group"] ? { group: node["x-group"] } : {}),
      description: node.description,
      parameters,
      optionalBulk: parameters.some((p) => p.key === "bulk" && !p.required),
      sameLength: node.properties.parameters["x-same-length"] ?? [],
    };
  });

type Material = Extract<Command, { command: "material.add" }>;

/** True if a material has no volumetric part: its model has an optional bulk modulus, which is not given. */
export function needsBulk(material: Material): boolean {
  const model = MATERIAL_MODELS.find((m) => m.name === material.model);
  const parameters = material.parameters as Record<string, unknown>;
  return !!model?.optionalBulk && parameters.bulk === undefined;
}

/**
 * What is wrong with the parameters of a material beyond the schema, with the field:
 * lists of values that need the same number of values (like `problems` of
 * felupe_studio.materials).
 */
export function materialProblems(
  material: Material,
): { message: string; field: string }[] {
  const model = MATERIAL_MODELS.find((m) => m.name === material.model);
  const values = material.parameters as Record<string, unknown>;
  const keys = model?.sameLength ?? [];
  const lengths = new Set(
    keys.flatMap((k) => (Array.isArray(values[k]) ? [values[k].length] : [])),
  );
  return lengths.size > 1
    ? [
        {
          message: `${keys.join(" and ")} need the same number of values.`,
          // at the later list, like the error of the form
          field: `parameters.${keys.at(-1)}`,
        },
      ]
    : [];
}
