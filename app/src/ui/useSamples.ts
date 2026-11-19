// The samples of the app (#350): its list `samples/index.json`, loaded once when
// the app starts.
import { useEffect, useState } from "preact/hooks";
import { loadSamples, type Sample } from "../core/samples";

export interface Samples {
  /** The samples, empty while they load and without samples. */
  list: readonly Sample[];
  /** The samples once they are loaded, e.g. for the tools of an agent. */
  loaded: Promise<readonly Sample[]>;
}

/** The samples of the app; `get` fetches the list, the default is the browser's. */
export function useSamples(get?: typeof fetch): Samples {
  const [loaded] = useState(() => loadSamples(document.baseURI, get));
  const [list, setList] = useState<readonly Sample[]>([]);
  useEffect(() => {
    let alive = true;
    void loaded.then((samples) => alive && setList(samples));
    return () => {
      alive = false;
    };
  }, [loaded]);
  return { list, loaded };
}
