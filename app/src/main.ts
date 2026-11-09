import { formatVersion, renderStart, renderRuntime } from "./app";
import { registerServiceWorker } from "./service-worker";
import "./style.css";
import { PyodideClient } from "./worker/client";

const root = document.querySelector<HTMLElement>("#app");
if (root) {
  renderStart(root, formatVersion(__APP_VERSION__));
  // start loading Python and FElupe right away (#40)
  void registerServiceWorker();
  const status = renderRuntime(root, "Loading Python and FElupe …");
  const started = performance.now();
  new PyodideClient().ready.then(
    (ready) => {
      const s = ((performance.now() - started) / 1000).toFixed(1);
      status.textContent = `FElupe ${ready.versions.felupe} ready in ${s} s.`;
    },
    (error: Error) => (status.textContent = `Loading failed: ${error.message}`),
  );
}
