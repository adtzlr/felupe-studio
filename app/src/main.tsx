import { render } from "preact";
import { MeshFiles } from "./core/meshfiles";
import { IndexedDBSession } from "./core/session";
import { ModelStore } from "./core/store";
import { registerServiceWorker } from "./service-worker";
import "./style.css";
import { App } from "./ui/App";
import { watchForUpdates } from "./updates";
import { PyodideClient } from "./worker/client";

void registerServiceWorker();
// start loading Python and FElupe right away (#40)
const client = new PyodideClient();
const store = new ModelStore();
// mesh files are written into the project directory of Python and read with meshio;
// scripts are written there and make meshes with the parameters of the model (#182)
const files = new MeshFiles(
  async (name, data) => {
    await client.writeFile(name, data);
    return client.inspectMesh(name);
  },
  {
    write: (name, data) => client.writeFile(name, data),
    make: (file, parameters, item) => client.makeMesh(file, parameters, item),
  },
);

render(
  <App
    store={store}
    client={client}
    files={files}
    // the project and its mesh files survive a reload (#57)
    session={"indexedDB" in window ? new IndexedDBSession() : undefined}
    // a newer deployment (not in the development server)
    updates={
      import.meta.env.PROD
        ? (onUpdate) => watchForUpdates(__BUILD_ID__, onUpdate)
        : undefined
    }
  />,
  document.getElementById("app")!,
);
