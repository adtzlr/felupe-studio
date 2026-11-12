// The parameters of a project (#183): when a project with parameters is opened, and
// from the menu of a parameter. One row per parameter with its description, its value
// with its unit and, with a range, a slider. The changed values are one undo step,
// and the meshes of scripts follow them. A project with scripts that make meshes
// says so, and shows the scripts before they run.
import { useState } from "preact/hooks";
import type { Command } from "../core/commands";
import { type MeshFiles, meshFileNames, isScript } from "../core/meshfiles";
import { type Parameter, parameterProblems } from "../core/parameters";
import type { ModelStore } from "../core/store";
import { unitOf, unitsOf } from "../core/units";
import { Dialog } from "./Dialog";

interface Props {
  store: ModelStore;
  files: MeshFiles;
  /** The name of the project, e.g. bushing.felupe.zip. */
  project: string;
  /** Opened just now: the saved values may be kept. */
  opening: boolean;
  onClose: () => void;
}

/** The parameters of a model, in their order. */
export const parametersOf = (commands: readonly Command[]): Parameter[] =>
  commands.filter((c): c is Parameter => c.command === "parameter.add");

/** The step of the field and the slider of a parameter. */
function stepOf(p: Parameter): number | "any" {
  if (p.step !== undefined) return p.step;
  if (p.integer) return 1;
  if (p.min !== undefined && p.max !== undefined) return (p.max - p.min) / 100;
  return "any";
}

export function ParametersDialog({
  store,
  files,
  project,
  opening,
  onClose,
}: Props) {
  const parameters = parametersOf(store.commands);
  const units = unitsOf(store.commands);
  // the values as typed, by parameter
  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(parameters.map((p) => [p.name, String(p.value)])),
  );
  const [shown, setShown] = useState<string>();
  const scripts = meshFileNames(store.commands).filter(isScript);

  const rows = parameters.map((p) => {
    const text = values[p.name] ?? "";
    const value = Number(text);
    const problem =
      text.trim() === "" || !Number.isFinite(value)
        ? "Enter a number."
        : parameterProblems({ ...p, value })[0]?.message;
    return { p, text, value, problem };
  });
  const invalid = rows.some((r) => r.problem);
  const changed = rows.filter((r) => !r.problem && r.value !== r.p.value);

  const apply = (event: Event) => {
    event.preventDefault();
    if (invalid) return;
    if (changed.length) {
      store.apply(
        changed.map(({ p, value }) => ({
          type: "update" as const,
          name: p.name,
          command: { ...p, value },
        })),
      );
    }
    onClose();
  };

  return (
    <Dialog
      title={opening ? `Parameters of ${project}` : "Parameters"}
      onClose={onClose}
      wide
    >
      {/* the values are checked like the model (parameterProblems), not by the
          browser: a value between the steps of the slider is fine */}
      <form class="parameters-dialog" onSubmit={apply} noValidate>
        {opening && (
          <p class="muted">
            Set the values of the parameters before the meshes are made, or keep
            the saved values.
          </p>
        )}
        <div class="parameter-rows">
          {rows.map(({ p, text, value, problem }) => {
            const unit = unitOf(p.quantity, units);
            const id = `parameter-${p.name}`;
            const ranged = p.min !== undefined && p.max !== undefined;
            return (
              <div class="parameter-row" key={p.name}>
                <label for={id} class="parameter-label">
                  <span>{p.description ?? p.name}</span>
                  {p.description && <code class="muted">{p.name}</code>}
                </label>
                <div class="parameter-value">
                  <input
                    id={id}
                    type="number"
                    value={text}
                    step={stepOf(p)}
                    min={p.min}
                    max={p.max}
                    aria-invalid={problem ? true : undefined}
                    aria-describedby={`${id}-hint`}
                    onInput={(event) =>
                      setValues({
                        ...values,
                        [p.name]: event.currentTarget.value,
                      })
                    }
                  />
                  {unit && <span class="muted">{unit}</span>}
                </div>
                {ranged && (
                  <input
                    type="range"
                    class="parameter-slider"
                    aria-label={`${p.description ?? p.name} (slider)`}
                    min={p.min}
                    max={p.max}
                    step={stepOf(p)}
                    value={Number.isFinite(value) ? value : p.value}
                    onInput={(event) =>
                      setValues({
                        ...values,
                        [p.name]: event.currentTarget.value,
                      })
                    }
                  />
                )}
                <small
                  id={`${id}-hint`}
                  class={problem ? "field-error" : "muted"}
                >
                  {problem ??
                    (ranged
                      ? `${p.min} to ${p.max}${unit ? ` ${unit}` : ""}${p.integer ? ", an integer" : ""}`
                      : p.integer
                        ? "An integer"
                        : "")}
                </small>
              </div>
            );
          })}
        </div>
        {scripts.length > 0 && (
          <div class="plan" role="note" aria-label="Scripts of the project">
            <span>
              The project makes its meshes with{" "}
              {scripts.length === 1
                ? "a Python script, which runs"
                : "Python scripts, which run"}{" "}
              in this browser (in the worker of Python, like the jobs):
            </span>
            <ul>
              {scripts.map((name) => {
                const data = files.dataOf(name);
                return (
                  <li key={name}>
                    <code>{name}</code>{" "}
                    {data ? (
                      <button
                        type="button"
                        class="link"
                        aria-expanded={shown === name}
                        onClick={() =>
                          setShown(shown === name ? undefined : name)
                        }
                      >
                        {shown === name ? "Hide" : "Show"}
                      </button>
                    ) : (
                      <span class="warning">not loaded</span>
                    )}
                    {shown === name && data && (
                      <pre class="script-text">
                        {new TextDecoder().decode(data)}
                      </pre>
                    )}
                  </li>
                );
              })}
            </ul>
          </div>
        )}
        <div class="actions">
          <button type="button" class="button" onClick={onClose}>
            {opening ? "Keep the saved values" : "Cancel"}
          </button>
          <button type="submit" class="button primary" disabled={invalid}>
            {opening ? "Open" : "Apply"}
          </button>
        </div>
      </form>
    </Dialog>
  );
}
