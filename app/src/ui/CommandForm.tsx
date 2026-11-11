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
  rampedQuantity,
  unitOf,
  unitsOf,
  withUnit,
} from "../core/units";
import type { CommandType } from "../core/validate";

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
}

/** Text of a number or id field while it is edited, with how to parse it. */
interface RawText {
  text: string;
  parse: (text: string) => unknown;
}

const fieldId = (key: string) => `field-${key.replace(/\./g, "-")}`;

const parseNumber = (text: string) =>
  text.trim() === "" ? undefined : Number(text.trim());

const parseIntegers = (text: string) =>
  text
    .split(/[,\s]+/)
    .filter((part) => part !== "")
    .map(Number);

const parseNumbers = (text: string) =>
  text
    .split(/[,\s]+/)
    .filter((part) => part !== "")
    .map(Number);

/** Points, one per line (or separated by ;), three numbers each. */
const parseCoordinates = (text: string) =>
  text
    .split(/[\n;]/)
    .map((line) => line.trim())
    .filter((line) => line !== "")
    .map((line) =>
      line
        .split(/[,\s]+/)
        .filter((part) => part !== "")
        .map(Number),
    );

const coordinatesText = (value: unknown) =>
  Array.isArray(value)
    ? value.map((p) => (Array.isArray(p) ? p.join(", ") : String(p))).join("\n")
    : "";

const numberText = (value: unknown) =>
  typeof value === "number" && Number.isFinite(value) ? String(value) : "";

/** Selected option of a variant field: a value, or the marker key of an object. */
function currentVariant(spec: FieldSpec, value: unknown): string {
  if (spec.input.type !== "variant") return "";
  if (typeof value === "string") return value;
  const keys = value && typeof value === "object" ? Object.keys(value) : [];
  return (
    spec.input.options.find((o) => keys.includes(o.value)) ??
    spec.input.options[0]
  ).value;
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
}: Props) {
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
    return unitOf(quantity, units);
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
    const invalid = specs.find((spec) => errors[spec.key]);
    if (invalid) {
      document.getElementById(fieldId(invalid.key))?.focus();
      return;
    }
    onSubmit(toCommand(type, draft, context));
  };

  const control = (spec: FieldSpec) => {
    const { input, key } = spec;
    const id = fieldId(key);
    const value = getValue(draft, spec.path);
    const error = errorOf(key);
    const issue = issueOf(spec);
    const describedBy =
      [spec.hint && `${id}-hint`, (error || issue) && `${id}-error`]
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
      case "number":
        return (
          <input
            {...common}
            type="text"
            inputMode={input.integer ? "numeric" : "decimal"}
            value={texts[key]?.text ?? numberText(value)}
            placeholder={spec.placeholder}
            autocomplete="off"
            onInput={(event) => {
              const text = event.currentTarget.value;
              change(spec, parseNumber(text), { text, parse: parseNumber });
            }}
          />
        );
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
      case "numbers":
        return (
          <input
            {...common}
            type="text"
            inputMode="decimal"
            value={
              texts[key]?.text ?? (Array.isArray(value) ? value.join(", ") : "")
            }
            placeholder={spec.placeholder}
            autocomplete="off"
            onInput={(event) => {
              const text = event.currentTarget.value;
              change(spec, parseNumbers(text), { text, parse: parseNumbers });
            }}
          />
        );
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
              change(spec, parseCoordinates(text), {
                text,
                parse: parseCoordinates,
              });
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
            {input.options.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
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
        const id = fieldId(spec.key);
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
                      return (
                        message && (
                          <small
                            key={`${cell.key}-error`}
                            id={`${fieldId(cell.key)}-error`}
                            class="field-error rows-error"
                          >
                            {cell.label} {i + 1}: {message}
                          </small>
                        )
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
