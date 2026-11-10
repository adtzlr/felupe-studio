import { Dialog } from "./Dialog";

interface Props {
  fileName: string;
  onConfirm: () => void;
  onClose: () => void;
}

/** Confirm a new project when the current model has unsaved changes. */
export function NewProjectDialog({ fileName, onConfirm, onClose }: Props) {
  return (
    <Dialog title="New project" onClose={onClose}>
      <p>
        {fileName} has changes that are not saved as a file. A new project
        discards them, also in this browser.
      </p>
      <div class="actions">
        <button type="button" class="button" onClick={onClose}>
          Cancel
        </button>
        <button type="button" class="button primary" onClick={onConfirm}>
          New project
        </button>
      </div>
    </Dialog>
  );
}
