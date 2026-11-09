import type { ModelStore } from "../core/store";
import { Browser } from "./Browser";
import { Properties } from "./Properties";

interface Props {
  store: ModelStore;
  selected?: string;
  hidden: ReadonlySet<string>;
  onSelect: (id: string | undefined) => void;
  onToggleVisible: (id: string) => void;
}

export function Sidebar({
  store,
  selected,
  hidden,
  onSelect,
  onToggleVisible,
}: Props) {
  const empty = store.commands.length === 0;
  return (
    <aside class="sidebar">
      <nav class="panel browser" aria-label="Model browser">
        <h2 class="panel-title">Browser</h2>
        {empty ? (
          <p class="muted">No model yet. Open a project file to start.</p>
        ) : (
          <Browser
            nodes={store.tree}
            selected={selected}
            hidden={hidden}
            onSelect={onSelect}
            onToggleVisible={onToggleVisible}
          />
        )}
      </nav>
      <section class="panel properties" aria-label="Properties">
        <h2 class="panel-title">Properties</h2>
        <Properties store={store} selected={selected} onSelect={onSelect} />
      </section>
    </aside>
  );
}
