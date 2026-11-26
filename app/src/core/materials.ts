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
  /** How FElupe creates it: a strain-based model has a `strain` function (#191). */
  "x-felupe": { strain?: string; statevars?: string };
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
  /** Strain-based (`fem.MaterialStrain`, #191): needs the formulation u. */
  strain: boolean;
  /** With state variables, e.g. the equivalent plastic strain (#191). */
  statevars: boolean;
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
      strain: node["x-felupe"].strain !== undefined,
      statevars: node["x-felupe"].statevars !== undefined,
    };
  });

type Material = Extract<Command, { command: "material.add" }>;

/** True if a material has no volumetric part: its model has an optional bulk modulus, which is not given. */
export function needsBulk(material: Material): boolean {
  const model = MATERIAL_MODELS.find((m) => m.name === material.model);
  const parameters = material.parameters as Record<string, unknown>;
  return !!model?.optionalBulk && parameters.bulk === undefined;
}

/** A material of the model: of the registry, or of a file (ADR 0025). */
export type MaterialCommand = Extract<
  Command,
  { command: "material.add" | "material.script" }
>;

/** Whether a command is a material: of the registry, or of a file (ADR 0025). */
export const isMaterial = (c: Command): c is MaterialCommand =>
  c.command === "material.add" || c.command === "material.script";

/**
 * True if a material has a volumetric part of its own (#417): its bulk modulus is
 * given, or its model has no optional bulk modulus (a compressible or a strain-based
 * model). The u-p-J formulation adds the volumetric part of the section, so it takes
 * a material without one (like `has_volumetric` of felupe_studio.materials). A
 * material of a file says so with `volumetric` (ADR 0025, by default it has one), a
 * strain energy function of a file with its bulk modulus (#424); a strain-based
 * function of a file has one (#425).
 */
export const hasVolumetric = (material: MaterialCommand): boolean => {
  if (material.command === "material.add") return !needsBulk(material);
  if (material.kind === "hyperelastic") return material.bulk !== undefined;
  if (material.kind === "strain") return true;
  return material.volumetric !== false;
};

/**
 * The kinds of user-defined materials that are a function of a file, with the name
 * of their function by default (like `FUNCTIONS` of felupe_studio.materials): a
 * strain energy function (#424) and a strain-based function (#425).
 */
export const FUNCTIONS = {
  hyperelastic: "strain_energy",
  strain: "material",
} as const;

/** A function of a file: a strain energy function (#424) or a strain-based one (#425). */
export type MaterialFunction = Extract<
  MaterialCommand,
  { command: "material.script"; kind: keyof typeof FUNCTIONS }
>;

/** True if a material is a function of a file (#424, #425). */
export const isFunction = (material: Command): material is MaterialFunction =>
  material.command === "material.script" && material.kind in FUNCTIONS;

/** The name of the function of a material of a file (#424, #425). */
export const functionName = (material: MaterialFunction): string =>
  material.function ?? FUNCTIONS[material.kind];

/** The parameters of the Mullins effect, arguments of fem.ogden_roxburgh (#346). */
export const MULLINS = ["r", "m", "beta"] as const;

/**
 * True if a material is strain-based (#191): a strain-based model, or a
 * strain-based function of a file (#425). It needs the formulation u, or the
 * three-field variation (#420). A constitutive model of a file is not (ADR 0025).
 */
export const strainBased = (material: MaterialCommand): boolean =>
  material.command === "material.add"
    ? !!MATERIAL_MODELS.find((m) => m.name === material.model)?.strain
    : material.kind === "strain";

/**
 * True if a command list has a material with state variables, e.g. the equivalent
 * plastic strain of an elastic-plastic material (#191).
 */
export const hasStatevars = (commands: readonly Command[]): boolean =>
  commands.some(
    (c) =>
      c.command === "material.add" &&
      !!MATERIAL_MODELS.find((m) => m.name === c.model)?.statevars,
  );

/**
 * True if a command list has a material with the Mullins effect (#346): of the
 * registry, or a strain energy function of a file (#424).
 */
export const hasMullins = (commands: readonly Command[]): boolean =>
  commands.some(
    (c) => (c.command === "material.add" || isFunction(c)) && "mullins" in c,
  );

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
