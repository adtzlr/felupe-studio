// A sample as a card with its picture (#127), in the welcome panel and the dialog.
import { type Sample, thumbnailUrl } from "../core/samples";

interface Props {
  sample: Sample;
  /** The sample that is being opened, if any (disables the others). */
  opening?: string;
  onOpen: (sample: Sample) => void;
  /** Show the description and the topics (the dialog), or the title only. */
  details?: boolean;
}

export function SampleCard({ sample, opening, onOpen, details }: Props) {
  const busy = opening === sample.id;
  return (
    <li class={details ? "sample-card detailed" : "sample-card"}>
      <img
        class="sample-thumbnail"
        src={thumbnailUrl(sample, document.baseURI)}
        alt=""
        width={160}
        height={100}
      />
      <div class="sample-text">
        <h3 id={`sample-${sample.id}`}>{sample.title}</h3>
        {details && <p class="muted">{sample.description}</p>}
        {details && (
          <ul class="topics" aria-label="Topics">
            {sample.topics.map((topic) => (
              <li key={topic}>{topic}</li>
            ))}
          </ul>
        )}
      </div>
      <button
        type="button"
        class="button"
        aria-describedby={`sample-${sample.id}`}
        disabled={opening !== undefined}
        onClick={() => onOpen(sample)}
      >
        {busy ? "Opening …" : "Open"}
      </button>
    </li>
  );
}
