import type { ModelStore } from "../core/store";

export function Sidebar({ store }: { store: ModelStore }) {
  const groups = store.tree;
  const empty = store.commands.length === 0;
  return (
    <aside class="sidebar">
      <nav class="panel browser" aria-label="Model browser">
        <h2 class="panel-title">Browser</h2>
        {empty ? (
          <p class="muted">No model yet. Open a project file to start.</p>
        ) : (
          <ul class="groups">
            {groups.map((g) => (
              <li key={g.id}>
                <span>{g.label}</span>
                <span class="muted">{g.count}</span>
              </li>
            ))}
          </ul>
        )}
      </nav>
      <section class="panel properties" aria-label="Properties">
        <h2 class="panel-title">Properties</h2>
        <p class="muted">Select an object in the browser.</p>
      </section>
    </aside>
  );
}
