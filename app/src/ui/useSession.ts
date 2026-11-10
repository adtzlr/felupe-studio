// Keep the session of the app in the browser and restore it after a reload (#57).
import { useEffect, useRef, useState } from "preact/hooks";
import type { MeshFiles } from "../core/meshfiles";
import { keep, type Session, type SessionStorage } from "../core/session";
import type { ModelStore } from "../core/store";

export type Kept =
  | { state: "off" }
  | { state: "restoring" }
  /** `files`: the mesh files are kept too (they may not fit). */
  | { state: "kept"; files: boolean }
  | { state: "failed"; message: string };

interface Options {
  store: ModelStore;
  files: MeshFiles;
  fileName: string;
  modified: boolean;
  /** Apply a restored session to the app (the model is empty then). */
  onRestore: (session: Session) => Promise<void>;
  /** The delay of a write after the last change, in milliseconds. */
  delay?: number;
}

const message = (error: unknown) =>
  error instanceof Error ? error.message : String(error);

/**
 * Restore the last session once (if the model is still empty), then keep the
 * project and the mesh files that it imports after every change.
 */
export function useSession(
  storage: SessionStorage | undefined,
  { store, files, fileName, modified, onRestore, delay = 400 }: Options,
): Kept {
  const [kept, setKept] = useState<Kept>(
    storage ? { state: "restoring" } : { state: "off" },
  );
  const [ready, setReady] = useState(false);
  const restore = useRef(onRestore);
  restore.current = onRestore;

  useEffect(() => {
    if (!storage) return;
    let active = true;
    void (async () => {
      try {
        const session = await storage.load();
        if (active && session && store.commands.length === 0) {
          await restore.current(session);
        }
      } catch (error) {
        if (active) {
          setKept({
            state: "failed",
            message: `The last session could not be restored: ${message(error)}`,
          });
        }
      }
      if (active) setReady(true);
    })();
    return () => {
      active = false;
    };
  }, [storage]);

  const commands = store.commands;
  const revision = files.revision;
  useEffect(() => {
    if (!storage || !ready) return;
    const timer = setTimeout(() => {
      void (async () => {
        try {
          // an empty model with the default name is no session
          if (commands.length === 0 && !files.names.length) {
            await storage.clear();
            setKept({ state: "kept", files: true });
            return;
          }
          const { serialize } = await import("../core/project");
          const names = new Set(
            commands.flatMap((c) =>
              c.command === "mesh.import" ? [c.file] : [],
            ),
          );
          const result = await keep(storage, {
            project: serialize(store.document),
            fileName,
            modified,
            files: [...names].flatMap((name) => {
              const data = files.dataOf(name);
              return data ? [{ name, data }] : [];
            }),
          });
          setKept({ state: "kept", files: result === "all" });
        } catch (error) {
          setKept({ state: "failed", message: message(error) });
        }
      })();
    }, delay);
    return () => clearTimeout(timer);
  }, [storage, ready, commands, revision, fileName, modified, delay]);

  return kept;
}
