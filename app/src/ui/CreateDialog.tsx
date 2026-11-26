import { initialDraft } from "../core/form";
import { dialogTitle, type RibbonItem } from "../core/ribbon";
import type { Save } from "../core/save";
import type { ModelStore } from "../core/store";
import { CommandForm } from "./CommandForm";
import { Dialog } from "./Dialog";
import { formActions } from "./formActions";

interface Props {
  item: RibbonItem;
  store: ModelStore;
  onClose: () => void;
  /** Called with the name of the created object. */
  onCreated: (name: string) => void;
  /** Saves a file of an action of the form, e.g. the template of a material (#453). */
  save: Save;
}

export function CreateDialog({ item, store, onClose, onCreated, save }: Props) {
  const context = { commands: store.commands };
  const draft = initialDraft(item.type, context, item.preset);
  const subtitle =
    item.label === dialogTitle(item)
      ? item.type
      : `${item.label} · ${item.type}`;
  return (
    <Dialog title={dialogTitle(item)} subtitle={subtitle} onClose={onClose}>
      <CommandForm
        type={item.type}
        initial={draft}
        context={context}
        submitLabel="Create"
        idPrefix="new-"
        actions={formActions(item.type, save)}
        onCancel={onClose}
        onSubmit={(command) => {
          store.apply({ type: "add", command });
          onCreated(command.name);
        }}
      />
    </Dialog>
  );
}
