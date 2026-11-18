# 0012 An MCP server for AI agents

Status: Accepted

## Context

AI agents (Claude Code, GitHub Copilot in VS Code, Cursor) call tools of servers of the Model Context Protocol (MCP). An MCP server is a process: a local one (stdio) or one behind HTTP. The command list is already the API of the app: a JSON schema, a validation with shared cases, the code generation, the runner and the results in the package `felupe_studio`, which runs in Pyodide and in CPython alike (ADR 0003). The web app on GitHub Pages is static and cannot be an MCP server. A server backend is a non-goal of FElupe Studio (README).

## Decision

- **A local, headless MCP server** (#239): `felupe_studio.mcp`, started as `felupe-studio-mcp` (or `python -m felupe_studio.mcp`) with the transport stdio. It needs the optional dependency `felupe-studio[mcp]` (the Python SDK `mcp` 2, `MCPServer`), runs with CPython (native NumPy and SciPy) and is not part of the Pyodide worker.
- **The project file is the shared state**: the server builds and solves a project in a folder, and the user opens the saved project (or archive) in the web app. Projects, mesh files and archives are those of the app (ADR 0007).
- **Few generic tools that follow the schema**, not one tool per command: the schema of the commands, the samples, projects, `add_command`, `update_command` and `delete_command` (each returns the errors and notes of the shared validation), files, meshes, checks, the script, `solve` (progress as notifications) and the results and exports. A command that does not fit its schema is not added, so the command list is always valid against the schema; references and the other rules of the validation are issues to fix, like in the app.
- **Mesh scripts run only if the server wrote them** (`write_file`) or copied them from a sample, unchanged since, or with the flag `--allow-scripts`: a script runs Python code with the rights of the user, while the browser is a sandbox.
- **A local process of the user is not a server backend**: nothing is hosted, and the web app does not depend on it.

## Consequences

- An agent writes valid commands from the schema and fixes them from the messages of the validation, solves with the runner of the app and reads structured results; the saved project opens in the app with the same commands.
- The tests call the tools on a project built command by command (the golden case `cube_yeoh`), on the samples and over the protocol (the client of the SDK, in-process and over stdio).
- The samples and the documentation are part of the repository, not of the package: the server offers them from a clone (or a folder of samples, `FELUPE_STUDIO_SAMPLES`).
- Not yet: a bridge to the open app (commands into its history, selections, pictures of the view, jobs in the browser), cancelling a long job, several projects at a time.

## Alternatives

- **No server, the agent edits the project file and runs the exported script**: possible today, but without the validation of the app, the schema as documentation, structured results and the samples.
- **One tool per command**: dozens of tools with their own schemas, which would duplicate the schema of the commands.
- **A server in the web app** (WebMCP, a proposal: a page offers tools to an agent in the browser): no local process, but not available in browsers yet; a bridge from the local server to the open app over `localhost` is the next step.
