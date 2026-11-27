// The rows of a command form (#312): a field with its label, control, value,
// hint and message, a boolean, an optional object (a toggle) and a table of rows.
import { Fragment } from "preact";
import { useState } from "preact/hooks";
import {
  addRow,
  cells,
  type Draft,
  type FieldSpec,
  getValue,
} from "../core/form";
import { withUnit } from "../core/units";
import { control } from "./FormControls";
import type { Form } from "./useCommandForm";

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

interface FieldProps {
  form: Form;
  spec: FieldSpec;
}

/** The hint of a field below its control. */
const Hint = ({ id, hint }: { id: string; hint?: string }) =>
  hint ? (
    <small id={`${id}-hint`} class="muted">
      {hint}
    </small>
  ) : null;

/**
 * The hint of a field whose words of its action are a link that runs it, e.g.
 * *Download template* of the script of a material (#453), with its error below.
 */
function ActionHint({ form, spec, id }: FieldProps & { id: string }) {
  const [error, setError] = useState<string>();
  const action = form.actionOf(spec);
  const hint = spec.hint ?? "";
  const at = action ? hint.indexOf(action.label) : -1;
  if (!action || at < 0) return <Hint id={id} hint={spec.hint} />;
  const run = async () => {
    setError(undefined);
    try {
      await action.run(form, spec);
    } catch (failure) {
      setError((failure as Error).message);
    }
  };
  return (
    <>
      <small id={`${id}-hint`} class="muted">
        {hint.slice(0, at)}
        <button
          type="button"
          class="link"
          title={action.title}
          onClick={() => void run()}
        >
          {action.label}
        </button>
        {hint.slice(at + action.label.length)}
      </small>
      {error && <small class="field-error">{error}</small>}
    </>
  );
}

/**
 * The class of the row of a field: nested in an object, or grayed out without the
 * value of another field (#463).
 */
const rowClass = (spec: FieldSpec) =>
  [
    "form-row",
    spec.path.length > 1 ? "nested" : undefined,
    spec.off ? "off" : undefined,
  ]
    .filter(Boolean)
    .join(" ");

/** A boolean: a checkbox with its label. */
export function BooleanField({ form, spec }: FieldProps) {
  if (spec.input.type !== "boolean") return null;
  const id = form.idOf(spec.key);
  const value = getValue(form.draft, spec.path);
  const checked = typeof value === "boolean" ? value : spec.input.default;
  return (
    <div class={rowClass(spec)}>
      <span class="form-label" />
      <div class="form-control">
        <label class="check" title={spec.description}>
          <input
            id={id}
            type="checkbox"
            checked={checked}
            aria-describedby={
              (spec.off ?? spec.hint) ? `${id}-hint` : undefined
            }
            onChange={(event) => form.change(spec, event.currentTarget.checked)}
          />
          {spec.label}
        </label>
        <Hint id={id} hint={spec.off ?? spec.hint} />
      </div>
    </div>
  );
}

/** An optional object, e.g. a cutback: on with its defaults, or off. */
export function ToggleField({ form, spec }: FieldProps) {
  const id = form.idOf(spec.key);
  const on = getValue(form.draft, spec.path) !== undefined;
  return (
    <div class="form-toggle">
      <label class="check" title={spec.description}>
        <input
          id={id}
          type="checkbox"
          checked={on}
          aria-describedby={spec.hint ? `${id}-hint` : undefined}
          onChange={(event) =>
            form.change(spec, event.currentTarget.checked ? {} : undefined)
          }
        />
        {spec.label}
      </label>
      <Hint id={id} hint={spec.hint} />
    </div>
  );
}

/** The messages of the cells of a row: an error or an issue, else a value. */
function CellMessages({
  form,
  cell,
  row,
}: {
  form: Form;
  cell: FieldSpec;
  row: number;
}) {
  const message = form.errorOf(cell.key);
  // an issue of the stored command at the cell, e.g. of an expression (#242)
  const issue = form.issueOf(cell);
  const shown = !message && form.valueHint(cell);
  const id = form.idOf(cell.key);
  return (
    <>
      {(message || issue) && (
        <small
          id={`${id}-error`}
          class={`${message ? "field-error" : "field-issue"} rows-error`}
        >
          {cell.label} {row + 1}: {message ?? issue}
        </small>
      )}
      {shown && !issue && (
        <small id={`${id}-value`} class="muted rows-error">
          {cell.label} {row + 1} {shown}
        </small>
      )}
    </>
  );
}

/** A table of rows, e.g. the items of a ramp, with a row to add. */
export function RowsField({ form, spec }: FieldProps) {
  if (spec.input.type !== "rows") return null;
  const { type, draft, context } = form;
  const id = form.idOf(spec.key);
  const { columns, minItems } = spec.input;
  const rows = cells(spec, draft);
  const seed = addRow(type, spec, draft, context).at(-1)!;
  // a new row needs an object that is not used yet
  const full = columns.some(
    (c) => c.unique && c.required && seed[c.path.at(-1)!] === undefined,
  );
  const template = [
    ...columns.map((c) =>
      c.input.type === "reference" ? "minmax(0, 1.6fr)" : "minmax(0, 1fr)",
    ),
    "28px",
  ].join(" ");
  const remove = (i: number) => {
    const value = getValue(draft, spec.path) as Draft[];
    form.change(
      spec,
      value.filter((_, j) => j !== i),
    );
  };
  return (
    <div
      id={id}
      tabIndex={-1}
      class={spec.path.length > 1 ? "form-rows nested" : "form-rows"}
      role="group"
      aria-labelledby={`${id}-label`}
      aria-describedby={spec.hint ? `${id}-hint` : undefined}
    >
      <span id={`${id}-label`} class="form-label" title={spec.description}>
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
                {control(form, cell)}
                {form.unit(cell) && (
                  <span class="unit muted">{form.unit(cell)}</span>
                )}
              </div>
            ))}
            <button
              type="button"
              class="icon-button"
              aria-label={`Remove row ${i + 1}`}
              title="Remove"
              disabled={rows.length <= Math.max(minItems, 1)}
              onClick={() => remove(i)}
            >
              ×
            </button>
            {row.map((cell) => (
              <CellMessages key={cell.key} form={form} cell={cell} row={i} />
            ))}
          </Fragment>
        ))}
      </div>
      <div class="rows-actions">
        <button
          type="button"
          class="button"
          disabled={full}
          title={full ? "Every object is used" : undefined}
          onClick={() => form.change(spec, addRow(type, spec, draft, context))}
        >
          + Add row
        </button>
      </div>
      <Hint id={id} hint={spec.hint} />
      <Message
        id={id}
        error={form.errorOf(spec.key)}
        issue={form.issueOf(spec)}
      />
    </div>
  );
}

/** A field: its label (with its unit), control, value, hint and message. */
export function FieldRow({ form, spec }: FieldProps) {
  const id = form.idOf(spec.key);
  const error = form.errorOf(spec.key);
  const hint = !error && form.valueHint(spec);
  const label = withUnit(spec.label, form.unit(spec));
  // a group of checkboxes is labelled by its label, not a label of a control
  const group =
    spec.input.type === "multichoice" ||
    (spec.input.type === "reference" && spec.input.multiple);
  return (
    <div class={rowClass(spec)}>
      {group ? (
        <span id={`${id}-label`} class="form-label" title={tooltip(spec)}>
          {label}
        </span>
      ) : (
        <label for={id} class="form-label" title={tooltip(spec)}>
          {label}
        </label>
      )}
      <div class="form-control">
        {control(form, spec)}
        {hint && (
          <small id={`${id}-value`} class="muted expression-value">
            {hint}
          </small>
        )}
        {/* a field without an effect says why instead of its hint (#463) */}
        {spec.off ? (
          <Hint id={id} hint={spec.off} />
        ) : (
          <ActionHint form={form} spec={spec} id={id} />
        )}
        <Message id={id} error={error} issue={form.issueOf(spec)} />
      </div>
    </div>
  );
}
