// The controls of the fields of a command form (#312), by the type of their input:
// text, numbers, lists, coordinates, choices, variants and references.
import type { JSX } from "preact";
import {
  choiceOptions,
  type FieldSpec,
  getValue,
  type Input,
  kindLabel,
  offered,
} from "../core/form";
import {
  coordinatesText,
  numberText,
  parseCoordinates,
  parseIntegers,
  parseValue,
  parseValues,
  valueOf,
} from "./formText";
import type { Form } from "./useCommandForm";

/** Selected option of a variant field: a value, or the marker key of an object. */
export function currentVariant(spec: FieldSpec, value: unknown): string {
  if (spec.input.type !== "variant") return "";
  if (typeof value === "string") return value;
  const keys = value && typeof value === "object" ? Object.keys(value) : [];
  const { options, seeds } = spec.input;
  // the option whose seed (its required properties) the value has, e.g. a point
  // set at a bound `{ bound, axis }`, not by a coordinate `{ axis, value }` (#181)
  const complete = options.find((o) => {
    const seed = seeds[o.value];
    return (
      keys.includes(o.value) &&
      (seed === null ||
        typeof seed !== "object" ||
        Object.keys(seed).every((k) => keys.includes(k)))
    );
  });
  return (complete ?? options.find((o) => keys.includes(o.value)) ?? options[0])
    .value;
}

/** Consecutive options of the same group, e.g. the kinds of materials (#259). */
function optionGroups<T extends { group?: string }>(options: readonly T[]) {
  const groups: { group?: string; options: T[] }[] = [];
  for (const option of options) {
    const last = groups.at(-1);
    if (last && option.group && last.group === option.group)
      last.options.push(option);
    else groups.push({ group: option.group, options: [option] });
  }
  return groups;
}

/** The props of a control for assistive tools: its id, label and descriptions. */
interface Common {
  id: string;
  "aria-label"?: string;
  "aria-invalid"?: boolean;
  "aria-describedby"?: string;
}

interface Args<T extends Input["type"]> {
  form: Form;
  spec: FieldSpec;
  input: Extract<Input, { type: T }>;
  common: Common;
  value: unknown;
}

function TextControl({
  form,
  spec,
  common,
  value,
}: Omit<Args<"text">, "input">) {
  return (
    <input
      {...common}
      type="text"
      value={typeof value === "string" ? value : ""}
      placeholder={spec.placeholder}
      autocomplete="off"
      spellcheck={false}
      onInput={(event) =>
        form.change(spec, event.currentTarget.value || undefined)
      }
    />
  );
}

function NumberControl({ form, spec, input, common, value }: Args<"number">) {
  const parse = (text: string) => parseValue(text, input.expressions);
  return (
    <input
      {...common}
      type="text"
      {...form.numberField(spec, input.expressions)}
      inputMode={form.mode(
        input.expressions,
        input.integer ? "numeric" : "decimal",
      )}
      value={form.texts[spec.key]?.text ?? numberText(value)}
      placeholder={spec.placeholder}
      autocomplete="off"
      spellcheck={false}
      onInput={(event) => {
        const text = event.currentTarget.value;
        form.change(spec, parse(text), { text, parse });
      }}
    />
  );
}

function IntegersControl({ form, spec, common, value }: Args<"integers">) {
  return (
    <input
      {...common}
      type="text"
      inputMode="numeric"
      value={
        form.texts[spec.key]?.text ??
        (Array.isArray(value) ? value.join(", ") : "")
      }
      placeholder={spec.placeholder}
      autocomplete="off"
      onInput={(event) => {
        const text = event.currentTarget.value;
        form.change(spec, parseIntegers(text), { text, parse: parseIntegers });
      }}
    />
  );
}

function NumbersControl({ form, spec, input, common, value }: Args<"numbers">) {
  // one number of a number or a list of numbers is a number (#225)
  const parse = (text: string) => {
    const numbers = parseValues(text, input.expressions);
    if (!input.collapse) return numbers;
    return numbers.length > 1 ? numbers : numbers[0];
  };
  const shown = Array.isArray(value)
    ? value.map(valueOf).join(", ")
    : numberText(value);
  return (
    <input
      {...common}
      type="text"
      {...form.numberField(spec, input.expressions)}
      inputMode={form.mode(input.expressions, "decimal")}
      value={form.texts[spec.key]?.text ?? shown}
      placeholder={spec.placeholder}
      autocomplete="off"
      spellcheck={false}
      onInput={(event) => {
        const text = event.currentTarget.value;
        form.change(spec, parse(text), { text, parse });
      }}
    />
  );
}

function CoordinatesControl({
  form,
  spec,
  input,
  common,
  value,
}: Args<"coordinates">) {
  const text = form.texts[spec.key]?.text ?? coordinatesText(value);
  return (
    <textarea
      {...common}
      value={text}
      rows={Math.min(Math.max(2, text.split("\n").length), 8)}
      placeholder={spec.placeholder ?? "0, 0, 0"}
      autocomplete="off"
      spellcheck={false}
      onInput={(event) => {
        const text = event.currentTarget.value;
        const parse = (text: string) =>
          parseCoordinates(text, input.expressions);
        form.change(spec, parse(text), { text, parse });
      }}
    />
  );
}

function ChoiceControl({ form, spec, common, value }: Args<"choice">) {
  const { empty, options } = choiceOptions(spec, value);
  return (
    <select
      {...common}
      value={typeof value === "string" ? value : ""}
      onChange={(event) =>
        form.change(spec, event.currentTarget.value || undefined)
      }
    >
      {empty !== undefined && <option value="">{empty}</option>}
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

function VariantControl({ form, spec, input, common, value }: Args<"variant">) {
  return (
    <select
      {...common}
      value={currentVariant(spec, value)}
      onChange={(event) =>
        form.change(spec, input.seeds[event.currentTarget.value])
      }
    >
      {optionGroups(input.options).map(({ group, options }) => {
        const items = options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ));
        // the groups of the menus of the ribbon, e.g. of the materials (#259)
        return group ? (
          <optgroup key={`group-${group}`} label={group}>
            {items}
          </optgroup>
        ) : (
          items
        );
      })}
    </select>
  );
}

function MultiChoiceControl({
  form,
  spec,
  input,
  common,
  value,
}: Args<"multichoice">) {
  const items = Array.isArray(value) ? (value as string[]) : [];
  return (
    <div
      {...common}
      role="group"
      aria-labelledby={`${common.id}-label`}
      class="checks"
    >
      {input.options.map((o) => (
        <label key={o.value} class="check">
          <input
            type="checkbox"
            checked={items.includes(o.value)}
            onChange={(event) => {
              const on = event.currentTarget.checked;
              const next = input.options
                .map((x) => x.value)
                .filter((v) => (v === o.value ? on : items.includes(v)));
              form.change(spec, next);
            }}
          />
          {o.label}
        </label>
      ))}
    </div>
  );
}

/** A reference to one object: a select of the objects of its kind. */
function ReferenceControl(args: Args<"reference">) {
  // a list of at most one, e.g. the mesh of an operation (ADR 0019): one select
  const one = args.input.maxItems === 1;
  const { minItems, maxItems } = args.input;
  // a list of a fixed number, in order, e.g. the two meshes of fill_between
  if (args.input.multiple && maxItems !== undefined && maxItems > 1)
    if (minItems === maxItems) return <OrderedReferences {...args} />;
  if (args.input.multiple && !one) return <ReferencesControl {...args} />;
  const { form, spec, input, common, value } = args;
  const names = offered(spec, form.draft, form.context);
  const kind = kindLabel(input.kind);
  const raw = one && Array.isArray(value) ? value[0] : value;
  const current = typeof raw === "string" ? raw : "";
  const missing = current !== "" && !names.includes(current);
  return (
    <select
      {...common}
      value={current}
      onChange={(event) => {
        const name = event.currentTarget.value || undefined;
        form.change(spec, one && name ? [name] : name);
      }}
    >
      {(!spec.required || current === "") && (
        <option value="">
          {spec.required ? `Select a ${kind}` : (spec.placeholder ?? "none")}
        </option>
      )}
      {missing && <option value={current}>{current} (missing)</option>}
      {names.map((name) => (
        <option key={name} value={name}>
          {name}
        </option>
      ))}
    </select>
  );
}

/** A fixed number of references in order: one select per item (ADR 0019). */
function OrderedReferences({
  form,
  spec,
  input,
  common,
  value,
}: Args<"reference">) {
  const names = offered(spec, form.draft, form.context);
  const kind = kindLabel(input.kind);
  const items = Array.isArray(value) ? (value as string[]) : [];
  const count = input.maxItems ?? items.length;
  return (
    <div
      {...common}
      role="group"
      aria-labelledby={`${common.id}-label`}
      class="ordered"
    >
      {Array.from({ length: count }, (_, i) => {
        const current = items[i] ?? "";
        const missing = current !== "" && !names.includes(current);
        return (
          <select
            key={i}
            aria-label={`${spec.label} ${i + 1}`}
            value={current}
            onChange={(event) => {
              const next = Array.from(
                { length: count },
                (_, k) => items[k] ?? "",
              );
              next[i] = event.currentTarget.value;
              form.change(spec, next.some(Boolean) ? next : undefined);
            }}
          >
            {current === "" && <option value="">{`Select a ${kind}`}</option>}
            {missing && <option value={current}>{current} (missing)</option>}
            {names.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </select>
        );
      })}
    </div>
  );
}

/** References to several objects: a checkbox per object of the kind. */
function ReferencesControl({
  form,
  spec,
  input,
  common,
  value,
}: Args<"reference">) {
  const names = offered(spec, form.draft, form.context);
  const kind = kindLabel(input.kind);
  const items = Array.isArray(value) ? (value as string[]) : [];
  const all = [...names, ...items.filter((item) => !names.includes(item))];
  return (
    <div
      {...common}
      role="group"
      aria-labelledby={`${common.id}-label`}
      class="checks"
    >
      {all.length === 0 && <span class="muted">No {kind} yet.</span>}
      {all.map((name) => (
        <label key={name} class="check">
          <input
            type="checkbox"
            checked={items.includes(name)}
            onChange={(event) => {
              const on = event.currentTarget.checked;
              const next = all.filter((v) =>
                v === name ? on : items.includes(v),
              );
              form.change(
                spec,
                next.length || spec.required ? next : undefined,
              );
            }}
          />
          {names.includes(name) ? name : `${name} (missing)`}
        </label>
      ))}
      {!spec.required &&
        items.length === 0 &&
        all.length > 0 &&
        spec.placeholder && (
          <span class="muted">{spec.placeholder} (default)</span>
        )}
    </div>
  );
}

/**
 * The controls by the type of their input; toggles, booleans and rows are rows of
 * the form of their own (FormRows.tsx).
 */
const CONTROLS: {
  [T in Input["type"]]?: (args: Args<T>) => JSX.Element;
} = {
  name: TextControl,
  text: TextControl,
  number: NumberControl,
  integers: IntegersControl,
  numbers: NumbersControl,
  coordinates: CoordinatesControl,
  choice: ChoiceControl,
  variant: VariantControl,
  multichoice: MultiChoiceControl,
  reference: ReferenceControl,
};

/** The describing elements of a field: its hint, its error and its value. */
function describedBy(form: Form, spec: FieldSpec, id: string) {
  const error = form.errorOf(spec.key);
  const issue = form.issueOf(spec);
  return (
    [
      spec.hint && `${id}-hint`,
      (error || issue) && `${id}-error`,
      !error && form.valueHint(spec) && `${id}-value`,
    ]
      .filter(Boolean)
      .join(" ") || undefined
  );
}

/** The control of a field, with its id, label and descriptions for assistive tools. */
export function control(form: Form, spec: FieldSpec): JSX.Element | null {
  const id = form.idOf(spec.key);
  const common: Common = {
    id,
    // a cell of rows has no visible label of its own
    "aria-label":
      spec.row === undefined ? undefined : `${spec.label} ${spec.row + 1}`,
    "aria-invalid": form.errorOf(spec.key) ? true : undefined,
    "aria-describedby": describedBy(form, spec, id),
  };
  const render = CONTROLS[spec.input.type] as
    ((args: Args<Input["type"]>) => JSX.Element) | undefined;
  if (!render) return null;
  const value = getValue(form.draft, spec.path);
  return render({ form, spec, input: spec.input, common, value });
}
