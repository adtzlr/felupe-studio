// The command line: parse a line, run it on the model store and complete what is
// being typed. Every GUI action is a command (ADR 0003), so the command line accepts
// the same JSON as the project file:
//
//   material.add {"name": "rubber", "model": "NeoHooke", "parameters": {"mu": 1}}
//   {"command": "material.add", "name": "rubber", ...}
//   material.add                      opens the dialog of a new material
//   delete rubber · select rubber · undo · redo · help
import type { Command } from "./commands";
import {
  type Context,
  type Draft,
  draftErrors,
  fieldSpecs,
  initialDraft,
  toCommand,
} from "./form";
import { REGISTRY } from "./registry";
import { ribbonGroups } from "./ribbon";
import type { ModelStore } from "./store";
import type { CommandType } from "./validate";

export type Action =
  | { type: "create"; command: CommandType; values: Draft }
  | { type: "open"; command: CommandType }
  | { type: "delete"; name: string }
  | { type: "select"; name: string }
  | { type: "undo" }
  | { type: "redo" }
  | { type: "help" };

export interface Result {
  ok: boolean;
  message: string;
  /** Object to select after the command. */
  select?: string;
  /** Command whose dialog to open. */
  open?: CommandType;
}

export class CommandLineError extends Error {}

const TYPES = Object.keys(REGISTRY) as CommandType[];
const KEYWORDS = ["delete", "select", "undo", "redo", "help"] as const;
const KEYWORD_HINTS: Record<(typeof KEYWORDS)[number], string> = {
  delete: "Delete an object",
  select: "Select an object",
  undo: "Undo the last change",
  redo: "Redo the last undone change",
  help: "Show the syntax",
};

export const HELP =
  'Type a command and a JSON object, e.g. material.add {"name": "rubber", ' +
  '"model": "NeoHooke", "parameters": {"mu": 1}}; a command alone opens its dialog. ' +
  "Also: delete <name>, select <name>, undo, redo. Tab completes.";

const isType = (word: string): word is CommandType =>
  (TYPES as string[]).includes(word);

function parseObject(text: string): Draft {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch (error) {
    throw new CommandLineError(`Invalid JSON: ${(error as Error).message}`);
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new CommandLineError("Expected a JSON object in braces {…}.");
  }
  return value as Draft;
}

/** Parse a line of the command line; throws a CommandLineError with a message. */
export function parseLine(line: string): Action {
  const text = line.trim();
  if (text.startsWith("{")) {
    const { command, ...values } = parseObject(text);
    if (typeof command !== "string" || !isType(command)) {
      throw new CommandLineError(
        `The object needs a "command", one of: ${TYPES.join(", ")}.`,
      );
    }
    return { type: "create", command, values };
  }

  const [word, ...restParts] = text.split(/\s+/);
  const rest = text.slice(word.length).trim();
  switch (word) {
    case "undo":
    case "redo":
    case "help":
      if (rest) throw new CommandLineError(`${word} takes no arguments.`);
      return { type: word };
    case "delete":
    case "select":
      if (restParts.length !== 1)
        throw new CommandLineError(`Usage: ${word} <name>`);
      return { type: word, name: rest };
  }
  if (isType(word)) {
    if (!rest) return { type: "open", command: word };
    const values = parseObject(rest);
    if ("command" in values)
      throw new CommandLineError('Leave out "command" after the type.');
    return { type: "create", command: word, values };
  }
  const close = [...TYPES, ...KEYWORDS].filter((c) =>
    c.startsWith(word.slice(0, 3)),
  );
  const hint = close.length
    ? ` Did you mean ${close.slice(0, 3).join(", ")}?`
    : "";
  throw new CommandLineError(
    `Unknown command '${word}'.${hint} Type help for the syntax.`,
  );
}

/** Paths of the values that are not part of the command, e.g. unknown keys. */
function unusedPaths(
  values: Draft,
  command: Draft,
  prefix: string[] = [],
): string[] {
  const result: string[] = [];
  for (const [key, value] of Object.entries(values)) {
    const path = [...prefix, key];
    if (!(key in command)) result.push(path.join("."));
    else if (value && typeof value === "object" && !Array.isArray(value)) {
      const other = command[key];
      if (other && typeof other === "object" && !Array.isArray(other)) {
        result.push(...unusedPaths(value as Draft, other as Draft, path));
      }
    }
  }
  return result;
}

/** Create a command from the values of the command line, or the messages why not. */
export async function createCommand(
  type: CommandType,
  values: Draft,
  context: Context,
): Promise<{ command?: Command; errors: string[] }> {
  const draft = initialDraft(type, context, values);
  const fieldErrors = Object.entries(draftErrors(type, draft, context)).map(
    ([key, message]) => `${key}: ${message}`,
  );
  if (fieldErrors.length) return { errors: fieldErrors };

  const command = toCommand(type, draft, context);
  const unused = unusedPaths(values, command as unknown as Draft);
  if (unused.length) {
    const fields = fieldSpecs(type, draft)
      .filter((spec) => spec.input.type !== "toggle")
      .map((spec) => spec.key);
    return {
      errors: [
        `Not part of ${type} here: ${unused.join(", ")}. Fields: ${fields.join(", ")}.`,
      ],
    };
  }

  // the complete schema check of the command, as a safety net
  const { commandErrors } = await import("./project");
  const errors = commandErrors(command);
  return errors.length ? { errors } : { command, errors: [] };
}

/** Run an action on the store. */
export async function run(action: Action, store: ModelStore): Promise<Result> {
  switch (action.type) {
    case "help":
      return { ok: true, message: HELP };
    case "undo":
    case "redo": {
      const can = action.type === "undo" ? store.canUndo : store.canRedo;
      if (!can) return { ok: false, message: `Nothing to ${action.type}.` };
      store[action.type]();
      return {
        ok: true,
        message: action.type === "undo" ? "Undone." : "Redone.",
      };
    }
    case "select":
      if (!store.get(action.name)) {
        return {
          ok: false,
          message: `There is no object named '${action.name}'.`,
        };
      }
      return {
        ok: true,
        message: `Selected ${action.name}.`,
        select: action.name,
      };
    case "delete": {
      if (!store.get(action.name)) {
        return {
          ok: false,
          message: `There is no object named '${action.name}'.`,
        };
      }
      const dependents = store.dependents(action.name);
      if (dependents.length) {
        return {
          ok: false,
          message: `${action.name} is used by ${dependents.join(", ")}: delete these first.`,
        };
      }
      store.apply({ type: "remove", name: action.name });
      return { ok: true, message: `Deleted ${action.name}.` };
    }
    case "open":
      return { ok: true, message: "", open: action.command };
    case "create": {
      const { command, errors } = await createCommand(
        action.command,
        action.values,
        {
          commands: store.commands,
        },
      );
      if (!command)
        return { ok: false, message: `Not created: ${errors.join(" ")}` };
      store.apply({ type: "add", command });
      return {
        ok: true,
        message: `Created ${command.name}.`,
        select: command.name,
      };
    }
  }
}

/** Parse and run a line; parse errors become a failed result. */
export async function runLine(
  line: string,
  store: ModelStore,
): Promise<Result> {
  try {
    return await run(parseLine(line), store);
  } catch (error) {
    if (error instanceof CommandLineError)
      return { ok: false, message: error.message };
    throw error;
  }
}

export interface Suggestion {
  /** Text that replaces the line from `from` on. */
  value: string;
  label: string;
  detail?: string;
}

export interface Completion {
  from: number;
  items: Suggestion[];
}

const template = (draft: Draft) =>
  JSON.stringify(
    Object.fromEntries(
      Object.entries(draft).filter(([key]) => key !== "command"),
    ),
  );

/** Suggestions for the word that is being typed at the end of the line. */
export function complete(
  line: string,
  commands: readonly Command[],
): Completion {
  const leading = line.length - line.trimStart().length;
  const text = line.slice(leading);
  const space = text.search(/\s/);

  // the first word: commands and keywords
  if (space < 0) {
    const word = text.toLowerCase();
    const items: Suggestion[] = [
      ...TYPES.map((type) => ({
        value: `${type} `,
        label: type,
        detail: REGISTRY[type].label,
      })),
      ...KEYWORDS.map((k) => ({
        value: k === "delete" || k === "select" ? `${k} ` : k,
        label: k,
        detail: KEYWORD_HINTS[k],
      })),
    ].filter((s) => s.label.startsWith(word) && s.label !== word);
    const contained = [...TYPES]
      .filter(
        (type) =>
          !type.startsWith(word) && word.length > 1 && type.includes(word),
      )
      .map((type) => ({
        value: `${type} `,
        label: type,
        detail: REGISTRY[type].label,
      }));
    return { from: leading, items: [...items, ...contained] };
  }

  const word = text.slice(0, space);
  const rest = text.slice(space).trimStart();
  const from = line.length - rest.length;

  // names of objects
  if (word === "delete" || word === "select") {
    if (/\s/.test(rest)) return { from, items: [] };
    const items = commands
      .filter((c) => c.name.startsWith(rest) && c.name !== rest)
      .map((c) => ({ value: c.name, label: c.name, detail: c.command }));
    return { from, items };
  }

  // a template of the values with the defaults, one per variant
  if (isType(word) && (rest === "" || rest === "{")) {
    const context = { commands };
    const tab = REGISTRY[word].tab;
    const items = ribbonGroups(tab)
      .flat()
      .filter((item) => item.type === word)
      .map((item) => {
        const value = template(initialDraft(word, context, item.preset));
        return { value, label: value, detail: item.label };
      });
    return { from, items };
  }
  return { from, items: [] };
}

/** The line after accepting a suggestion. */
export function accept(
  line: string,
  completion: Completion,
  suggestion: Suggestion,
): string {
  return line.slice(0, completion.from) + suggestion.value;
}
