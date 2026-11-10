// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import { deployedBuild, watchForUpdates } from "./updates";

const BASE = "https://example.org/felupe-studio/index.html";

const reply = (body: unknown, status = 200) =>
  vi.fn(
    async () =>
      new Response(JSON.stringify(body), {
        status,
        headers: { "Content-Type": "application/json" },
      }),
  ) as unknown as typeof fetch;

afterEach(() => {
  vi.useRealTimers();
});

describe("deployed build", () => {
  it("is read from version.json without the HTTP cache", async () => {
    const fetcher = reply({ build: "abc123" });
    expect(await deployedBuild(BASE, fetcher)).toBe("abc123");
    expect(fetcher).toHaveBeenCalledWith(
      new URL("https://example.org/felupe-studio/version.json"),
      { cache: "no-store" },
    );
  });

  it("is unknown without a usable answer", async () => {
    expect(await deployedBuild(BASE, reply({}, 404))).toBeUndefined();
    expect(await deployedBuild(BASE, reply({ build: 1 }))).toBeUndefined();
    const offline = vi.fn(async () => {
      throw new TypeError("Failed to fetch");
    }) as unknown as typeof fetch;
    expect(await deployedBuild(BASE, offline)).toBeUndefined();
  });
});

describe("watching for updates", () => {
  it("reports a newer build once, then stops", async () => {
    vi.useFakeTimers();
    let build = "old";
    const fetcher = vi.fn(async () =>
      Response.json({ build }),
    ) as unknown as typeof fetch;
    const onUpdate = vi.fn();
    watchForUpdates("old", onUpdate, { interval: 1000, base: BASE, fetcher });

    await vi.advanceTimersByTimeAsync(1000);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(onUpdate).not.toHaveBeenCalled();

    build = "new";
    await vi.advanceTimersByTimeAsync(1000);
    expect(onUpdate).toHaveBeenCalledWith("new");
    await vi.advanceTimersByTimeAsync(5000);
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(onUpdate).toHaveBeenCalledTimes(1);
  });

  it("checks when the page becomes visible again, and can be stopped", async () => {
    const fetcher = reply({ build: "new" });
    const onUpdate = vi.fn();
    const stop = watchForUpdates("old", onUpdate, {
      interval: 60_000,
      base: BASE,
      fetcher,
    });
    document.dispatchEvent(new Event("visibilitychange"));
    await vi.waitFor(() => expect(onUpdate).toHaveBeenCalledWith("new"));

    const quiet = vi.fn();
    watchForUpdates("old", quiet, { interval: 60_000, base: BASE, fetcher })();
    document.dispatchEvent(new Event("visibilitychange"));
    await Promise.resolve();
    expect(quiet).not.toHaveBeenCalled();
    stop();
  });
});
