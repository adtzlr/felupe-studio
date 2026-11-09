import type { MeshFiles } from "../core/meshfiles";
import type { ModelStore } from "../core/store";
import type { TreeNode } from "../core/tree";
import { Browser } from "./Browser";
import { Properties } from "./Properties";

interface Props {
  store: ModelStore;
  files: MeshFiles;
  /** Messages about the mesh files, by object name. */
  notes: Map<string, string[]>;
  selected?: string;
  hidden: ReadonlySet<string>;
  onSelect: (id: string | undefined) => void;
  onToggleVisible: (id: string) => void;
}

/** The tree with the notes added to the issues of their objects. */
function withNotes(
  nodes: TreeNode[],
  notes: Map<string, string[]>,
): TreeNode[] {
  if (notes.size === 0) return nodes;
  return nodes.map((node) => ({
    ...node,
    issues:
      node.kind === "group"
        ? node.issues
        : [...node.issues, ...(notes.get(node.id) ?? [])],
    children: withNotes(node.children, notes),
  }));
}

export function Sidebar({
  store,
  files,
  notes,
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
          <p class="muted">
            No model yet. Import a mesh with the ribbon, drop a mesh file here,
            or open a project file.
          </p>
        ) : (
          <Browser
            nodes={withNotes(store.tree, notes)}
            selected={selected}
            hidden={hidden}
            onSelect={onSelect}
            onToggleVisible={onToggleVisible}
          />
        )}
      </nav>
      <section class="panel properties" aria-label="Properties">
        <h2 class="panel-title">Properties</h2>
        <Properties
          store={store}
          files={files}
          notes={notes}
          selected={selected}
          onSelect={onSelect}
        />
      </section>
    </aside>
  );
}
