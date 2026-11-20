// Register the service worker that caches Pyodide and the wheels (#40).
import { storagePrefix, UPSTREAM_STORAGE } from "./brand";

/**
 * The URL of public/sw.js: with the storage prefix of a brand (ADR 0020), whose cache
 * has its own name; FElupe Studio registers it without one, as before.
 */
export function workerUrl(base: string, prefix = storagePrefix()): string {
  const url = new URL("sw.js", base);
  if (prefix !== UPSTREAM_STORAGE) url.searchParams.set("storage", prefix);
  return url.href;
}

/** Register public/sw.js; returns whether the page is already controlled by it. */
export async function registerServiceWorker(): Promise<boolean> {
  if (!("serviceWorker" in navigator)) return false;
  try {
    await navigator.serviceWorker.register(workerUrl(document.baseURI));
  } catch (error) {
    console.warn("Service worker not registered:", error);
  }
  return navigator.serviceWorker.controller !== null;
}
