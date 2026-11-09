import { render } from "preact";
import { MeshFiles } from "./core/meshfiles";
import { ModelStore } from "./core/store";
import { registerServiceWorker } from "./service-worker";
import "./style.css";
import { App } from "./ui/App";
import { PyodideClient } from "./worker/client";

void registerServiceWorker();
// start loading Python and FElupe right away (#40)
const client = new PyodideClient();
const store = new ModelStore();
// mesh files are written into the project directory of Python and read with meshio
const files = new MeshFiles(async (name, data) => {
  await client.writeFile(name, data);
  return client.inspectMesh(name);
});

render(
  <App store={store} client={client} files={files} />,
  document.getElementById("app")!,
);
