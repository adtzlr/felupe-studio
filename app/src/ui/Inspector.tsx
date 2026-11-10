import type { MeshFiles } from "../core/meshfiles";
import type { ModelStore } from "../core/store";
import { Properties } from "./Properties";

interface Props {
  store: ModelStore;
  files: MeshFiles;
  /** Messages about the mesh files, by object name. */
  notes: Map<string, string[]>;
  selected?: string;
  onSelect: (id: string | undefined) => void;
  onClose: () => void;
}

/**
 * The properties of the selected object in a panel on the right of the viewport
 * (#83). It opens when an object is selected and can be closed.
 */
export function Inspector({
  store,
  files,
  notes,
  selected,
  onSelect,
  onClose,
}: Props) {
  return (
    <section class="panel properties inspector" aria-label="Properties">
      <div class="inspector-head">
        <h2 class="panel-title">Properties</h2>
        <button
          type="button"
          class="icon-button"
          aria-label="Close the properties"
          title="Close the properties (a click on an object opens them again)"
          onClick={onClose}
        >
          ×
        </button>
      </div>
      <Properties
        store={store}
        files={files}
        notes={notes}
        selected={selected}
        onSelect={onSelect}
      />
    </section>
  );
}
