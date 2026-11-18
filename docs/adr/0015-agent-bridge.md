# 0015 An agent bridge to the open app

Status: Accepted

## Context

The MCP server (ADR 0012) works on a project in a folder: the agent builds and solves it, and the user opens the saved file in the app. Agent and user do not see the same model at the same time (#258). The app of `felupe-studio serve` (ADR 0014) is served by a local process that the app is already connected to, with a token and checks of the host and the origin; the app on GitHub Pages cannot reach `localhost` reliably (Private Network Access). The model of the open app lives in the browser: the command list with its history (`ModelStore`), the validation, the mesh files, the jobs with their live results and the view. The MCP SDK (`mcp` 2) offers a Streamable HTTP transport as a Starlette app, which agents like Claude Code and VS Code connect to by a URL with headers.

## Decision

- **The bridge lives in `felupe-studio serve`:** `felupe-studio serve --agent` also offers an MCP endpoint at `http://127.0.0.1:<port>/mcp` (Streamable HTTP, `felupe-studio[serve,mcp]`) and prints how to add it to an agent, e.g. `claude mcp add --transport http felupe-studio http://127.0.0.1:8765/mcp --header "Authorization: Bearer <token>"`. Without `--agent` there is no endpoint. The stdio server of ADR 0012 stays for headless work on project files.
- **The open app is the session:** the tools act on the model of one tab of the app. The user connects the tab with *Help ▸ Connect an agent*; the tab opens a second WebSocket, `/agent`, to the server. One tab at a time: a newly connected tab replaces the former one, which is told so. Without a connected tab, a tool fails with a message that says how to connect one. The tab shows that an agent is connected and disconnects with one click.
- **The app answers the tools:** the server forwards a tool call to the tab as a JSON message (`{"id", "tool", "arguments"}`) and returns its answer (`{"id", "result"}` or `{"id", "error"}`); progress of a long tool comes as `{"id", "progress"}` and becomes MCP progress notifications. The first message of the tab names the version of the bridge protocol; the server refuses other versions. The app executes the tools with what it has: the store, the validation, the mesh files, the job runner, the results and the viewer.
- **The tools,** with the names and answers of ADR 0012 where they fit:
  - `schema`, `samples`, `list_commands`, `add_command`, `update_command`, `delete_command`: a change goes into the history of the open model, one undo step each, and returns the issues of the app (the shared validation);
  - `open_sample` (only if the open model has no unsaved changes), `parameters`, `set_parameters`, `check`, `script`;
  - `write_file`: a mesh file or a mesh script of the agent into the files of the open model;
  - `solve`: the jobs run in the app, with its live results and its local Python, and the progress goes to the agent; `results`: the curve and the range of a quantity of a substep;
  - only for the bridge: `selection`, `select(names)`, `show(view)` (the model or the results of a job, a substep, a quantity) and `picture` (the view as a PNG image, ADR 0004).
- **Mesh scripts of the agent run after the user agrees:** a script that the agent writes runs with the rights of the user, so the app asks before it runs it (*Show* and *Run*); until then the mesh has an issue that says so.
- **Security:** the endpoint needs the token of the server (`Authorization: Bearer`), accepts the hosts `127.0.0.1` and `localhost` only and no browser origins (no CORS, the DNS rebinding protection of the SDK); the WebSocket `/agent` needs the token and the own origin, like `/runtime`. The user sees every change of the agent in the history and the browser, and can undo it.
- **Concurrency:** the tools run one after the other in the order of their calls, between the actions of the user; every answer has the current state (the issues, the selection). There is no locking: a call on an object that the user deleted fails with the message of the app.

## Consequences

- An agent and the user work on one model: the agent's commands are undoable steps of the open model, it sees the selection of the user and a picture of the view, and solves with the live results of the app on the local Python.
- The tools exist twice, in the stdio server (Python, on a project folder) and in the app (TypeScript, on the open model), with the same names and answers. Shared cases check that both give the same issues for the same commands; the descriptions of the tools come from one place in Python.
- Tests: the server forwards calls and progress to a fake tab and refuses a missing token, a foreign origin and another protocol version (Python); the app answers the tools of a fake bridge on a store (Vitest); Playwright: an agent (the MCP client of the SDK) adds a command, solves and gets a picture of the open app.
- The bridge needs `felupe-studio serve`; the app on GitHub Pages has none.
- Not yet: several tabs at a time, saving the project from the agent (the user saves), the stdio server forwarding to the bridge.

## Alternatives

- **A bridge of the stdio server (`felupe-studio-mcp --bridge`) with a WebSocket of its own:** a second local server next to `felupe-studio serve`, and the app on GitHub Pages would need Private Network Access to reach it.
- **The model in the server, mirrored to the app:** two copies of the command list and its history, and the validation of the app would have to run in Python for every change of the user.
- **Jobs in the server for the agent, results sent to the app:** the app of `serve` already solves with the local Python; solving in the app keeps one run with its live results for both.
- **WebMCP** (`navigator.modelContext`, a proposal): the page would offer its tools to an agent without a local process; not in browsers yet. The tools of the app would carry over.
