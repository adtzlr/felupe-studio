import type { ComponentChildren } from "preact";
import { useEffect } from "preact/hooks";
import type { Tab } from "../core/registry";
import { type RibbonItem, ribbonGroups, unavailable } from "../core/ribbon";
import type { ModelStore } from "../core/store";
import { KINDS } from "../core/validate";
import { Icon, type IconName } from "./icons";

export type Workspace = "model" | "results";

export const TABS: Record<Workspace, { id: string; label: string }[]> = {
  model: [
    { id: "mesh", label: "Mesh" },
    { id: "materials", label: "Materials" },
    { id: "sections", label: "Sections" },
    { id: "loads", label: "Loads & BCs" },
    { id: "steps", label: "Steps & Job" },
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

interface Props {
  store: ModelStore;
  workspace: Workspace;
  tab: string;
  onWorkspace: (workspace: Workspace) => void;
  onTab: (tab: string) => void;
  onCreate: (item: RibbonItem) => void;
  /** The content of the Results tab. */
  results?: ComponentChildren;
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
          {group.map((item) => {
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
  onWorkspace,
  onTab,
  onCreate,
  results,
}: Props) {
  const tabs = TABS[workspace];
  const active = tabs.find((t) => t.id === tab) ?? tabs[0];

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

  return (
    <div class="ribbon">
      <div class="workspace" role="group" aria-label="Workspace">
        {(["model", "results"] as const).map((w) => (
          <button
            key={w}
            type="button"
            aria-pressed={workspace === w}
            class={workspace === w ? "segment active" : "segment"}
            onClick={() => onWorkspace(w)}
          >
            <Icon name={w === "model" ? "cube" : "chart"} />
            {w === "model" ? "Model" : "Results"}
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
              tabIndex={t.id === active.id ? 0 : -1}
              class={t.id === active.id ? "tab active" : "tab"}
              onClick={() => onTab(t.id)}
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
        >
          {COMMAND_TABS.has(active.id) ? (
            <Commands
              store={store}
              tab={active.id as Tab}
              onCreate={onCreate}
            />
          ) : (
            results
          )}
        </div>
      </div>
    </div>
  );
}
