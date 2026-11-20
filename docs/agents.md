# AI agents (MCP server)

FElupe Studio has an [MCP](https://modelcontextprotocol.io) server (#239, [ADR 0012](adr/0012-mcp-server.md)): AI agents like Claude Code, GitHub Copilot (agent mode in VS Code) or Cursor build, check and solve models with its tools, for example *"a quarter of a plate with a hole in plane strain, pulled by 8 mm; report the force and the largest stress"*. The server runs headless on your computer with CPython (no browser). The project file is the shared state: the agent saves the project, and you open the `*.felupe.json` (or `*.felupe.zip`) in the web app to see it, also in the app on GitHub Pages.

## Install

The server is an optional part of the Python package (it needs the Python SDK `mcp`):

```bash
pip install "felupe-studio[mcp]"   # from PyPI
felupe-studio-mcp --help           # or: python -m felupe_studio.mcp
```

In a clone of the repository, `pip install -e ".[mcp]"` installs it from the sources. The server offers the samples and the documentation (the user guide, the commands and the command reference as resources): those of the package, or those of a clone (#275). `FELUPE_STUDIO_SAMPLES` sets another folder of samples, in the layout of `app/samples` (a folder per sample with its `model.felupe.json` and optionally its `sample.json`, see [a folder of samples](deployment.md#a-folder-of-samples)). The server checks the folder when it starts; `open_sample` copies the project and its mesh files, and the mesh scripts of the samples run without asking, since you chose the folder.

## Add it to an agent

Claude Code:

```bash
claude mcp add felupe-studio -- felupe-studio-mcp
```

VS Code (GitHub Copilot, agent mode) and Claude Code read a `.mcp.json` in the root of the workspace (in VS Code still experimental, the setting `chat.mcp.workspaceRootConfig.enabled`):

```json
{
  "mcpServers": {
    "felupe-studio": {
      "type": "stdio",
      "command": "felupe-studio-mcp",
      "tools": ["*"]
    }
  }
}
```

`tools` are the tools of the server that GitHub Copilot may use, `*` for all. VS Code's own file `.vscode/mcp.json` has the servers under `servers` instead of `mcpServers`.

Other clients start the command `felupe-studio-mcp` with the transport stdio. Options: `--project <file>` opens a project at the start, `--allow-scripts` lets the mesh scripts of opened projects run (see below).

## Tools

The tools are few and generic and follow the schema of the commands, like the command line of the app:

| Tool | What it does |
| --- | --- |
| `schema(command?)` | All commands with their descriptions; with a command, its JSON schema with the definitions it references. |
| `samples()`, `open_sample(sample, folder)` | The samples, and a copy of one in a new folder as the project. |
| `new_project(folder, name)`, `open_project(path, folder?)`, `save_project(path?, archive?)` | A project in a folder: a project file `<name>.felupe.json` with its mesh files beside it, or an archive `*.felupe.zip` (unpacked into a folder). |
| `list_commands()`, `add_command(command, before?)`, `update_command(name, changes)`, `delete_command(name)` | The commands. A command that does not fit its schema is not added (or not changed); every change returns the errors and notes of the validation of the app, so the agent can fix them. A new name renames a command, and the references to it follow; a command that others use is not deleted. |
| `write_file(name, content)` | A text file in the project folder, e.g. a mesh script. |
| `inspect_mesh(file, item?, parameters?)` | The cells, bounds and tags of a mesh file, or of the mesh of a mesh script. |
| `check()` | The checks that need the mesh data: cells in no or in two sections, hanging points of interfaces. |
| `script()` | The FElupe script, as the app exports it. |
| `solve(job?)` | Solves the jobs (up to a job) with FElupe; progress as notifications. Returns per job the substeps, the time and the curve (displacements and forces per substep), or the message and the traceback of a failure. |
| `results(job, quantity?, substep?, method?)` | A quantity at a substep (the last one): its range, the minimum and the maximum with their section, node or cell and position, the control points with their forces. |
| `export(job, format, path, substep?, method?)` | The results as VTU, XDMF or CSV. |

## Expressions of parameters

A number of a command may be an expression of the parameters as a string, e.g. `"end": "0.5 * layers * height"` or `"value": "height"` (see [Expressions of parameters](commands.md#expressions-of-parameters)). Its problems are errors of the validation like the others, e.g. *'layer' is not a parameter in '0.5 * layer * height'*; the script shows it as written. A renamed parameter is renamed in the expressions; a deleted one leaves them as errors.

## Mesh scripts

A mesh script (`mesh.script`) runs Python code with your rights; in the browser, Pyodide is a sandbox, here it is not. So the server runs a script only if it wrote it itself (`write_file`) or copied it from a sample, and the script has not changed since, or if it was started with `--allow-scripts`. Before you allow the scripts of a project from elsewhere, check them.

## The open app: felupe-studio serve --agent

With the bridge (ADR 0015), the agent works on the model that is open in the app, at the same time as you, instead of on a project folder:

```bash
pip install "felupe-studio[serve,mcp]"
felupe-studio serve --agent
```

It prints the endpoint and the command that adds it to Claude Code, e.g. `claude mcp add --transport http felupe-studio http://127.0.0.1:8765/mcp --header "Authorization: Bearer <token>"`. In the app, *Help ▸ Connect an agent* connects the tab; the status bar says *Agent connected*, and *Disconnect* ends it. One tab at a time: connecting another tab replaces it.

### The token in a .mcp.json

The token is new at every start, unless you give it at the start: then the environment variable `FELUPE_STUDIO_TOKEN` is the token of every start, at least 16 letters, digits, `_` or `-`. The `.mcp.json` in the root of the workspace takes it from the environment, so the file has no secret and stays valid:

```json
{
  "mcpServers": {
    "felupe-studio": {
      "type": "http",
      "url": "http://127.0.0.1:8765/mcp",
      "headers": {
        "Authorization": "Bearer ${FELUPE_STUDIO_TOKEN}"
      },
      "tools": ["*"]
    }
  }
}
```

Make a token once and set the variable for your user, so that `felupe-studio serve` and VS Code both see it. VS Code reads the environment when it starts, so start it again after you set the variable.

```bash
python -c "import secrets; print(secrets.token_urlsafe(24))"  # a token, once
export FELUPE_STUDIO_TOKEN=<the token>  # e.g. in ~/.bashrc or ~/.zshrc
```

On Windows (PowerShell), for your user:

```powershell
[Environment]::SetEnvironmentVariable("FELUPE_STUDIO_TOKEN", "<the token>", "User")
```

With the variable, `felupe-studio serve --agent` prints the header of the `.mcp.json` instead of the token, and the link of the app stays the same at every start, so a bookmark works. A token that is too short or has other characters stops the start with a message. In `.vscode/mcp.json`, the header takes the variable as `${env:FELUPE_STUDIO_TOKEN}`.

- The tools have the names and answers above, on the open model: `list_commands`, `add_command`, `update_command`, `delete_command` (each change is an undo step that you see in the history), `samples` and `open_sample` (only without unsaved changes), `parameters` and `set_parameters` (one undo step), `write_file`, `check`, `script`, `solve` (in the app, with its live results and progress) and `results`.
- Only with the bridge: `selection` (what you selected, and the view), `select`, `show` (the model, or the results of a job at a substep with a quantity) and `picture` (the view as an image).
- **A mesh script of the agent runs only if you agree:** `write_file` of a `.py` asks in the app (*Show the script*, *Run it*, *Do not run it*); the tool waits for your answer. So an agent builds parametric models: it writes a script that makes `mesh` from parameters, then adds `parameter.add` and `mesh.script`, and the mesh follows `set_parameters`.

## Limits

- One project at a time per server; the server keeps it in memory until it is saved.
- A long job blocks the tools until it is done (no cancel yet).
- With the bridge: one tab at a time, the selection of one object, and the user saves the project.
