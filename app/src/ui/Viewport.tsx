import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import type { MeshFiles } from "../core/meshfiles";
import type { ModelStore } from "../core/store";
import { viewportContent } from "../viewer/layers";
import { type CreateViewer, Viewer, VIEWS } from "../viewer/viewer";

interface Props {
  store: ModelStore;
  files: MeshFiles;
  /** Names of the objects hidden in the viewport. */
  hidden: ReadonlySet<string>;
  /** Creates the viewer; the default is the vendored FElupe viewer. */
  createViewer?: CreateViewer;
}

export function Viewport({ store, files, hidden, createViewer }: Props) {
  const host = useRef<HTMLDivElement>(null);
  const viewer = useRef<Viewer | null>(null);
  const [available, setAvailable] = useState(true);
  const commands = store.commands;
  const revision = files.revision;
  const content = useMemo(
    () => viewportContent(commands, files, hidden),
    // the files change in place, their revision tells when
    [commands, files, revision, hidden],
  );

  // the viewer (and its WebGL context) is created when there is a mesh to show
  useEffect(() => {
    if (!viewer.current) {
      if (content.meshes.length === 0 || !host.current) return;
      viewer.current = new Viewer(host.current, createViewer);
      setAvailable(viewer.current.available);
    }
    viewer.current.setMeshes(content.meshes);
  }, [content, createViewer]);

  useEffect(
    () => () => {
      viewer.current?.dispose();
      viewer.current = null;
    },
    [],
  );

  const shown = content.meshes.length > 0;
  return (
    <main class="viewport" aria-label="Viewport">
      <div class="viewer" ref={host} />
      {shown && available && (
        <div class="view-toolbar" role="toolbar" aria-label="View">
          <button
            type="button"
            title="Fit the model into the view"
            onClick={() => viewer.current?.fit()}
          >
            Fit
          </button>
          {VIEWS.map((view) => (
            <button
              key={view.id}
              type="button"
              title={view.title}
              aria-label={view.title}
              onClick={() => viewer.current?.setView(view.id)}
            >
              {view.label}
            </button>
          ))}
        </div>
      )}
      {content.message && (
        <p class="viewport-message muted">{content.message}</p>
      )}
      {shown && content.reading.length > 0 && (
        <p class="viewport-status muted" role="status">
          Reading {content.reading.join(", ")} …
        </p>
      )}
    </main>
  );
}
