import { Dialog } from "./Dialog";

interface Props {
  fileName: string;
  /** The project to open instead of a new one, e.g. `bar.felupe.zip` (#149). */
  opening?: string;
  onConfirm: () => void;
  onClose: () => void;
}

/**
 * Confirm a new project, or opening a project, when the current model has unsaved
 * changes.
 */
export function NewProjectDialog({
  fileName,
  opening,
  onConfirm,
  onClose,
}: Props) {
  const action = opening ? "Open project" : "New project";
  return (
    <Dialog title={action} onClose={onClose}>
      <p>
        {fileName} has changes that are not saved as a file.{" "}
        {opening ? `Opening ${opening}` : "A new project"} discards them, also
        in this browser.
      </p>
      <div class="actions">
        <button type="button" class="button" onClick={onClose}>
          Cancel
        </button>
        <button type="button" class="button primary" onClick={onConfirm}>
          {opening ? "Open" : "New project"}
        </button>
      </div>
    </Dialog>
  );
}
