// The parameters of a project (#183): when a project with parameters is opened, and
// from the menu of a parameter. One row per parameter with its description, its value
// with its unit and, with a range, a slider. The changed values are one undo step,
// and the meshes of scripts follow them. A project with scripts that make meshes
// says so, and shows the scripts before they run. A parameter shows the objects whose
// expressions use it, and the problems of the expressions with the typed values
// (#242).
import { useState } from "preact/hooks";
import type { Command } from "../core/commands";
import { type MeshFiles, meshFileNames, isScript } from "../core/meshfiles";
import { type Parameter, parameterProblems } from "../core/parameters";
import { resolveCommands, usesName } from "../core/resolve";
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
  /**
   * Python runs on this computer (`felupe-studio serve`, #240): the scripts run with
   * the rights of the user, so a project with scripts shows them before they run,
   * also without parameters.
   */
  local?: boolean;
  onClose: () => void;
}

/** The parameters of a model, in their order. */
export const parametersOf = (commands: readonly Command[]): Parameter[] =>
  commands.filter((c): c is Parameter => c.command === "parameter.add");

/** The problems of the expressions of changed commands that the others lack. */
function newProblems(before: readonly Command[], after: readonly Command[]) {
  const known = new Set(resolveCommands(before).problems.map((p) => p.message));
  return resolveCommands(after).problems.filter((p) => !known.has(p.message));
}

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
  local = false,
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
  // the objects whose expressions use a parameter, and the problems of the
  // expressions with the typed values (#242)
  const usedBy = (name: string) =>
    store.commands.filter((c) => usesName(c, name)).map((c) => c.name);
  const typed = store.commands.map((c) => {
    const row = changed.find((r) => r.p.name === c.name);
    return row ? { ...row.p, value: row.value } : c;
  });
  const expressions = changed.length ? newProblems(store.commands, typed) : [];

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
      title={
        !rows.length
          ? `Open ${project}`
          : opening
            ? `Parameters of ${project}`
            : "Parameters"
      }
      onClose={onClose}
      wide
    >
      {/* the values are checked like the model (parameterProblems), not by the
          browser: a value between the steps of the slider is fine */}
      <form class="parameters-dialog" onSubmit={apply} noValidate>
        {opening && rows.length > 0 && (
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
            const used = usedBy(p.name);
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
                    [
                      ranged
                        ? `${p.min} to ${p.max}${unit ? ` ${unit}` : ""}${p.integer ? ", an integer" : ""}`
                        : p.integer
                          ? "An integer"
                          : "",
                      used.length ? `used by ${used.join(", ")}` : "",
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                </small>
              </div>
            );
          })}
        </div>
        {expressions.length > 0 && (
          <div
            class="plan warning-plan"
            role="note"
            aria-label="Problems of the expressions"
          >
            <span>
              With these values, expressions of the model have problems:
            </span>
            <ul>
              {expressions.map((problem) => (
                <li key={problem.message}>
                  {problem.message.replace(/^commands\/\d+: /, "")}
                </li>
              ))}
            </ul>
          </div>
        )}
        {scripts.length > 0 && (
          <div class="plan" role="note" aria-label="Scripts of the project">
            <span>
              The project makes its meshes with{" "}
              {scripts.length === 1
                ? "a Python script, which runs"
                : "Python scripts, which run"}{" "}
              {local
                ? "on this computer with your rights, in the local Python of felupe-studio serve, like the jobs:"
                : "in this browser (in the worker of Python, like the jobs):"}
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
          {rows.length > 0 && (
            <button type="button" class="button" onClick={onClose}>
              {opening ? "Keep the saved values" : "Cancel"}
            </button>
          )}
          <button type="submit" class="button primary" disabled={invalid}>
            {opening ? "Open" : "Apply"}
          </button>
        </div>
      </form>
    </Dialog>
  );
}
