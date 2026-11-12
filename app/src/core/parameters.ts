// Parameters of the model (#180): numbers with units, e.g. a dimension of a mesh made
// by a script. The problems mirror felupe_studio.commands.parameter_problems; both
// are tested with tests/data/validation_cases.json.
import type { Command } from "./commands";
import { unitOf, type Units, valueWithUnit } from "./units";

export type Parameter = Extract<Command, { command: "parameter.add" }>;

/** The numbers of a parameter and their names in the messages. */
const FIELDS = {
  value: "value",
  min: "minimum",
  max: "maximum",
  step: "step",
} as const;

export interface ParameterProblem {
  /** The field of the form that has the problem. */
  field: keyof typeof FIELDS;
  message: string;
}

/**
 * The problems of a parameter: its value within its range, and integers for an
 * integer parameter.
 */
export function parameterProblems(parameter: Parameter): ParameterProblem[] {
  const problems: ParameterProblem[] = [];
  if (parameter.integer) {
    for (const [key, label] of Object.entries(FIELDS)) {
      const value = parameter[key as keyof typeof FIELDS];
      if (value !== undefined && !Number.isInteger(value)) {
        problems.push({
          field: key as keyof typeof FIELDS,
          message: `the ${label} of an integer parameter is an integer.`,
        });
      }
    }
  }
  const { min, max, value } = parameter;
  if (min !== undefined && max !== undefined && min >= max) {
    problems.push({
      field: "max",
      message: "the minimum is not smaller than the maximum.",
    });
  }
  if (min !== undefined && value < min) {
    problems.push({
      field: "value",
      message: "the value is smaller than the minimum.",
    });
  }
  if (max !== undefined && value > max) {
    problems.push({
      field: "value",
      message: "the value is larger than the maximum.",
    });
  }
  return problems;
}

/** The value of a parameter with its unit and range, e.g. "50 mm · 10–100". */
export function describeParameter(
  parameter: Parameter,
  units: Units | undefined,
): string {
  const unit = unitOf(parameter.quantity, units);
  const value = valueWithUnit(String(parameter.value), unit);
  const { min, max } = parameter;
  if (min === undefined && max === undefined) return value;
  return `${value} · ${min ?? "−∞"}–${max ?? "∞"}`;
}
