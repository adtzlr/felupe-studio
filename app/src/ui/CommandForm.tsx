// Form of a command. Its fields come from the schema and the registry (form.ts);
// this component only renders them and collects the input.
import type { ComponentChildren } from "preact";
import { useState } from "preact/hooks";
import type { Command } from "../core/commands";
import {
  available,
  type Context,
  type Draft,
  draftErrors,
  type FieldSpec,
  fieldSpecs,
  getValue,
  sameDraft,
  setValue,
  toCommand,
} from "../core/form";
import { KIND_LABELS } from "../core/registry";
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

export function CommandForm({
  type,
  initial,
  context,
  submitLabel,
  requireChange = false,
  onSubmit,
  onCancel,
  children,
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

  const reset = () => {
    setDraft(start);
    setTexts({});
    setTouched(new Set());
    setSubmitted(false);
  };

  const submit = (event: Event) => {
    event.preventDefault();
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
    const describedBy =
      [spec.hint && `${id}-hint`, error && `${id}-error`]
        .filter(Boolean)
        .join(" ") || undefined;
    const common = {
      id,
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
      case "choice":
        return (
          <select
            {...common}
            value={typeof value === "string" ? value : ""}
            onChange={(event) =>
              change(spec, event.currentTarget.value || undefined)
            }
          >
            {!spec.required && (
              <option value="">{spec.placeholder ?? "none"}</option>
            )}
            {input.options.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        );
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
        const names = available(context, input.kind);
        const kind = KIND_LABELS[input.kind].toLowerCase();
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
                <span class="muted">none selected: {spec.placeholder}</span>
              )}
          </div>
        );
      }
      case "toggle":
        return null;
    }
  };

  return (
    <form
      class="command-form"
      noValidate
      onSubmit={submit}
      aria-label={`${start.name ?? "New object"}`}
    >
      {specs.map((spec) => {
        const id = fieldId(spec.key);
        const error = errorOf(spec.key);
        if (spec.input.type === "toggle") {
          const on = getValue(draft, spec.path) !== undefined;
          return (
            <label
              key={spec.key}
              class="check form-toggle"
              title={spec.description}
            >
              <input
                id={id}
                type="checkbox"
                checked={on}
                onChange={(event) =>
                  change(spec, event.currentTarget.checked ? {} : undefined)
                }
              />
              {spec.label}
            </label>
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
              <span
                id={`${id}-label`}
                class="form-label"
                title={spec.description}
              >
                {spec.label}
              </span>
            ) : (
              <label for={id} class="form-label" title={spec.description}>
                {spec.label}
              </label>
            )}
            <div class="form-control">
              {control(spec)}
              {spec.hint && (
                <small id={`${id}-hint`} class="muted">
                  {spec.hint}
                </small>
              )}
              {error && (
                <small id={`${id}-error`} class="field-error">
                  {error}
                </small>
              )}
            </div>
          </div>
        );
      })}
      <div class="actions">
        <button
          type="submit"
          class="button primary"
          disabled={requireChange && !changed}
        >
          {submitLabel}
        </button>
        {requireChange && changed && (
          <button type="button" class="button" onClick={reset}>
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
