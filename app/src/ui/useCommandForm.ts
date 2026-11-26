// The state of a command form (#312): the draft of the command, the text of its
// fields as typed, the errors of the touched fields, the issues of the stored
// command (#137), the units (#132) and the values of expressions (#242).
import { useState } from "preact/hooks";
import type { Command } from "../core/commands";
import {
  type Context,
  type Draft,
  draftErrors,
  expressionValue,
  type FieldSpec,
  fieldSpecs,
  getValue,
  sameDraft,
  setValue,
  toCommand,
} from "../core/form";
import { numberText as valueText } from "../core/resolve";
import {
  boundaryQuantity,
  type Quantity,
  rampedQuantity,
  unitOf,
  unitsOf,
} from "../core/units";
import type { CommandType } from "../core/validate";
import { EXPRESSION_HINT, valueOf } from "./formText";

/** Text of a number or id field while it is edited, with how to parse it. */
export interface RawText {
  text: string;
  parse: (text: string) => unknown;
}

const fieldId = (key: string) => `field-${key.replace(/\./g, "-")}`;

/** The values of a field as a list. */
const itemsOf = (value: unknown) => (Array.isArray(value) ? value : [value]);

interface Options {
  type: CommandType;
  initial: Draft;
  context: Context;
  requireChange: boolean;
  onSubmit: (command: Command) => void;
  issues: Readonly<Record<string, string>>;
  idPrefix: string;
}

export function useCommandForm({
  type,
  initial,
  context,
  requireChange,
  onSubmit,
  issues,
  idPrefix,
}: Options) {
  const idOf = (key: string) => idPrefix + fieldId(key);
  const [start] = useState(
    () => toCommand(type, initial, context) as unknown as Draft,
  );
  const [draft, setDraft] = useState<Draft>(start);
  const [texts, setTexts] = useState<Record<string, RawText>>({});
  const [touched, setTouched] = useState<ReadonlySet<string>>(new Set());
  const [submitted, setSubmitted] = useState(false);

  const specs = fieldSpecs(type, draft, context);
  const errors = draftErrors(type, draft, context);
  const changed = !sameDraft(draft, start);
  const errorOf = (key: string) =>
    submitted || touched.has(key) ? errors[key] : undefined;
  // an issue of the stored command at its field, while the field is unchanged
  const issueOf = (spec: FieldSpec) =>
    !errorOf(spec.key) &&
    issues[spec.key] &&
    sameDraft(getValue(draft, spec.path), getValue(start, spec.path))
      ? issues[spec.key]
      : undefined;

  const change = (spec: FieldSpec, value: unknown, raw?: RawText) => {
    const next = setValue(type, draft, spec.path, value, context);
    // keep the typed text of a field only while it still matches its value
    const kept = Object.entries({
      ...texts,
      ...(raw ? { [spec.key]: raw } : {}),
    }).filter(([key, t]) =>
      sameDraft(t.parse(t.text), getValue(next, key.split("."))),
    );
    setDraft(next);
    setTexts(Object.fromEntries(kept));
    setTouched(new Set(touched).add(spec.key));
  };

  // the units of the values (#132): of the model, or of the edited settings
  const units =
    type === "model.settings"
      ? (draft.units as Parameters<typeof unitOf>[1])
      : unitsOf(context.commands);
  const quantityOf = (spec: FieldSpec): Quantity | undefined => {
    const quantity = spec.quantity;
    if (quantity === "displacement" && type === "boundary.add")
      return boundaryQuantity(
        context.commands,
        draft.pointset as string | undefined,
      );
    if (quantity === "ramped") {
      const items = getValue(draft, ["ramp", "items"]);
      const row = Array.isArray(items) ? items[spec.row ?? -1] : undefined;
      return rampedQuantity(context.commands, row?.target);
    }
    // the numbers of a parameter have the quantity of the parameter (#180)
    if (quantity === "parameter") return draft.quantity as Quantity | undefined;
    return quantity;
  };
  const unit = (spec: FieldSpec) => unitOf(quantityOf(spec), units);

  /**
   * The value of the expressions of a field (#242), e.g. `= 12 mm` or
   * `= (0, 0, 32) mm`, if it has expressions and they have values.
   */
  const valueHint = (spec: FieldSpec): string | undefined => {
    const value = getValue(draft, spec.path);
    const items = itemsOf(value);
    if (
      !["number", "numbers"].includes(spec.input.type) ||
      !items.some((x) => typeof x === "string")
    )
      return undefined;
    const values: string[] = [];
    for (const x of items) {
      if (typeof x !== "string") values.push(valueOf(x));
      else {
        const result = expressionValue(x, context);
        if ("error" in result) return undefined;
        values.push(valueText(result.value));
      }
    }
    const text = Array.isArray(value) ? `(${values.join(", ")})` : values[0];
    const suffix = unit(spec);
    return `= ${text}${suffix ? ` ${suffix}` : ""}`;
  };

  // a field of a model with parameters takes text: an expression (#242)
  const parametric = context.commands.some(
    (c) => c.command === "parameter.add",
  );
  const mode = (expressions: boolean | undefined, decimal: string) =>
    expressions && parametric ? "text" : decimal;

  /**
   * The class and the tooltip of a number field: an expression is left-aligned,
   * and its tooltip has the whole expression with its value, e.g. in a narrow row.
   */
  const numberField = (spec: FieldSpec, expressions: boolean | undefined) => {
    const items = itemsOf(getValue(draft, spec.path));
    if (!items.some((x) => typeof x === "string"))
      return {
        class: "number-field",
        title: expressions && parametric ? EXPRESSION_HINT : undefined,
      };
    const hint = valueHint(spec);
    return {
      class: "number-field expression",
      title: `${items.map(valueOf).join(", ")}${hint ? ` ${hint}` : ""}`,
    };
  };

  const reset = () => {
    setDraft(start);
    setTexts({});
    setTouched(new Set());
    setSubmitted(false);
  };

  const submit = (event: Event) => {
    event.preventDefault();
    // Enter in an unchanged form of an object applies nothing
    if (requireChange && !changed) return;
    setSubmitted(true);
    // a field or a cell of rows with an error, e.g. an expression (#242)
    const invalid =
      specs.find((spec) => errors[spec.key])?.key ?? Object.keys(errors)[0];
    if (invalid) {
      document.getElementById(idOf(invalid))?.focus();
      return;
    }
    onSubmit(toCommand(type, draft, context));
  };

  return {
    type,
    context,
    idOf,
    start,
    draft,
    texts,
    specs,
    changed,
    errorOf,
    issueOf,
    change,
    unit,
    valueHint,
    mode,
    numberField,
    reset,
    submit,
  };
}

export type Form = ReturnType<typeof useCommandForm>;
