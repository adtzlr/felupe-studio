import type { ComponentChildren } from "preact";
import { useEffect, useState } from "preact/hooks";
import type { Tab } from "../core/registry";
import {
  type RibbonItem,
  ribbonEntries,
  ribbonGroups,
  unavailable,
} from "../core/ribbon";
import type { ModelStore } from "../core/store";
import { KINDS } from "../core/validate";
import { Icon, type IconName } from "./icons";
import { Menu } from "./Menu";

export type Workspace = "model" | "results";

export const TABS: Record<Workspace, { id: string; label: string }[]> = {
  model: [
    { id: "mesh", label: "Mesh" },
    { id: "materials", label: "Materials" },
    { id: "sections", label: "Sections" },
    { id: "loads", label: "Loads & BCs" },
    { id: "steps", label: "Steps & Job" },
    { id: "script", label: "Script" },
  ],
  results: [{ id: "results", label: "Results" }],
};

const COMMAND_TABS = new Set<string>([
  "mesh",
  "materials",
  "sections",
  "loads",
  "steps",
]);

const WORKSPACES: { id: Workspace; label: string; icon: IconName }[] = [
  { id: "model", label: "Model", icon: "cube" },
  { id: "results", label: "Results", icon: "chart" },
];

interface Props {
  store: ModelStore;
  workspace: Workspace;
  tab: string;
  /**
   * The compact layout of phones and short windows (#378): the workspaces are icons
   * in the row of the tabs, and the commands of a tab open on a tap of the tab and
   * close after a command, so that the view gets their height back.
   */
  compact?: boolean;
  onWorkspace: (workspace: Workspace) => void;
  onTab: (tab: string) => void;
  onCreate: (item: RibbonItem) => void;
  /** The content of the Results tab. */
  results?: ComponentChildren;
  /** The content of the Script tab of the Model workspace (#130). */
  script?: ComponentChildren;
}

function Commands({
  store,
  tab,
  onCreate,
}: {
  store: ModelStore;
  tab: Tab;
  onCreate: Props["onCreate"];
}) {
  const context = { commands: store.commands };
  return (
    <div class="ribbon-commands">
      {ribbonGroups(tab).map((group, index) => (
        <div key={group[0].type} class="ribbon-group">
          {index > 0 && <span class="ribbon-separator" aria-hidden="true" />}
          {ribbonEntries(group).map((entry) => {
            if (entry.kind === "menu") {
              // a menu of the models of a group, e.g. Polynomial (#136)
              const [first] = entry.items;
              return (
                <Menu
                  key={`group-${entry.group}`}
                  kind="ribbon"
                  label={entry.group}
                  title={entry.items.map((i) => i.label).join(", ")}
                  button={
                    <>
                      <Icon name={KINDS[first.type] as IconName} size={22} />
                      <span>
                        {entry.group}
                        <span class="ribbon-caret" aria-hidden="true">
                          {" ▾"}
                        </span>
                      </span>
                    </>
                  }
                  sections={[
                    {
                      items: entry.items.map((item) => {
                        const reason = unavailable(item.type, context);
                        return {
                          id: item.id,
                          label: item.label,
                          ...(reason ? { blocker: reason } : {}),
                          onSelect: () => onCreate(item),
                        };
                      }),
                    },
                  ]}
                />
              );
            }
            const { item } = entry;
            const reason = unavailable(item.type, context);
            const describedBy = reason
              ? `reason-${item.id.replace(/[^A-Za-z0-9]/g, "-")}`
              : undefined;
            return [
              <button
                key={item.id}
                type="button"
                class="ribbon-button"
                aria-disabled={reason ? true : undefined}
                aria-describedby={describedBy}
                title={reason}
                onClick={() => !reason && onCreate(item)}
              >
                <Icon name={KINDS[item.type] as IconName} size={22} />
                <span>{item.label}</span>
              </button>,
              reason && (
                <span key={`${item.id}-reason`} id={describedBy} hidden>
                  {reason}
                </span>
              ),
            ];
          })}
        </div>
      ))}
    </div>
  );
}

export function Ribbon({
  store,
  workspace,
  tab,
  compact = false,
  onWorkspace,
  onTab,
  onCreate,
  results,
  script,
}: Props) {
  const tabs = TABS[workspace];
  const active = tabs.find((t) => t.id === tab) ?? tabs[0];
  // the commands of a compact ribbon, closed until a tab is tapped (#378)
  const [open, setOpen] = useState(false);
  const commands = COMMAND_TABS.has(active.id);

  useEffect(() => {
    if (active.id !== tab) onTab(active.id);
  }, [active.id, tab, onTab]);

  const onKeyDown = (event: KeyboardEvent) => {
    const index = tabs.indexOf(active);
    const step =
      event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0;
    if (!step) return;
    event.preventDefault();
    const next = tabs[(index + step + tabs.length) % tabs.length];
    onTab(next.id);
    document.getElementById(`tab-${next.id}`)?.focus();
  };

  /** A tab chosen: in a compact ribbon, a tap opens its commands or closes them. */
  const choose = (id: string) => {
    setOpen(id !== active.id || !open);
    onTab(id);
  };

  // a compact ribbon shows the commands of a tab only when open, and the note of the
  // Script tab not at all; the controls of the results stay
  const hidden = compact && (commands ? !open : active.id === "script");

  return (
    <div class="ribbon">
      <div class="workspace" role="group" aria-label="Workspace">
        {WORKSPACES.map((w) => (
          <button
            key={w.id}
            type="button"
            aria-pressed={workspace === w.id}
            class={workspace === w.id ? "segment active" : "segment"}
            // the name of an icon of the compact ribbon
            title={compact ? w.label : undefined}
            onClick={() => {
              setOpen(false);
              onWorkspace(w.id);
            }}
          >
            <Icon name={w.icon} />
            <span class="segment-label">{w.label}</span>
          </button>
        ))}
      </div>
      <div class="ribbon-tabs">
        <div role="tablist" aria-label="Ribbon" onKeyDown={onKeyDown}>
          {tabs.map((t) => (
            <button
              key={t.id}
              id={`tab-${t.id}`}
              type="button"
              role="tab"
              aria-selected={t.id === active.id}
              aria-controls="ribbon-panel"
              aria-expanded={
                compact && COMMAND_TABS.has(t.id)
                  ? t.id === active.id && open
                  : undefined
              }
              tabIndex={t.id === active.id ? 0 : -1}
              class={t.id === active.id ? "tab active" : "tab"}
              onClick={() => choose(t.id)}
            >
              {t.label}
            </button>
          ))}
        </div>
        <div
          id="ribbon-panel"
          role="tabpanel"
          aria-labelledby={`tab-${active.id}`}
          class="ribbon-panel"
          hidden={hidden}
        >
          {commands ? (
            <Commands
              store={store}
              tab={active.id as Tab}
              onCreate={(item) => {
                // the view gets the height of the commands back
                setOpen(false);
                onCreate(item);
              }}
            />
          ) : active.id === "script" ? (
            script
          ) : (
            results
          )}
        </div>
      </div>
    </div>
  );
}
