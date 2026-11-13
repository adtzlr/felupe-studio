// The welcome panel of an empty model (#127): how to start, and the samples with
// their pictures.
import { APP_NAME, LINKS } from "../app";
import { type Sample, SAMPLES } from "../core/samples";
import { Icon } from "./icons";
import { SampleCard } from "./SampleCard";
import { useOpening } from "./SamplesDialog";

interface Props {
  onImportMesh: () => void;
  onOpen: () => void;
  onOpenSample: (sample: Sample) => Promise<void>;
}

export function Welcome({ onImportMesh, onOpen, onOpenSample }: Props) {
  const { opening, open } = useOpening(onOpenSample);
  return (
    <section class="welcome" aria-labelledby="welcome-title">
      <h2 id="welcome-title">Welcome to {APP_NAME}</h2>
      <p class="muted">
        Build models of hyperelastic solids from mesh files and solve them with
        FElupe, here in the browser. Nothing is uploaded.
      </p>
      <div class="welcome-actions">
        <button type="button" class="button primary" onClick={onImportMesh}>
          <Icon name="mesh" size={16} />
          Import mesh
        </button>
        <button type="button" class="button" onClick={onOpen}>
          <Icon name="open" size={16} />
          Open project
        </button>
        <span class="muted">or drop mesh files or a project file here</span>
      </div>
      <h3 class="welcome-heading">Start from a sample</h3>
      <ul class="sample-grid" aria-label="Samples">
        {SAMPLES.map((sample) => (
          <SampleCard
            key={sample.id}
            sample={sample}
            opening={opening}
            onOpen={open}
          />
        ))}
      </ul>
      <p class="welcome-links">
        <a href={LINKS.guide} target="_blank" rel="noopener">
          User guide
        </a>
        <a href={LINKS.tutorial} target="_blank" rel="noopener">
          Tutorial: a hyperelastic block with a rigid plate
        </a>
      </p>
    </section>
  );
}
