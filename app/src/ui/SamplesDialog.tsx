// The sample models (#32): a list of samples, each opened like a project file with
// its mesh files.
import { useState } from "preact/hooks";
import { type Sample, SAMPLES } from "../core/samples";
import { Dialog } from "./Dialog";

interface Props {
  /** The current model has unsaved changes, which a sample replaces. */
  modified: boolean;
  onOpen: (sample: Sample) => Promise<void>;
  onClose: () => void;
}

export function SamplesDialog({ modified, onOpen, onClose }: Props) {
  const [opening, setOpening] = useState<string>();
  return (
    <Dialog
      title="Samples"
      subtitle="Finished models with their mesh files"
      onClose={onClose}
    >
      {modified && (
        <p class="warning" role="note">
          A sample replaces the current model, which has unsaved changes.
        </p>
      )}
      <ul class="samples" aria-label="Samples">
        {SAMPLES.map((sample) => (
          <li key={sample.id}>
            <div>
              <h3 id={`sample-${sample.id}`}>{sample.title}</h3>
              <p class="muted">{sample.description}</p>
              <ul class="topics" aria-label="Topics">
                {sample.topics.map((topic) => (
                  <li key={topic}>{topic}</li>
                ))}
              </ul>
            </div>
            <button
              type="button"
              class="button"
              aria-describedby={`sample-${sample.id}`}
              disabled={opening !== undefined}
              onClick={async () => {
                setOpening(sample.id);
                try {
                  await onOpen(sample);
                } finally {
                  setOpening(undefined);
                }
              }}
            >
              {opening === sample.id ? "Opening …" : "Open"}
            </button>
          </li>
        ))}
      </ul>
    </Dialog>
  );
}
