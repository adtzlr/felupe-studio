// The scenes of the results (#312): a scene of a substep loaded from the worker,
// one request at a time and kept (#141), and the range of a quantity over all
// substeps of a job (#139).
import { useEffect, useRef, useState } from "preact/hooks";
import { SceneCache } from "../core/scenecache";
import type { Quantity, ResultScene, ValuesMethod } from "../worker/protocol";

/** Loads the result scenes of substeps (the worker client). */
export interface ResultSource {
  resultScene(
    job: string,
    substep: number,
    quantity: Quantity,
    method?: ValuesMethod,
  ): Promise<ResultScene>;
  /** The ranges of a quantity of every substep of a job (#139). */
  resultRanges?(
    job: string,
    quantity: Quantity,
    method?: ValuesMethod,
  ): Promise<([number, number] | null)[]>;
}

/** The range over all substeps of a job (#139), from the ranges of its substeps. */
export function useJobRange(
  source: ResultSource | undefined,
  key: string | undefined,
  job: string,
  quantity: Quantity,
  method: ValuesMethod,
): readonly [number, number] | undefined {
  const [ranges, setRanges] = useState<{
    key: string;
    range?: [number, number];
  }>();
  useEffect(() => {
    if (!key || !source?.resultRanges || ranges?.key === key) return;
    let alive = true;
    source.resultRanges(job, quantity, method).then(
      (list) => {
        const finite = list.filter((r): r is [number, number] => r !== null);
        const range: [number, number] | undefined = finite.length
          ? [
              Math.min(...finite.map((r) => r[0])),
              Math.max(...finite.map((r) => r[1])),
            ]
          : undefined;
        if (alive) setRanges({ key, range });
      },
      () => alive && setRanges({ key }),
    );
    return () => {
      alive = false;
    };
  }, [source, key]);
  return key && ranges?.key === key ? ranges.range : undefined;
}

export type Loaded =
  | { key: string; scene: ResultScene }
  | { key: string; error: string }
  | undefined;

/** A wanted scene: of a substep of a job and a quantity, keyed with the run. */
export interface Wanted {
  key: string;
  job: string;
  substep: number;
  quantity: Quantity;
  method: ValuesMethod;
}

/**
 * The scene of a substep, loaded from the worker: one request at a time, and the
 * latest wanted scene wins (e.g. while dragging the slider of the substeps). Loaded
 * scenes are kept (#141), and the scenes ahead (while playing) are loaded after the
 * wanted one.
 */
export function useResultScene(
  source: ResultSource | undefined,
  wanted: Wanted,
  ahead: readonly Wanted[],
): { loaded: Loaded; loading: boolean } {
  const [loaded, setLoaded] = useState<Loaded>();
  const latest = useRef({ wanted, ahead });
  latest.current = { wanted, ahead };
  const cache = useRef(new SceneCache());
  // the run of the kept scenes, and scenes that failed (not loaded ahead again)
  const run = useRef("");
  const failed = useRef(new Set<string>());
  const busy = useRef(false);
  const alive = useRef(true);
  useEffect(
    () => () => {
      alive.current = false;
    },
    [],
  );

  // show the wanted scene if it is kept
  const show = () => {
    const { key } = latest.current.wanted;
    const scene = key ? cache.current.get(key) : undefined;
    if (scene) setLoaded((l) => (l?.key === key ? l : { key, scene }));
  };

  const pump = async () => {
    if (!source || busy.current || !alive.current) return;
    const { wanted, ahead } = latest.current;
    const next = [wanted, ...ahead].find(
      (w) => w.key && !cache.current.has(w.key) && !failed.current.has(w.key),
    );
    if (!next) return;
    busy.current = true;
    try {
      const scene = await source.resultScene(
        next.job,
        next.substep,
        next.quantity,
        next.method,
      );
      if (next.key.startsWith(`${run.current}/`)) {
        cache.current.set(next.key, scene);
      }
    } catch (error) {
      failed.current.add(next.key);
      const message = error instanceof Error ? error.message : String(error);
      if (alive.current && next.key === latest.current.wanted.key) {
        setLoaded({ key: next.key, error: message });
      }
    } finally {
      busy.current = false;
    }
    if (!alive.current) return;
    show();
    void pump();
  };

  // a scene that failed is loaded again when it is wanted again
  useEffect(() => {
    failed.current.delete(wanted.key);
  }, [wanted.key]);

  useEffect(() => {
    // the scenes of an older run are dropped
    const current = wanted.key.slice(0, wanted.key.indexOf("/"));
    if (wanted.key && current !== run.current) {
      run.current = current;
      cache.current.clear();
      failed.current.clear();
    }
    show();
    void pump();
  }, [source, wanted.key, ahead.map((w) => w.key).join()]);

  return {
    loaded,
    loading: !!wanted.key && loaded?.key !== wanted.key,
  };
}
