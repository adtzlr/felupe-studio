// Commands of the ribbon, derived from the registry and the schema: one button per
// command of a tab, or one per variant if the variant selects the schema definition
// (e.g. one button per material model).
import {
  type Context,
  type Draft,
  fieldSpecs,
  initialDraft,
  available,
} from "./form";
import { KIND_LABELS, REGISTRY, type Tab } from "./registry";
import { type CommandType, type Kind, KINDS, kindsOf } from "./validate";

export interface RibbonItem {
  /** Unique id, e.g. `material.add:NeoHooke`. */
  id: string;
  type: CommandType;
  label: string;
  /** Values set before the defaults, e.g. `{ model: "NeoHooke" }`. */
  preset: Draft;
  /** A menu of the ribbon with the items of the same group (`x-group`, #136). */
  group?: string;
}

/** Items of a ribbon group: a button, or a menu of the items of one group. */
export type RibbonEntry =
  | { kind: "button"; item: RibbonItem }
  | { kind: "menu"; group: string; items: RibbonItem[] };

/**
 * The entries of the items of a command: consecutive items of the same group form a
 * menu (e.g. *Polynomial* with Mooney-Rivlin, Yeoh and third-order deformation), so
 * the ribbon stays one row. A group of one item is a button.
 */
export function ribbonEntries(items: readonly RibbonItem[]): RibbonEntry[] {
  const entries: RibbonEntry[] = [];
  for (const item of items) {
    const last = entries.at(-1);
    if (item.group && last?.kind === "menu" && last.group === item.group) {
      last.items.push(item);
    } else if (item.group) {
      entries.push({ kind: "menu", group: item.group, items: [item] });
    } else {
      entries.push({ kind: "button", item });
    }
  }
  return entries.map((e) =>
    e.kind === "menu" && e.items.length === 1
      ? { kind: "button", item: e.items[0] }
      : e,
  );
}

const TYPES = Object.keys(REGISTRY) as CommandType[];

/** Buttons of a ribbon tab, grouped by command. */
export function ribbonGroups(tab: Tab): RibbonItem[][] {
  return TYPES.filter((type) => REGISTRY[type].tab === tab).map((type) => {
    const draft = initialDraft(type, { commands: [] });
    const variant = fieldSpecs(type, draft).find(
      (spec) =>
        spec.path.length === 1 &&
        spec.input.type === "variant" &&
        Object.values(spec.input.seeds).every(
          (seed) => typeof seed === "string",
        ),
    );
    if (!variant || variant.input.type !== "variant") {
      return [{ id: type, type, label: REGISTRY[type].label, preset: {} }];
    }
    return variant.input.options.map((option) => ({
      id: `${type}:${option.value}`,
      type,
      label: option.label,
      preset: { [variant.key]: option.value },
      ...(option.group ? { group: option.group } : {}),
    }));
  });
}

const article = (word: string) => (/^[aeiou]/i.test(word) ? "an" : "a");

function list(words: string[]): string {
  return words.length < 2
    ? words.join("")
    : `${words.slice(0, -1).join(", ")} and ${words.at(-1)}`;
}

/** Why a command cannot be created yet, or undefined if it can. */
export function unavailable(
  type: CommandType,
  context: Context,
): string | undefined {
  if (
    REGISTRY[type].single &&
    context.commands.some((c) => c.command === type)
  ) {
    const label = KIND_LABELS[KINDS[type]].toLowerCase();
    return `The model has ${article(label)} ${label} setting already; edit it in the browser.`;
  }
  const missing = new Set<Kind>();
  for (const spec of fieldSpecs(type, initialDraft(type, context))) {
    const { input } = spec;
    if (input.type !== "reference" || !spec.required) continue;
    if (available(context, input.kind).length === 0)
      missing.add(kindsOf(input.kind)[0]);
  }
  if (missing.size === 0) return undefined;
  const kinds = [...missing].map((kind) => {
    const label = KIND_LABELS[kind].toLowerCase();
    return `${article(label)} ${label}`;
  });
  return `Create ${list(kinds)} first.`;
}

/** Title of the dialog that creates an object of a ribbon item. */
export function dialogTitle(item: RibbonItem): string {
  const noun =
    REGISTRY[item.type].noun ?? KIND_LABELS[KINDS[item.type]].toLowerCase();
  return `New ${noun}`;
}
