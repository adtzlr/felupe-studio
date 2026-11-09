// Service worker of FElupe Studio (#40): caches Pyodide (versioned CDN URLs) and the
// wheels served by the app, cache first. Other requests are not touched.
const CACHE = "felupe-studio-runtime-v1";
const PYODIDE = /^https:\/\/cdn\.jsdelivr\.net\/pyodide\/(v[^/]+)\/full\//;
const WHEEL = /\/wheels\/([A-Za-z0-9_.]+)-([^-/]+)-[^/]*\.whl$/;

/** Name and version of a cached runtime file, or undefined if it is not cached. */
function runtimeFile(url, scope) {
  const pyodide = PYODIDE.exec(url);
  if (pyodide) return { family: "pyodide", version: pyodide[1] };
  const wheel = url.startsWith(scope) && WHEEL.exec(url);
  if (wheel) return { family: `wheel:${wheel[1]}`, version: wheel[2] };
  return undefined;
}

async function cacheFirst(request, file) {
  const cache = await caches.open(CACHE);
  const hit = await cache.match(request);
  if (hit) return hit;
  const response = await fetch(request);
  if (response.ok) {
    await cache.put(request, response.clone());
    // remove other versions of the same file family, e.g. an older Pyodide
    for (const key of await cache.keys()) {
      const other = runtimeFile(key.url, self.registration.scope);
      if (
        other &&
        other.family === file.family &&
        other.version !== file.version
      ) {
        await cache.delete(key);
      }
    }
  }
  return response;
}

self.runtimeFile = runtimeFile;
self.cacheFirst = cacheFirst;

self.addEventListener("install", () => self.skipWaiting());

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      for (const key of await caches.keys()) {
        if (key !== CACHE && key.startsWith("felupe-studio-runtime-"))
          await caches.delete(key);
      }
      await self.clients.claim();
    })(),
  );
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
  const file = runtimeFile(event.request.url, self.registration.scope);
  if (file) event.respondWith(cacheFirst(event.request, file));
});
