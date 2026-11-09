import { useEffect } from "preact/hooks";
import { Icon } from "./icons";

export type Workspace = "model" | "results";

export const TABS: Record<Workspace, { id: string; label: string }[]> = {
  model: [
    { id: "mesh", label: "Mesh" },
    { id: "materials", label: "Materials" },
    { id: "sections", label: "Sections" },
    { id: "loads", label: "Loads & BCs" },
    { id: "steps", label: "Steps & Job" },
    { id: "tools", label: "Tools" },
  ],
  results: [{ id: "results", label: "Results" }],
};

interface Props {
  workspace: Workspace;
  tab: string;
  onWorkspace: (workspace: Workspace) => void;
  onTab: (tab: string) => void;
}

export function Ribbon({ workspace, tab, onWorkspace, onTab }: Props) {
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
          {active.id === "tools" ? (
            <a href="./spike.html">Pyodide benchmark</a>
          ) : (
            <span class="muted">
              The commands of “{active.label}” will appear here.
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
