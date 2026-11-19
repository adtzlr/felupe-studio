// The banners below the header (#312): a newer version of the app, and an error
// or a note.
import { APP_NAME } from "../app";
import type { Banner } from "./useProject";

interface UpdateProps {
  /** The model has commands: the project should be saved before the reload. */
  project: boolean;
  onReload: () => void;
  onDismiss: () => void;
}

/** A newer deployment of the app, offered once. */
export function UpdateBanner({ project, onReload, onDismiss }: UpdateProps) {
  return (
    <div class="banner info" role="status" aria-label="Update">
      <div>
        <strong>A new version of {APP_NAME} is available.</strong>{" "}
        {project
          ? "Save your project first; after the reload, open it again with its mesh files."
          : "Reload the page to use it."}
      </div>
      <div class="banner-actions">
        <button type="button" class="button" onClick={onReload}>
          Reload
        </button>
        <button
          type="button"
          class="icon-button"
          aria-label="Dismiss the update"
          onClick={onDismiss}
        >
          ×
        </button>
      </div>
    </div>
  );
}

interface ErrorProps {
  banner: Banner;
  onDismiss: () => void;
}

/** An error, or a note (`info`), with its lines. */
export function ErrorBanner({ banner, onDismiss }: ErrorProps) {
  return (
    <div
      class={banner.info ? "banner info" : "banner"}
      role={banner.info ? "status" : "alert"}
      aria-label={banner.info ? "Note" : undefined}
    >
      <div>
        <strong>{banner.title}</strong>
        <ul>
          {banner.lines.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      </div>
      <button
        type="button"
        class="icon-button"
        aria-label="Dismiss"
        onClick={onDismiss}
      >
        ×
      </button>
    </div>
  );
}
