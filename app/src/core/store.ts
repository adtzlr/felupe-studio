// Model store: the command list with undo and redo, and the state derived from it.
import type { CheckReport } from "./checks";
import type { Command, CommandList } from "./commands";
import { duplicateBlocker, duplicateCommand } from "./duplicate";
import { SCHEMA_VERSION } from "./schema";
import { type TreeNode, deriveTree } from "./tree";
import {
  type Issue,
  order,
  references,
  renameReferences,
  validate,
} from "./validate";

export type Edit =
  | { type: "add"; command: Command; index?: number }
  | { type: "update"; name: string; command: Command }
  | { type: "remove"; name: string };

export class StoreError extends Error {}

/** Number of undo steps kept. */
export const HISTORY_LIMIT = 100;

type Commands = readonly Command[];

export class ModelStore {
  private list: Commands = [];
  private past: Commands[] = [];
  private future: Commands[] = [];
  private listeners = new Set<() => void>();
  private checkReport: CheckReport | undefined;
  private cache: {
    list: Commands;
    report?: CheckReport;
    issues: Issue[];
    tree: TreeNode[];
  } = { list: [], issues: [], tree: deriveTree([]) };

  constructor(document?: CommandList) {
    if (document) this.list = freeze(document.commands);
  }

  /** The command list as a document (schema version and commands). */
  get document(): CommandList {
    return {
      schema_version: SCHEMA_VERSION as 3,
      commands: structuredClone([...this.list]),
    };
  }

  get commands(): Commands {
    return this.list;
  }

  get canUndo(): boolean {
    return this.past.length > 0;
  }

  get canRedo(): boolean {
    return this.future.length > 0;
  }

  /** Validation issues of the command list. */
  get issues(): Issue[] {
    return this.derived().issues;
  }

  /** Browser tree of the model. */
  get tree(): TreeNode[] {
    return this.derived().tree;
  }

  /** Check report of the worker (cell assignment, interfaces), if computed. */
  get report(): CheckReport | undefined {
    return this.checkReport;
  }

  /** Find a command by its name. */
  get(name: string): Command | undefined {
    return this.list.find((c) => c.name === name);
  }

  /** Names of the commands which reference the given name. */
  dependents(name: string): string[] {
    return this.list
      .filter((c) => references(c).some((r) => r.name === name))
      .map((c) => c.name);
  }

  /**
   * Apply one edit or several edits as one undo step. A command that references an
   * object after it moves behind it, with the commands that depend on it (#80).
   */
  apply(edits: Edit | Edit[]): void {
    let list = [...this.list];
    for (const edit of Array.isArray(edits) ? edits : [edits]) {
      list = applyEdit(list, edit);
    }
    list = order(list);
    this.past.push(this.list);
    if (this.past.length > HISTORY_LIMIT) this.past.shift();
    this.future = [];
    this.set(freeze(list), undefined);
  }

  /**
   * Change a command as one undo step. If the command is renamed, the references
   * of the other commands follow.
   */
  update(name: string, command: Command): void {
    const edits: Edit[] = [{ type: "update", name, command }];
    if (command.name !== name) {
      for (const other of this.list) {
        if (
          other.name !== name &&
          references(other).some((r) => r.name === name)
        ) {
          const renamed = renameReferences(other, name, command.name);
          edits.push({ type: "update", name: other.name, command: renamed });
        }
      }
    }
    this.apply(edits);
  }

  /**
   * Duplicate an object (#138): a copy with the next free name after the original,
   * as one undo step. Returns the name of the copy, or undefined if the object
   * cannot be duplicated (e.g. the model settings).
   */
  duplicate(name: string): string | undefined {
    const command = this.get(name);
    if (!command || duplicateBlocker(command)) return undefined;
    const copy = duplicateCommand(command, this.list);
    this.apply({
      type: "add",
      command: copy,
      index: indexOf(this.list, name) + 1,
    });
    return copy.name;
  }

  undo(): void {
    const previous = this.past.pop();
    if (!previous) return;
    this.future.push(this.list);
    this.set(previous, undefined);
  }

  redo(): void {
    const next = this.future.pop();
    if (!next) return;
    this.past.push(this.list);
    this.set(next, undefined);
  }

  /** Replace the model, e.g. after opening a project file. Clears the history. */
  load(document: CommandList): void {
    this.past = [];
    this.future = [];
    this.set(freeze(document.commands), undefined);
  }

  /** Store the check report of the worker for the current command list. */
  setReport(report: CheckReport | undefined): void {
    this.checkReport = report;
    this.notify();
  }

  /** Call the listener after every change; returns a function to unsubscribe. */
  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private set(list: Commands, report: CheckReport | undefined): void {
    this.list = list;
    // a report belongs to the command list it was computed for
    this.checkReport = report;
    this.notify();
  }

  private notify(): void {
    for (const listener of this.listeners) listener();
  }

  private derived() {
    if (
      this.cache.list !== this.list ||
      this.cache.report !== this.checkReport
    ) {
      const issues = validate(this.list);
      this.cache = {
        list: this.list,
        report: this.checkReport,
        issues,
        tree: deriveTree(this.list, issues, this.checkReport),
      };
    }
    return this.cache;
  }
}

function freeze(commands: readonly Command[]): Commands {
  return Object.freeze(
    structuredClone([...commands]).map((c) => deepFreeze(c)),
  );
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object") {
    for (const child of Object.values(value)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}

function indexOf(list: readonly Command[], name: string): number {
  const index = list.findIndex((c) => c.name === name);
  if (index < 0) throw new StoreError(`There is no object named '${name}'.`);
  return index;
}

function applyEdit(list: Command[], edit: Edit): Command[] {
  switch (edit.type) {
    case "add": {
      if (list.some((c) => c.name === edit.command.name)) {
        throw new StoreError(
          `The name '${edit.command.name}' is already used.`,
        );
      }
      const index = edit.index ?? list.length;
      return [...list.slice(0, index), edit.command, ...list.slice(index)];
    }
    case "update": {
      const index = indexOf(list, edit.name);
      if (
        edit.command.name !== edit.name &&
        list.some((c) => c.name === edit.command.name)
      ) {
        throw new StoreError(
          `The name '${edit.command.name}' is already used.`,
        );
      }
      return list.map((c, i) => (i === index ? edit.command : c));
    }
    case "remove": {
      const index = indexOf(list, edit.name);
      return list.filter((_, i) => i !== index);
    }
  }
}
