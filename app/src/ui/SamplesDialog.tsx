// The sample models (#32): a list of samples, each opened like a project file with
// its mesh files.
import { useState } from "preact/hooks";
import { type Sample, SAMPLES } from "../core/samples";
import { Dialog } from "./Dialog";
import { SampleCard } from "./SampleCard";

interface Props {
  /** The current model has unsaved changes, which a sample replaces. */
  modified: boolean;
  onOpen: (sample: Sample) => Promise<void>;
  onClose: () => void;
}

/** Open a sample once at a time, with the state of the one being opened. */
export function useOpening(onOpen: (sample: Sample) => Promise<void>) {
  const [opening, setOpening] = useState<string>();
  const open = async (sample: Sample) => {
    setOpening(sample.id);
    try {
      await onOpen(sample);
    } finally {
      setOpening(undefined);
    }
  };
  return { opening, open };
}

export function SamplesDialog({ modified, onOpen, onClose }: Props) {
  const { opening, open } = useOpening(onOpen);
  return (
    <Dialog
      title="Samples"
      subtitle="Finished models with their mesh files"
      onClose={onClose}
      wide
    >
      {modified && (
        <p class="warning" role="note">
          A sample replaces the current model, which has unsaved changes.
        </p>
      )}
      <ul class="samples" aria-label="Samples">
        {SAMPLES.map((sample) => (
          <SampleCard
            key={sample.id}
            sample={sample}
            opening={opening}
            onOpen={open}
            details
          />
        ))}
      </ul>
    </Dialog>
  );
}
