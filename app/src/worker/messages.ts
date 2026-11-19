// The messages of the Python side of the app (felupe_studio.requests, #311) as the
// worker posts them: the bytes of surfaces, scenes and files as typed arrays and
// ArrayBuffers, and the buffers to transfer to the main thread. The same for the
// Pyodide worker and the local runtime of `felupe-studio serve`.
import type { FromWorker, ResultScene } from "./protocol";
import {
  type RawResultSurface,
  type RawSurface,
  resultTransferables,
  toResultScene,
  toSurfaces,
  transferables,
} from "./surface";

type RawScene = Omit<ResultScene, "surfaces"> & {
  surfaces: RawResultSurface[];
};

const toScene = ({ surfaces, ...meta }: RawScene): ResultScene =>
  toResultScene(meta, surfaces);

/** A message of Python as the worker posts it: typed arrays, not bytes. */
export function toWorkerMessage(raw: Record<string, unknown>): FromWorker {
  switch (raw.type) {
    case "mesh-info":
      return {
        ...raw,
        surfaces: toSurfaces(raw.surfaces as Record<string, RawSurface>),
      } as FromWorker;
    case "result-scene":
      return { ...raw, scene: toScene(raw.scene as RawScene) } as FromWorker;
    case "job-progress": {
      const event = raw.event as { scene?: RawScene };
      return event.scene
        ? ({
            ...raw,
            event: { ...event, scene: toScene(event.scene) },
          } as FromWorker)
        : (raw as unknown as FromWorker);
    }
    case "bytes": {
      const data = raw.data as Uint8Array;
      return {
        ...raw,
        data: data.buffer.slice(
          data.byteOffset,
          data.byteOffset + data.byteLength,
        ),
      } as FromWorker;
    }
    default:
      return raw as unknown as FromWorker;
  }
}

/** The buffers of a message of the worker, to transfer them to the main thread. */
export function transfers(message: FromWorker): Transferable[] {
  switch (message.type) {
    case "mesh-info":
      return transferables(...Object.values(message.surfaces ?? {}));
    case "result-scene":
      return resultTransferables(message.scene);
    case "job-progress":
      return message.event.event === "live" && message.event.scene
        ? resultTransferables(message.event.scene)
        : [];
    case "bytes":
      return [message.data];
    default:
      return [];
  }
}
