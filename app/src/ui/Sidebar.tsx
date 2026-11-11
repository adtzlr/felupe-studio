import type { ModelStore } from "../core/store";
import type { TreeNode } from "../core/tree";
import { Browser } from "./Browser";

interface Props {
  store: ModelStore;
  /** Messages about the mesh files, by object name. */
  notes: Map<string, string[]>;
  selected?: string;
  hidden: ReadonlySet<string>;
  onSelect: (id: string | undefined) => void;
  onToggleVisible: (id: string) => void;
  /** Open the sample models (offered for an empty model). */
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
          <p class="muted empty-model">
            No model yet. Import a mesh, open a project or a sample; the objects
            of the model are listed here.
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
    </aside>
  );
}
