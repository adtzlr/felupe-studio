// Form of a command. Its fields come from the schema and the registry (form.ts);
// this component only renders them and collects the input.
import { type ComponentChildren, Fragment } from "preact";
import { useState } from "preact/hooks";
import type { Command } from "../core/commands";
import {
  addRow,
  cells,
  choiceOptions,
  type Context,
  type Draft,
  draftErrors,
  expressionValue,
  type FieldSpec,
  fieldSpecs,
  getValue,
  kindLabel,
  offered,
  sameDraft,
  setValue,
  toCommand,
} from "../core/form";
import {
  boundaryQuantity,
  type Quantity,
  rampedQuantity,
  unitOf,
  unitsOf,
  withUnit,
} from "../core/units";
import type { CommandType } from "../core/validate";
import { numberText as valueText } from "../core/resolve";

interface Props {
  type: CommandType;
  /** The command to edit, or the draft of a new command. */
  initial: Draft;
  context: Context;
  submitLabel: string;
  /** Enable submit only after a change (editing an existing object). */
  requireChange?: boolean;
  onSubmit: (command: Command) => void;
  onCancel?: () => void;
  /** Further buttons next to submit. */
  children?: ComponentChildren;
  /**
   * Issues of the validation of the stored command by field key, shown at their
   * field while it is unchanged (#137).
   */
  issues?: Readonly<Record<string, string>>;
  /**
   * A prefix of the ids of the fields, so that the labels of a form in a dialog
   * point to its own fields while the properties show another form (#181).
   */
  idPrefix?: string;
}

/** Text of a number or id field while it is edited, with how to parse it. */
interface RawText {
  text: string;
  parse: (text: string) => unknown;
}

const fieldId = (key: string) => `field-${key.replace(/\./g, "-")}`;

const NUMBER = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?$/i;

/**
 * A number, or an expression of the parameters as written (#242), without a leading
 * `=` (like a spreadsheet); a field without expressions takes numbers only.
 */
const parseValue = (text: string, expressions = false): unknown => {
  const trimmed = text.trim().replace(/^=\s*/, "");
  if (trimmed === "") return undefined;
  // a number with a decimal comma is not a number, nor an expression
  const number = NUMBER.test(trimmed) || /^[+-]?\d*,\d+$/.test(trimmed);
  return number || !expressions ? Number(trimmed) : trimmed;
};

/** The parts of a text between the commas outside of parentheses. */
function splitCommas(text: string): string[] {
  const parts = [""];
  let depth = 0;
  for (const char of text) {
    if (char === "(") depth++;
    if (char === ")") depth--;
    if (char === "," && depth <= 0) parts.push("");
    else parts[parts.length - 1] += char;
  }
  return parts;
}

/**
 * Numbers separated by commas or spaces, or with expressions of the parameters
 * separated by commas (#242), e.g. `0, 0, 2 * height`.
 */
const parseValues = (text: string, expressions = false): unknown[] =>
  splitCommas(text).flatMap((part) => {
    const words = part
      .trim()
      .split(/\s+/)
      .filter((w) => w !== "");
    if (!words.length) return [];
    if (!expressions || words.every((w) => NUMBER.test(w)))
      return words.map(Number);
    return [parseValue(part, true)];
  });

const parseIntegers = (text: string) =>
  text
    .split(/[,\s]+/)
    .filter((part) => part !== "")
    .map(Number);

/** Points, one per line (or separated by ;), three numbers each. */
const parseCoordinates = (text: string, expressions = false) =>
  text
    .split(/[\n;]/)
    .map((line) => line.trim())
    .filter((line) => line !== "")
    .map((line) => parseValues(line, expressions));

/** A number, or an expression as written. */
const valueOf = (value: unknown) =>
  typeof value === "string" ? value : String(value);

const coordinatesText = (value: unknown) =>
  Array.isArray(value)
    ? value
        .map((p) => (Array.isArray(p) ? p.map(valueOf).join(", ") : valueOf(p)))
        .join("\n")
    : "";

const numberText = (value: unknown) =>
  typeof value === "string"
    ? value
    : typeof value === "number" && Number.isFinite(value)
      ? String(value)
      : "";

/** The hint of a field that takes expressions of the parameters (#242). */
const EXPRESSION_HINT =
  "A number, or an expression of the parameters, e.g. 2 * height";

/** Selected option of a variant field: a value, or the marker key of an object. */
function currentVariant(spec: FieldSpec, value: unknown): string {
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

/** The tooltip of a label: the key of a symbol (e.g. C10 of C₁₀), or the schema. */
const tooltip = (spec: FieldSpec) =>
  spec.symbolOf
    ? `${spec.symbolOf}${spec.description ? `: ${spec.description}` : ""}`
    : spec.description;

/** The error of a field, or else an issue of the stored command at the field. */
function Message({
  id,
  error,
  issue,
}: {
  id: string;
  error?: string;
  issue?: string;
}) {
  if (error)
    return (
      <small id={`${id}-error`} class="field-error">
        {error}
      </small>
    );
  if (issue)
    return (
      <small id={`${id}-error`} class="field-issue">
        {issue}
      </small>
    );
  return null;
}

export function CommandForm({
  type,
  initial,
  context,
  submitLabel,
  requireChange = false,
  onSubmit,
  onCancel,
  children,
  issues = {},
  idPrefix = "",
}: Props) {
  const idOf = (key: string) => idPrefix + fieldId(key);
  const [start] = useState(
    () => toCommand(type, initial, context) as unknown as Draft,
  );
  const [draft, setDraft] = useState<Draft>(start);
  const [texts, setTexts] = useState<Record<string, RawText>>({});
  const [touched, setTouched] = useState<ReadonlySet<string>>(new Set());
  const [submitted, setSubmitted] = useState(false);

  const specs = fieldSpecs(type, draft);
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
  const unit = (spec: FieldSpec) => {
    let quantity = spec.quantity;
    if (quantity === "displacement" && type === "boundary.add")
      quantity = boundaryQuantity(
        context.commands,
        draft.pointset as string | undefined,
      );
    if (quantity === "ramped") {
      const items = getValue(draft, ["ramp", "items"]);
      const row = Array.isArray(items) ? items[spec.row ?? -1] : undefined;
      quantity = rampedQuantity(context.commands, row?.target);
    }
    // the numbers of a parameter have the quantity of the parameter (#180)
    if (quantity === "parameter")
      quantity = draft.quantity as Quantity | undefined;
    return unitOf(quantity, units);
  };

  /**
   * The value of the expressions of a field (#242), e.g. `= 12 mm` or
   * `= (0, 0, 32) mm`, if it has expressions and they have values.
   */
  const valueHint = (spec: FieldSpec): string | undefined => {
    const value = getValue(draft, spec.path);
    const items = Array.isArray(value) ? value : [value];
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
    const value = getValue(draft, spec.path);
    const items = Array.isArray(value) ? value : [value];
    const expression = items.some((x) => typeof x === "string");
    const hint = valueHint(spec);
    return {
      class: expression ? "number-field expression" : "number-field",
      title: expression
        ? `${items.map(valueOf).join(", ")}${hint ? ` ${hint}` : ""}`
        : expressions && parametric
          ? EXPRESSION_HINT
          : undefined,
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

  const control = (spec: FieldSpec) => {
    const { input, key } = spec;
    const id = idOf(key);
    const value = getValue(draft, spec.path);
    const error = errorOf(key);
    const issue = issueOf(spec);
    const describedBy =
      [
        spec.hint && `${id}-hint`,
        (error || issue) && `${id}-error`,
        !error && valueHint(spec) && `${id}-value`,
      ]
        .filter(Boolean)
        .join(" ") || undefined;
    const common = {
      id,
      // a cell of rows has no visible label of its own
      "aria-label":
        spec.row === undefined ? undefined : `${spec.label} ${spec.row + 1}`,
      "aria-invalid": error ? true : undefined,
      "aria-describedby": describedBy,
    };

    switch (input.type) {
      case "name":
      case "text":
        return (
          <input
            {...common}
            type="text"
            value={typeof value === "string" ? value : ""}
            placeholder={spec.placeholder}
            autocomplete="off"
            spellcheck={false}
            onInput={(event) =>
              change(spec, event.currentTarget.value || undefined)
            }
          />
        );
      case "number": {
        const parse = (text: string) => parseValue(text, input.expressions);
        return (
          <input
            {...common}
            type="text"
            {...numberField(spec, input.expressions)}
            inputMode={mode(
              input.expressions,
              input.integer ? "numeric" : "decimal",
            )}
            value={texts[key]?.text ?? numberText(value)}
            placeholder={spec.placeholder}
            autocomplete="off"
            spellcheck={false}
            onInput={(event) => {
              const text = event.currentTarget.value;
              change(spec, parse(text), { text, parse });
            }}
          />
        );
      }
      case "integers":
        return (
          <input
            {...common}
            type="text"
            inputMode="numeric"
            value={
              texts[key]?.text ?? (Array.isArray(value) ? value.join(", ") : "")
            }
            placeholder={spec.placeholder}
            autocomplete="off"
            onInput={(event) => {
              const text = event.currentTarget.value;
              change(spec, parseIntegers(text), { text, parse: parseIntegers });
            }}
          />
        );
      case "numbers": {
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
            {...numberField(spec, input.expressions)}
            inputMode={mode(input.expressions, "decimal")}
            value={texts[key]?.text ?? shown}
            placeholder={spec.placeholder}
            autocomplete="off"
            spellcheck={false}
            onInput={(event) => {
              const text = event.currentTarget.value;
              change(spec, parse(text), { text, parse });
            }}
          />
        );
      }
      case "coordinates": {
        const text = texts[key]?.text ?? coordinatesText(value);
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
              change(spec, parse(text), { text, parse });
            }}
          />
        );
      }
      case "choice": {
        const { empty, options } = choiceOptions(spec, value);
        return (
          <select
            {...common}
            value={typeof value === "string" ? value : ""}
            onChange={(event) =>
              change(spec, event.currentTarget.value || undefined)
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
      case "variant":
        return (
          <select
            {...common}
            value={currentVariant(spec, value)}
            onChange={(event) =>
              change(spec, input.seeds[event.currentTarget.value])
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
      case "multichoice": {
        const items = Array.isArray(value) ? (value as string[]) : [];
        return (
          <div
            {...common}
            role="group"
            aria-labelledby={`${id}-label`}
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
                    change(spec, next);
                  }}
                />
                {o.label}
              </label>
            ))}
          </div>
        );
      }
      case "reference": {
        const names = offered(spec, draft, context);
        const kind = kindLabel(input.kind);
        if (!input.multiple) {
          const current = typeof value === "string" ? value : "";
          const missing = current !== "" && !names.includes(current);
          return (
            <select
              {...common}
              value={current}
              onChange={(event) =>
                change(spec, event.currentTarget.value || undefined)
              }
            >
              {(!spec.required || current === "") && (
                <option value="">
                  {spec.required
                    ? `Select a ${kind}`
                    : (spec.placeholder ?? "none")}
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
        const items = Array.isArray(value) ? (value as string[]) : [];
        const all = [
          ...names,
          ...items.filter((item) => !names.includes(item)),
        ];
        return (
          <div
            {...common}
            role="group"
            aria-labelledby={`${id}-label`}
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
                    change(
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
      case "toggle":
      case "boolean":
      case "rows":
        return null;
    }
  };

  return (
    <form
      class="command-form"
      noValidate
      onSubmit={submit}
      onKeyDown={(event) => {
        // Esc resets a changed form of an object (#137); in a dialog it closes it
        if (event.key !== "Escape" || !requireChange || !changed) return;
        event.preventDefault();
        event.stopPropagation();
        reset();
      }}
      aria-label={`${start.name ?? "New object"}`}
    >
      {specs.map((spec) => {
        const id = idOf(spec.key);
        const error = errorOf(spec.key);
        if (spec.input.type === "boolean") {
          const value = getValue(draft, spec.path);
          const checked =
            typeof value === "boolean" ? value : spec.input.default;
          return (
            <div
              key={spec.key}
              class={spec.path.length > 1 ? "form-row nested" : "form-row"}
            >
              <span class="form-label" />
              <div class="form-control">
                <label class="check" title={spec.description}>
                  <input
                    id={id}
                    type="checkbox"
                    checked={checked}
                    aria-describedby={spec.hint ? `${id}-hint` : undefined}
                    onChange={(event) =>
                      change(spec, event.currentTarget.checked)
                    }
                  />
                  {spec.label}
                </label>
                {spec.hint && (
                  <small id={`${id}-hint`} class="muted">
                    {spec.hint}
                  </small>
                )}
              </div>
            </div>
          );
        }
        if (spec.input.type === "toggle") {
          const on = getValue(draft, spec.path) !== undefined;
          return (
            <div key={spec.key} class="form-toggle">
              <label class="check" title={spec.description}>
                <input
                  id={id}
                  type="checkbox"
                  checked={on}
                  aria-describedby={spec.hint ? `${id}-hint` : undefined}
                  onChange={(event) =>
                    change(spec, event.currentTarget.checked ? {} : undefined)
                  }
                />
                {spec.label}
              </label>
              {spec.hint && (
                <small id={`${id}-hint`} class="muted">
                  {spec.hint}
                </small>
              )}
            </div>
          );
        }
        if (spec.input.type === "rows") {
          const { columns, minItems } = spec.input;
          const rows = cells(spec, draft);
          const seed = addRow(type, spec, draft, context).at(-1)!;
          // a new row needs an object that is not used yet
          const full = columns.some(
            (c) => c.unique && c.required && seed[c.path.at(-1)!] === undefined,
          );
          const template = [
            ...columns.map((c) =>
              c.input.type === "reference"
                ? "minmax(0, 1.6fr)"
                : "minmax(0, 1fr)",
            ),
            "28px",
          ].join(" ");
          return (
            <div
              key={spec.key}
              id={id}
              tabIndex={-1}
              class={spec.path.length > 1 ? "form-rows nested" : "form-rows"}
              role="group"
              aria-labelledby={`${id}-label`}
              aria-describedby={spec.hint ? `${id}-hint` : undefined}
            >
              <span
                id={`${id}-label`}
                class="form-label"
                title={spec.description}
              >
                {spec.label}
              </span>
              <div class="rows" style={{ gridTemplateColumns: template }}>
                {columns.map((c) => (
                  <span key={c.key} class="rows-head" aria-hidden="true">
                    {c.label}
                  </span>
                ))}
                <span />
                {rows.map((row, i) => (
                  <Fragment key={i}>
                    {row.map((cell) => (
                      <div key={cell.key} class="rows-cell">
                        {control(cell)}
                        {unit(cell) && (
                          <span class="unit muted">{unit(cell)}</span>
                        )}
                      </div>
                    ))}
                    <button
                      type="button"
                      class="icon-button"
                      aria-label={`Remove row ${i + 1}`}
                      title="Remove"
                      disabled={rows.length <= Math.max(minItems, 1)}
                      onClick={() => {
                        const value = getValue(draft, spec.path) as Draft[];
                        change(
                          spec,
                          value.filter((_, j) => j !== i),
                        );
                      }}
                    >
                      ×
                    </button>
                    {row.map((cell) => {
                      const message = errorOf(cell.key);
                      // an issue of the stored command at the cell, e.g. of an
                      // expression (#242)
                      const issue = issueOf(cell);
                      const shown = !message && valueHint(cell);
                      return (
                        <Fragment key={cell.key}>
                          {(message || issue) && (
                            <small
                              id={`${idOf(cell.key)}-error`}
                              class={`${message ? "field-error" : "field-issue"} rows-error`}
                            >
                              {cell.label} {i + 1}: {message ?? issue}
                            </small>
                          )}
                          {shown && !issue && (
                            <small
                              id={`${idOf(cell.key)}-value`}
                              class="muted rows-error"
                            >
                              {cell.label} {i + 1} {shown}
                            </small>
                          )}
                        </Fragment>
                      );
                    })}
                  </Fragment>
                ))}
              </div>
              <div class="rows-actions">
                <button
                  type="button"
                  class="button"
                  disabled={full}
                  title={full ? "Every object is used" : undefined}
                  onClick={() =>
                    change(spec, addRow(type, spec, draft, context))
                  }
                >
                  + Add row
                </button>
              </div>
              {spec.hint && (
                <small id={`${id}-hint`} class="muted">
                  {spec.hint}
                </small>
              )}
              <Message id={id} error={error} issue={issueOf(spec)} />
            </div>
          );
        }
        const group =
          spec.input.type === "multichoice" ||
          (spec.input.type === "reference" && spec.input.multiple);
        return (
          <div
            key={spec.key}
            class={spec.path.length > 1 ? "form-row nested" : "form-row"}
          >
            {group ? (
              <span id={`${id}-label`} class="form-label" title={tooltip(spec)}>
                {withUnit(spec.label, unit(spec))}
              </span>
            ) : (
              <label for={id} class="form-label" title={tooltip(spec)}>
                {withUnit(spec.label, unit(spec))}
              </label>
            )}
            <div class="form-control">
              {control(spec)}
              {!error && valueHint(spec) && (
                <small id={`${id}-value`} class="muted expression-value">
                  {valueHint(spec)}
                </small>
              )}
              {spec.hint && (
                <small id={`${id}-hint`} class="muted">
                  {spec.hint}
                </small>
              )}
              <Message id={id} error={error} issue={issueOf(spec)} />
            </div>
          </div>
        );
      })}
      <div class="actions">
        {/* editing: Apply and Reset only after a change (#137) */}
        {(!requireChange || changed) && (
          <button type="submit" class="button primary" title="Enter">
            {submitLabel}
          </button>
        )}
        {requireChange && changed && (
          <button type="button" class="button" title="Esc" onClick={reset}>
            Reset
          </button>
        )}
        {onCancel && (
          <button type="button" class="button" onClick={onCancel}>
            Cancel
          </button>
        )}
        {children}
      </div>
    </form>
  );
}
