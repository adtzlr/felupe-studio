# 0014 A local Python runtime

Status: Accepted

## Context

The app runs the Python side (`felupe_studio`, FElupe, NumPy, SciPy) in Pyodide in a web worker (ADR 0005). It needs no installation, but WebAssembly is slower than native NumPy and SciPy with several threads, the memory of a tab is limited, there is no PyPardiso, the first start downloads about 30 MB, and a mesh script cannot import tools like gmsh (#240). `felupe_studio` runs unchanged in CPython (ADR 0003): the tests, the golden cases and the MCP server (ADR 0012) use it.

The app talks to the worker through `app/src/worker/client.ts`: requests with an id (`write-file`, `inspect-mesh`, `make-mesh`, `run`, `script`, `script-view`, `result-scene`, `result-ranges`, `export-results`, `export-mesh`, `benchmark`) and answers of the same id (`progress`, `job-progress`, `job-result`, `mesh-info`, `result-scene`, `text`, `bytes`, `done`, `error`); the arrays of surfaces and scenes are transferred as typed arrays. Python returns them as JSON and bytes. A running job is cancelled by terminating the worker; the client writes its files into the new one. A server backend is a non-goal (README); browsers restrict a public page that connects to `localhost` (Private Network Access).

## Decision

- **One app, two runtimes.** Pyodide stays the default (GitHub Pages). `felupe-studio serve` starts a local server that serves the built app and runs the Python side with the CPython of the user. The app opened from it uses the local runtime; there is no switch between the two in one page.
- **The command and its dependencies:** a console script `felupe-studio` with the subcommand `serve` (`--port`, default 8765, `--no-browser`, `--app <dist>`), the optional dependency `felupe-studio[serve]`: Starlette and uvicorn with `websockets` (the MCP SDK uses Starlette and uvicorn too). It listens on `127.0.0.1` only.
- **The same protocol over a WebSocket:** the messages of `app/src/worker/protocol.ts` unchanged, at `ws://127.0.0.1:<port>/runtime`. JSON messages are text frames. A message with arrays or bytes (a `mesh-info` with surfaces, a scene, `bytes`, `write-file`) is a binary frame: the length of a JSON header (4 bytes, little-endian), the header, then the buffers, aligned to 8 bytes. The header is the message with `{"$bytes": i}` in place of the i-th buffer, and the offsets and lengths of the buffers. The arrays of surfaces and scenes arrive as bytes, like from Pyodide, and the app turns them into typed arrays with the code of the worker (`surface.ts`), so the rest of the app does not see the difference.
- **One connection, one Python process:** the server starts a subprocess per connection with a temporary folder of the session; the process holds the state like the worker (meshes, results) and calls the same functions: `meshes.load` and `make_json`, `runner.run_json` with its reports, `runner.script` and `script_view`, `results.scene`, `ranges` and `export`, `meshes.export_json`, `benchmark`. *Cancel* closes the connection and opens a new one, like terminating the worker: the server ends the process and removes its folder, and the client writes its files again. The server process itself runs no model code.
- **Security:** a random token (`secrets.token_urlsafe`) is part of the URL that `serve` prints and opens, like Jupyter. The app keeps it for the session of the tab and removes it from the address bar; the WebSocket needs it. The server accepts only the hosts `127.0.0.1` and `localhost` (against DNS rebinding) and only WebSockets of its own origin. Mesh scripts run with the rights of the user, not in the sandbox of the browser: the dialog of a project with scripts says that they run on this computer before they run.
- **Choosing the runtime:** the server adds `<meta name="felupe-studio-runtime" content="python">` to the `index.html` it serves; with it the app uses the local client, without it the Pyodide worker. The local app registers no service worker. The status bar and *About* name the runtime with its versions (Python, FElupe, NumPy, SciPy, `felupe_studio`); a version of `felupe_studio` other than that of the app is reported.
- **The built app in the package:** the release builds the app and puts it into the wheel (`felupe_studio/data/app`, without the wheels for Pyodide); from a clone, `serve` takes `app/dist` (`npm run build`).
- **A local process of the user is not a server backend:** nothing is hosted, one user, one machine; the app on GitHub Pages does not depend on it.

## Consequences

- Native speed with the threads of NumPy and SciPy, the memory of the machine, no download of Pyodide; later the linear solver PyPardiso as an option of a job, if it is installed (#152), and mesh scripts that import installed packages.
- The app gets a runtime interface with two clients, the Pyodide worker and the WebSocket; the code of the panels does not change. The decoding of the arrays is shared.
- Tests: the server with a client of the protocol (Starlette's test client): files, meshes, a run with progress and live scenes, results, exports, cancel, a missing or wrong token, a foreign origin. The app: the local client against a fake WebSocket, like the worker client. Playwright: a sample from `felupe-studio serve`, solved with CPython; the golden cases cover the CPython path already.
- The wheel grows by about 2 MB (the app without the wheels for Pyodide). The versions of the app and the package are the same in a release; from a clone they may differ, which the app reports.
- Not yet: saving into a folder of the computer (saving and opening still use the browser), mesh scripts that import modules next to the project file (the session folder is temporary), the MCP server in the same process (step 2 of #239), several users or a remote machine.

## Alternatives

- **The app on GitHub Pages connects to a local runtime:** no app in the package, but Private Network Access asks for permissions and preflights that browsers still change, and the versions of the app and the package drift apart.
- **An HTTP API per call:** a second protocol beside the worker messages; progress, live scenes and cancelling need a channel anyway.
- **The jobs in the server process:** no subprocess, but a running job can only be stopped if it cooperates, and a crash ends the server.
- **`websockets` alone, without Starlette:** fewer dependencies, but the static files of the app need a server of their own, and the MCP server could not join later.
- **A desktop app (Electron, Tauri) or a Jupyter kernel:** a package per operating system, or a notebook server with much more than the app needs.
