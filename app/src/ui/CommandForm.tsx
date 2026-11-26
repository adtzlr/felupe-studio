// Form of a command. Its fields come from the schema and the registry (form.ts);
// this component renders them (FormRows.tsx, FormControls.tsx) and collects the
// input (useCommandForm.ts).
import type { ComponentChildren } from "preact";
import type { Command } from "../core/commands";
import type { Context, Draft, FieldSpec } from "../core/form";
import type { CommandType } from "../core/validate";
import { BooleanField, FieldRow, RowsField, ToggleField } from "./FormRows";
import { type FieldAction, type Form, useCommandForm } from "./useCommandForm";

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
  /**
   * The actions of the hints of fields by their key, e.g. *Download template* of the
   * script of a material (#453).
   */
  actions?: Readonly<Record<string, FieldAction>>;
}

/** The row of a field in the form, by the type of its input. */
function rowOf(form: Form, spec: FieldSpec) {
  switch (spec.input.type) {
    case "boolean":
      return <BooleanField key={spec.key} form={form} spec={spec} />;
    case "toggle":
      return <ToggleField key={spec.key} form={form} spec={spec} />;
    case "rows":
      return <RowsField key={spec.key} form={form} spec={spec} />;
    default:
      return <FieldRow key={spec.key} form={form} spec={spec} />;
  }
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
  actions,
}: Props) {
  const form = useCommandForm({
    type,
    initial,
    context,
    requireChange,
    onSubmit,
    issues,
    idPrefix,
    actions,
  });
  const { changed, reset } = form;
  return (
    <form
      class="command-form"
      noValidate
      onSubmit={form.submit}
      onKeyDown={(event) => {
        // Esc resets a changed form of an object (#137); in a dialog it closes it
        if (event.key !== "Escape" || !requireChange || !changed) return;
        event.preventDefault();
        event.stopPropagation();
        reset();
      }}
      aria-label={`${form.start.name ?? "New object"}`}
    >
      {form.specs.map((spec) => rowOf(form, spec))}
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
