# AI agents (MCP server)

FElupe Studio has an [MCP](https://modelcontextprotocol.io) server (#239, [ADR 0012](adr/0012-mcp-server.md)): AI agents like Claude Code, GitHub Copilot (agent mode in VS Code) or Cursor build, check and solve models with its tools, for example *"a quarter of a plate with a hole in plane strain, pulled by 8 mm; report the force and the largest stress"*. The server runs headless on your computer with CPython (no browser). The project file is the shared state: the agent saves the project, and you open the `*.felupe.json` (or `*.felupe.zip`) in the web app to see it, also in the app on GitHub Pages.

## Install

The server is an optional part of the Python package (it needs the Python SDK `mcp`):

```bash
pip install "felupe-studio[mcp]"   # from PyPI
felupe-studio-mcp --help           # or: python -m felupe_studio.mcp
```

In a clone of the repository, `pip install -e ".[mcp]"` installs it from the sources. The server offers the samples and the documentation (the user guide, the commands and the command reference as resources): those of the package, or those of a clone (#275). `FELUPE_STUDIO_SAMPLES` sets another folder of samples (with the layout of `app/public/samples`).

## Add it to an agent

Claude Code:

```bash
claude mcp add felupe-studio -- felupe-studio-mcp
```

VS Code (GitHub Copilot, agent mode), `.vscode/mcp.json`:

```json
{
  "servers": {
    "felupe-studio": { "type": "stdio", "command": "felupe-studio-mcp" }
  }
}
```

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

## Mesh scripts

A mesh script (`mesh.script`) runs Python code with your rights; in the browser, Pyodide is a sandbox, here it is not. So the server runs a script only if it wrote it itself (`write_file`) or copied it from a sample, and the script has not changed since, or if it was started with `--allow-scripts`. Before you allow the scripts of a project from elsewhere, check them.

## Limits

- One project at a time per server; the server keeps it in memory until it is saved.
- A long job blocks the tools until it is done (no cancel yet).
- The agent does not see the open app: it works on the project file. A bridge to the open app (commands into its history, pictures of the view, jobs in the browser) is a later step.
