// The units of the model (#132): FElupe has no units, but the settings of a model may
// say what its numbers mean. Lengths and forces give the other units; nothing is
// converted. Rotations are always in rad.
import type { Command } from "./commands";

export interface Units {
  length: "mm" | "m";
  force: "N" | "kN";
}

/**
 * The physical quantity of a value (`x-quantity` of the schema). A "displacement"
 * is a rotation at a rotation point, a "ramped" value is that of its target.
 */
export type Quantity =
  | "length"
  | "displacement"
  | "force"
  | "stress"
  | "moment"
  | "rotation"
  | "strain"
  | "ramped";

const STRESS: Record<string, string> = {
  "mm N": "MPa",
  "mm kN": "GPa",
  "m N": "Pa",
  "m kN": "kPa",
};

/** The units of a command list, if its settings have some. */
export function unitsOf(commands: readonly Command[]): Units | undefined {
  const settings = commands.find((c) => c.command === "model.settings");
  return settings?.command === "model.settings" ? settings.units : undefined;
}

/** The unit of a quantity, if it has one (rotations are always in rad). */
export function unitOf(
  quantity: Quantity | undefined,
  units: Units | undefined,
): string | undefined {
  if (quantity === "rotation") return "rad";
  if (!units || !quantity) return undefined;
  switch (quantity) {
    case "length":
    case "displacement":
      return units.length;
    case "force":
      return units.force;
    case "stress":
      return STRESS[`${units.length} ${units.force}`];
    case "moment":
      return `${units.force} ${units.length}`;
    default:
      return undefined;
  }
}

/**
 * The unit of a quantity of the results, e.g. "MPa" of "stress_mises" (strains have
 * no unit).
 */
export function resultUnit(
  quantity: string,
  units: Units | undefined,
): string | undefined {
  if (quantity.startsWith("displacement")) return unitOf("displacement", units);
  if (quantity.startsWith("stress")) return unitOf("stress", units);
  return undefined;
}

/** The units of a model as text, e.g. "mm · N · MPa". */
export const unitsText = (units: Units) =>
  `${units.length} · ${units.force} · ${unitOf("stress", units)}`;

/** A label with its unit, e.g. "μ [MPa]"; the label alone without a unit. */
export const withUnit = (label: string, unit: string | undefined) =>
  unit ? `${label} [${unit}]` : label;

/** A value with its unit, e.g. "8 mm". */
export const valueWithUnit = (value: string, unit: string | undefined) =>
  unit ? `${value} ${unit}` : value;

/** The rotation points of the constraints of a command list (#98). */
export const rotationPoints = (commands: readonly Command[]): Set<string> =>
  new Set(
    commands.flatMap((c) =>
      c.command === "mpc.add" && c.rotation ? [c.rotation] : [],
    ),
  );

/**
 * The quantity of a boundary: a rotation at a rotation point of a constraint, else
 * a displacement.
 */
export function boundaryQuantity(
  commands: readonly Command[],
  pointset: string | undefined,
): Quantity {
  return pointset !== undefined && rotationPoints(commands).has(pointset)
    ? "rotation"
    : "displacement";
}

/**
 * The quantity of a ramped value: that of its target. A point load is ramped by a
 * factor of its force, which has no unit.
 */
export function rampedQuantity(
  commands: readonly Command[],
  target: string | undefined,
): Quantity | undefined {
  const cmd = commands.find((c) => c.name === target);
  if (cmd?.command === "boundary.add")
    return boundaryQuantity(commands, cmd.pointset);
  if (cmd?.command === "loadcase.add") return "displacement";
  return undefined;
}
