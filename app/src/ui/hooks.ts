import { useEffect, useState } from "preact/hooks";
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
    let active = true;
    const started = performance.now();
    client.ready.then(
      (ready) =>
        active &&
        setRuntime({
          state: "ready",
          ready,
          seconds: (performance.now() - started) / 1000,
        }),
      (error: Error) =>
        active && setRuntime({ state: "error", message: error.message }),
    );
    return () => {
      active = false;
    };
  }, [client]);
  return runtime;
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
