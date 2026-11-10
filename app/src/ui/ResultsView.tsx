import type { ComponentChildren } from "preact";
import { useEffect, useRef, useState } from "preact/hooks";
import type { ResultView } from "../core/results";
import { type CreateViewer, Viewer, VIEWS } from "../viewer/viewer";
import type { Quantity, ResultScene } from "../worker/protocol";

/** Loads the result scenes of substeps (the worker client). */
export interface ResultSource {
  resultScene(
    job: string,
    substep: number,
    quantity: Quantity,
  ): Promise<ResultScene>;
}

interface Props {
  source?: ResultSource;
  /** The view of the results of the last finished run (none without results). */
  view?: ResultView;
  /** The results of a run: a new run invalidates the loaded scenes. */
  generation: number;
  /** The view is shown; scenes are loaded only then. */
  active: boolean;
  /** A run is going on. */
  running: boolean;
  createViewer?: CreateViewer;
  /** Panels over the results, e.g. the force-displacement curve. */
  children?: ComponentChildren;
}

type Loaded =
  | { key: string; scene: ResultScene }
  | { key: string; error: string }
  | undefined;

/**
 * The scene of a substep, loaded from the worker: one request at a time, and the
 * latest wanted scene wins (e.g. while dragging the slider of the substeps).
 */
function useResultScene(
  source: ResultSource | undefined,
  wanted: { key: string; job: string; substep: number; quantity: Quantity },
): { loaded: Loaded; loading: boolean } {
  const [loaded, setLoaded] = useState<Loaded>();
  const latest = useRef(wanted);
  latest.current = wanted;
  const busy = useRef(false);
  const alive = useRef(true);
  useEffect(
    () => () => {
      alive.current = false;
    },
    [],
  );

  useEffect(() => {
    if (!source || !wanted.key || busy.current) return;
    const load = async () => {
      busy.current = true;
      const { key, job, substep, quantity } = latest.current;
      try {
        const scene = await source.resultScene(job, substep, quantity);
        if (alive.current) setLoaded({ key, scene });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (alive.current) setLoaded({ key, error: message });
      } finally {
        busy.current = false;
      }
      // a newer scene was wanted while this one was loading
      if (alive.current && latest.current.key && latest.current.key !== key) {
        void load();
      }
    };
    void load();
  }, [source, wanted.key]);

  return {
    loaded,
    loading: !!wanted.key && loaded?.key !== wanted.key,
  };
}

export function ResultsView({
  source,
  view,
  generation,
  active,
  running,
  createViewer,
  children,
}: Props) {
  const host = useRef<HTMLDivElement>(null);
  const viewer = useRef<Viewer | null>(null);
  const [available, setAvailable] = useState(true);
  const wanted =
    view && active && !running
      ? {
          key: `${generation}/${view.job}/${view.substep}/${view.quantity}`,
          job: view.job,
          substep: view.substep,
          quantity: view.quantity,
        }
      : { key: "", job: "", substep: 0, quantity: "displacement" as const };
  const { loaded, loading } = useResultScene(source, wanted);
  // a scene of an older run is not shown
  const scene =
    view &&
    loaded &&
    "scene" in loaded &&
    loaded.key.startsWith(`${generation}/`)
      ? loaded.scene
      : undefined;
  const error =
    view && loaded && "error" in loaded && loaded.key === wanted.key
      ? loaded.error
      : undefined;

  // the viewer (and its WebGL context) is created when there is a scene to show
  useEffect(() => {
    if (!viewer.current) {
      if (!scene || !view || !host.current) return;
      viewer.current = new Viewer(host.current, createViewer);
      setAvailable(viewer.current.available);
    }
    viewer.current.setResult(
      scene && view
        ? { scene, scale: view.scale, undeformed: view.undeformed }
        : undefined,
    );
  }, [scene, view?.scale, view?.undeformed, createViewer]);

  useEffect(
    () => () => {
      viewer.current?.dispose();
      viewer.current = null;
    },
    [],
  );

  const message = running
    ? "Solving …"
    : !view
      ? "Solve the model to see its results."
      : error
        ? `The results could not be shown: ${error}`
        : !scene && loading
          ? "Loading the results …"
          : undefined;
  const shown = !!scene && !message;
  return (
    <main class="viewport" aria-label="Results" hidden={!active}>
      <div class="viewer" ref={host} hidden={!shown} />
      {shown && available && (
        <div class="view-toolbar" role="toolbar" aria-label="View">
          <button
            type="button"
            title="Fit the model into the view"
            onClick={() => viewer.current?.fit()}
          >
            Fit
          </button>
          {VIEWS.map((v) => (
            <button
              key={v.id}
              type="button"
              title={v.title}
              aria-label={v.title}
              onClick={() => viewer.current?.setView(v.id)}
            >
              {v.label}
            </button>
          ))}
        </div>
      )}
      {message && <p class="viewport-message muted">{message}</p>}
      {view && !running && children}
      {shown && loading && (
        <p class="viewport-status muted" role="status">
          Loading …
        </p>
      )}
    </main>
  );
}
