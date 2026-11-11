import { useEffect, useRef, useState } from "preact/hooks";
import {
  dialogOpen,
  isTyping,
  matches,
  type ShortcutId,
} from "../core/shortcuts";
import { VIEWS, type Viewer } from "../viewer/viewer";
import type { JobRun, JobRunner } from "../core/jobs";
import type { MeshFiles } from "../core/meshfiles";
import type { ModelStore } from "../core/store";
import type { PyodideClient, Ready } from "../worker/client";

/** Re-render the component after every change of the store. */
export function useStore(store: ModelStore): ModelStore {
  const [, setVersion] = useState(0);
  useEffect(() => store.subscribe(() => setVersion((n) => n + 1)), [store]);
  return store;
}

/** Re-render the component after every change of the mesh files. */
export function useMeshFiles(files: MeshFiles): MeshFiles {
  const [, setVersion] = useState(0);
  useEffect(() => files.subscribe(() => setVersion((n) => n + 1)), [files]);
  return files;
}

export type Runtime =
  | { state: "loading" }
  | { state: "ready"; ready: Ready; seconds: number }
  | { state: "error"; message: string };

/** State of the Python runtime (Pyodide and FElupe) of the client. */
export function useRuntime(client: PyodideClient | undefined): Runtime {
  const [runtime, setRuntime] = useState<Runtime>({ state: "loading" });
  useEffect(() => {
    if (!client) return;
    let generation = 0;
    const follow = () => {
      const current = ++generation;
      const active = () => current === generation;
      const started = performance.now();
      setRuntime({ state: "loading" });
      client.ready.then(
        (ready) =>
          active() &&
          setRuntime({
            state: "ready",
            ready,
            seconds: (performance.now() - started) / 1000,
          }),
        (error: Error) =>
          active() && setRuntime({ state: "error", message: error.message }),
      );
    };
    follow();
    // a restart (e.g. a cancelled job) loads Python again
    const unsubscribe = client.onRestart(follow);
    return () => {
      generation = -1;
      unsubscribe();
    };
  }, [client]);
  return runtime;
}

/** Re-render the component after every change of the run of the jobs. */
export function useJobs(jobs: JobRunner | undefined): JobRun {
  const [, setVersion] = useState(0);
  useEffect(() => jobs?.subscribe(() => setVersion((n) => n + 1)), [jobs]);
  return jobs?.run ?? { state: "idle" };
}

export function runtimeText(runtime: Runtime): string {
  switch (runtime.state) {
    case "loading":
      return "Loading Python and FElupe …";
    case "ready":
      return `FElupe ${runtime.ready.versions.felupe} ready (${runtime.seconds.toFixed(1)} s)`;
    case "error":
      return `Python could not be loaded: ${runtime.message}`;
  }
}

/**
 * The keys of a view (#129): F fits the model, 1 to 4 set the views, N shows or hides
 * the nodes; only in the shown view, not while typing, in a menu or in a dialog.
 */
export function useViewKeys(
  active: boolean,
  viewer: { current: Viewer | null },
  toggleNodes: () => void,
): void {
  const toggle = useRef(toggleNodes);
  toggle.current = toggleNodes;
  useEffect(() => {
    if (!active) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || dialogOpen() || isTyping(event.target))
        return;
      if (
        event.target instanceof Element &&
        event.target.closest('[role="menu"]')
      )
        return;
      const view = VIEWS.find((v) => matches(event, v.shortcut as ShortcutId));
      if (matches(event, "fit")) viewer.current?.fit();
      else if (view) viewer.current?.setView(view.id);
      else if (matches(event, "nodes")) toggle.current();
      else return;
      event.preventDefault();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [active, viewer]);
}

/** Whether a media query matches, e.g. the narrow windows of the drawers (#131). */
export function useMedia(query: string): boolean {
  const media = () =>
    typeof window.matchMedia === "function"
      ? window.matchMedia(query)
      : undefined;
  const [matches, setMatches] = useState(() => media()?.matches ?? false);
  useEffect(() => {
    const list = media();
    if (!list) return;
    const update = () => setMatches(list.matches);
    update();
    list.addEventListener?.("change", update);
    return () => list.removeEventListener?.("change", update);
  }, [query]);
  return matches;
}
