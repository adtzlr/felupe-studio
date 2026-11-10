// The material registry: the models of `material.add` in the command schema, with
// their labels and parameters (like felupe_studio.materials in Python).
import type { Command } from "./commands";
import { schema } from "./schema";

interface ParameterNode {
  "x-label": string;
  description: string;
  default?: number;
}

interface DefinitionNode {
  description: string;
  "x-label": string;
  properties: {
    model: { const: string };
    parameters: {
      required?: string[];
      properties: Record<string, ParameterNode>;
    };
  };
}

export interface MaterialParameter {
  key: string;
  label: string;
  description: string;
  required: boolean;
  default?: number;
}

export interface MaterialModel {
  name: string;
  label: string;
  description: string;
  parameters: MaterialParameter[];
  /** Incompressible without its (optional) bulk modulus: needs u-p-J. */
  optionalBulk: boolean;
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
      description: node.description,
      parameters,
      optionalBulk: parameters.some((p) => p.key === "bulk" && !p.required),
    };
  });

type Material = Extract<Command, { command: "material.add" }>;

/** True if a material has no volumetric part: its model has an optional bulk modulus, which is not given. */
export function needsBulk(material: Material): boolean {
  const model = MATERIAL_MODELS.find((m) => m.name === material.model);
  const parameters = material.parameters as Record<string, unknown>;
  return !!model?.optionalBulk && parameters.bulk === undefined;
}
