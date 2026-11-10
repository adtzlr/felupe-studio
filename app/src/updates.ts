// Newer deployments: the build of the app is written to version.json (see
// vite.config.ts). An open app asks for it now and then, without the HTTP cache, and
// reports a newer build once, so that the page can offer a reload.

/** The build of the deployed app, or undefined if it is not known (e.g. offline). */
export async function deployedBuild(
  base: string = document.baseURI,
  fetcher: typeof fetch = fetch,
): Promise<string | undefined> {
  try {
    const response = await fetcher(new URL("version.json", base), {
      cache: "no-store",
    });
    if (!response.ok) return undefined;
    const { build } = (await response.json()) as { build?: unknown };
    return typeof build === "string" ? build : undefined;
  } catch {
    return undefined;
  }
}

export interface WatchOptions {
  /** Milliseconds between two checks while the page is visible. */
  interval?: number;
  base?: string;
  fetcher?: typeof fetch;
}

/**
 * Check for a newer build every `interval` and when the page becomes visible again.
 * Calls `onUpdate` once with the newer build. Returns a function that stops.
 */
export function watchForUpdates(
  current: string,
  onUpdate: (build: string) => void,
  { interval = 10 * 60 * 1000, base, fetcher }: WatchOptions = {},
): () => void {
  let stopped = false;
  const check = async () => {
    if (stopped || document.visibilityState === "hidden") return;
    const build = await deployedBuild(base, fetcher);
    if (stopped || !build || build === current) return;
    stop();
    onUpdate(build);
  };
  const onVisible = () => void check();
  const timer = setInterval(() => void check(), interval);
  document.addEventListener("visibilitychange", onVisible);
  const stop = () => {
    stopped = true;
    clearInterval(timer);
    document.removeEventListener("visibilitychange", onVisible);
  };
  return stop;
}

/** Watches for updates and calls back with a newer build (injected in tests). */
export type UpdateWatcher = (onUpdate: (build: string) => void) => () => void;
