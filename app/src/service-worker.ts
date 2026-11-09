// Register the service worker that caches Pyodide and the wheels (#40).

/** Register public/sw.js; returns whether the page is already controlled by it. */
export async function registerServiceWorker(): Promise<boolean> {
  if (!("serviceWorker" in navigator)) return false;
  try {
    await navigator.serviceWorker.register(new URL("sw.js", document.baseURI));
  } catch (error) {
    console.warn("Service worker not registered:", error);
  }
  return navigator.serviceWorker.controller !== null;
}
