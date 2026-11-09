import { render } from "preact";
import { ModelStore } from "./core/store";
import { registerServiceWorker } from "./service-worker";
import "./style.css";
import { App } from "./ui/App";
import { PyodideClient } from "./worker/client";

void registerServiceWorker();
// start loading Python and FElupe right away (#40)
const client = new PyodideClient();
const store = new ModelStore();

render(<App store={store} client={client} />, document.getElementById("app")!);
