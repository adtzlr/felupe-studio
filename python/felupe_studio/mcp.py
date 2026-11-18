"""An MCP server of FElupe Studio (#239, ADR 0012): AI agents build, check and solve
models with the tools of the Model Context Protocol, headless with CPython.

The project file is the shared state: the agent builds and solves a project in a
folder, and the user opens the saved ``*.felupe.json`` (or ``*.felupe.zip``) in the
web app. The tools are few and generic and follow the schema of the commands, like
the command line of the app: the agent adds, changes and deletes commands, and every
change returns the issues of the validation of the app (the shared cases), so it can
fix them.

Run it with ``felupe-studio-mcp`` (or ``python -m felupe_studio.mcp``), e.g. in
Claude Code: ``claude mcp add felupe-studio -- felupe-studio-mcp``. It needs the
optional dependency ``felupe-studio[mcp]`` (the Python SDK ``mcp``).

**Mesh scripts** (``mesh.script``) run Python code with the rights of the user (in
the browser, Pyodide is a sandbox). The server runs a script only if it wrote it
(``write_file``) or copied it from a sample, unchanged since, or if it was started
with ``--allow-scripts``: a project from elsewhere may have a script that nobody
checked.
"""

import argparse
import contextlib
import hashlib
import json
import os
import shutil
import threading
import traceback
import zipfile
from pathlib import Path
from typing import Any

import anyio
from mcp.server.mcpserver import Context, MCPServer
from mcp.server.mcpserver.exceptions import ToolError

from . import __version__, checks, meshes, runner
from . import commands as commands_
from . import results as results_
from .codegen import codegen, parameter_value
from .commands import SCHEMA_VERSION
from .project import ProjectError, dumps, loads

# the samples and the documentation of a clone of the repository (or a folder of
# samples: FELUPE_STUDIO_SAMPLES), which the package does not contain
ROOT = Path(__file__).resolve().parents[2]
DOCS = ROOT / "docs"
INDEX = ROOT / "app" / "src" / "core" / "samples.json"

DOCUMENTS = {
    "guide": "The user guide",
    "commands": "The commands and their FElupe code",
    "reference": "The reference of the commands",
}

SUFFIX = ".felupe.json"
ARCHIVE = ".felupe.zip"

INSTRUCTIONS = """\
FElupe Studio models are command lists (JSON) that FElupe solves. Workflow: open a
sample (samples, open_sample) or start a project in a folder (new_project), add
commands in the order of their references (schema shows the commands and their
properties), fix the errors that every change returns, then solve and read the
results (curve, extremes of a quantity). Mesh files go into the folder of the
project; write mesh scripts with write_file. Save the project: the user opens the
*.felupe.json in the web app FElupe Studio. Lengths, forces and stresses are in the
units of model.settings."""


def _samples_folder():
    """The folder of the samples, or None."""
    folder = os.environ.get("FELUPE_STUDIO_SAMPLES")
    folder = Path(folder) if folder else ROOT / "app" / "public" / "samples"
    return folder if folder.is_dir() else None


def _digest(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


class Session:
    """The project of the server: its command list, its folder and its file, the
    mesh scripts that may run, and the results of its last solve."""

    def __init__(self, allow_scripts=False):
        self.allow_scripts = allow_scripts
        self.folder = None
        self.path = None
        self.document = {"schema_version": SCHEMA_VERSION, "commands": []}
        # the mesh scripts that the server wrote or copied: path -> SHA-256
        self.trusted = {}
        self.solved = None
        self.lock = threading.Lock()

    # the project

    @property
    def commands(self):
        return self.document["commands"]

    def _need_folder(self):
        if self.folder is None:
            raise ToolError(
                "No project: open a sample (open_sample), a project (open_project) "
                "or start one (new_project)."
            )
        return self.folder

    def _file(self, name):
        """A file of the project folder: a relative path inside of it."""
        folder = self._need_folder()
        path = (folder / name).resolve()
        if path != folder and folder not in path.parents:
            raise ToolError(f"'{name}' is not a file in the project folder.")
        return path

    def summary(self):
        return {
            "folder": str(self.folder) if self.folder else None,
            "project": str(self.path) if self.path else None,
            "commands": len(self.commands),
            **self.issues(),
        }

    def issues(self):
        """The errors and notes of the validation, like the issues of the app."""
        return {
            "errors": commands_.errors(self.document),
            "notes": commands_.notes(self.commands),
        }

    def new_project(self, folder, name="model"):
        folder = Path(folder).expanduser().resolve()
        folder.mkdir(parents=True, exist_ok=True)
        self.folder = folder
        self.path = folder / f"{name}{SUFFIX}"
        self.document = {"schema_version": SCHEMA_VERSION, "commands": []}
        self.trusted = {}
        self.solved = None
        return self.summary()

    def open_project(self, path, folder=None):
        path = Path(path).expanduser().resolve()
        if not path.is_file():
            raise ToolError(f"No such file: {path}")
        if path.name.endswith(ARCHIVE):
            # an archive: unpacked into a folder (by default beside it)
            stem = path.name.removesuffix(ARCHIVE)
            target = Path(folder or path.parent / stem).expanduser().resolve()
            target.mkdir(parents=True, exist_ok=True)
            with zipfile.ZipFile(path) as archive:
                for info in archive.infolist():
                    name = Path(info.filename)
                    if name.is_absolute() or ".." in name.parts:
                        raise ToolError(f"The archive has an unsafe path: {name}")
                archive.extractall(target)
            projects = sorted(target.glob(f"*{SUFFIX}"))
            if not projects:
                raise ToolError(f"The archive has no project file (*{SUFFIX}).")
            path = projects[0]
        try:
            document = loads(path.read_text(encoding="utf-8"))
        except ProjectError as error:
            raise ToolError(str(error)) from error
        self.folder = path.parent
        self.path = path
        self.document = document
        self.trusted = {}
        self.solved = None
        return self.summary()

    def open_sample(self, sample, folder):
        source = _samples_folder()
        if source is None or not (source / sample).is_dir():
            available = [s["id"] for s in self.samples()] if source else []
            raise ToolError(
                f"No sample '{sample}'. Samples: {', '.join(available) or 'none'} "
                "(the samples are in a clone of the repository of FElupe Studio, or "
                "in the folder of FELUPE_STUDIO_SAMPLES)."
            )
        folder = Path(folder).expanduser().resolve()
        if folder.exists() and any(folder.iterdir()):
            raise ToolError(f"The folder {folder} is not empty.")
        folder.mkdir(parents=True, exist_ok=True)
        for file in (source / sample).iterdir():
            if file.name in ("model.felupe.json", "thumbnail.svg"):
                continue
            shutil.copy(file, folder / file.name)
            if file.suffix == ".py":
                # the scripts of the samples are those of the app
                self.trusted[(folder / file.name).resolve()] = _digest(file)
        trusted = self.trusted
        project = folder / f"{sample}{SUFFIX}"
        shutil.copy(source / sample / "model.felupe.json", project)
        summary = self.open_project(project)
        self.trusted = trusted
        return summary

    def samples(self):
        if not INDEX.is_file() or _samples_folder() is None:
            return []
        index = json.loads(INDEX.read_text(encoding="utf-8"))
        keys = ("id", "title", "description", "topics")
        return [{k: s[k] for k in keys if k in s} for s in index]

    def save_project(self, path=None, archive=False):
        self._need_folder()
        path = Path(path).expanduser().resolve() if path else self.path
        archive = archive or path.name.endswith(ARCHIVE)
        if archive and not path.name.endswith(ARCHIVE):
            path = path.parent / (path.name.removesuffix(SUFFIX) + ARCHIVE)
        if not archive and not path.name.endswith(SUFFIX):
            path = path.parent / (path.name + SUFFIX)
        text = dumps(self.document)
        files = self._project_files()
        path.parent.mkdir(parents=True, exist_ok=True)
        if archive:
            stem = path.name.removesuffix(ARCHIVE)
            with zipfile.ZipFile(path, "w", zipfile.ZIP_DEFLATED) as zipped:
                zipped.writestr(f"{stem}{SUFFIX}", text)
                for name in files:
                    zipped.write(self.folder / name, name)
            return {"saved": str(path), "files": files}
        # a project file in another folder: its mesh files go with it
        for name in files:
            if path.parent != self.folder:
                (path.parent / name).parent.mkdir(parents=True, exist_ok=True)
                shutil.copy(self.folder / name, path.parent / name)
        path.write_text(text, encoding="utf-8")
        if path.parent != self.folder:
            for name in files:
                source = (self.folder / name).resolve()
                if source in self.trusted:
                    self.trusted[(path.parent / name).resolve()] = self.trusted[source]
        self.folder, self.path = path.parent, path
        return {"saved": str(path), "files": files}

    def _project_files(self):
        """The mesh files and the scripts of the commands that exist."""
        names = [
            c["file"]
            for c in self.commands
            if c["command"] in ("mesh.import", "mesh.script")
        ]
        return sorted({n for n in names if (self.folder / n).is_file()})

    # the commands

    def find(self, name):
        for i, cmd in enumerate(self.commands):
            if cmd["name"] == name:
                return i, cmd
        raise ToolError(f"No command named '{name}'.")

    def _check(self, document, index):
        """The errors of the schema of the command at an index (rejected)."""
        prefix = f"commands/{index}"
        return [
            m
            for m in commands_.schema_errors(document)
            if m == prefix or m.startswith(prefix + ":") or m.startswith(prefix + "/")
        ]

    def add_command(self, command, before=None):
        self._need_folder()
        if not isinstance(command, dict) or "command" not in command:
            raise ToolError("A command is an object with 'command' and 'name'.")
        index = len(self.commands) if before is None else self.find(before)[0]
        commands = [*self.commands[:index], command, *self.commands[index:]]
        document = {**self.document, "commands": commands}
        rejected = self._check(document, index)
        if rejected:
            raise ToolError("Not added: " + " ".join(rejected))
        self.document = document
        self.solved = None
        return {"added": command.get("name"), "index": index, **self.issues()}

    def update_command(self, name, changes):
        index, old = self.find(name)
        command = {**old, **changes}
        command = {k: v for k, v in command.items() if v is not None}
        new = command.get("name", name)
        commands = list(self.commands)
        commands[index] = command
        if new != name:
            # the references to it follow, like a rename in the app
            commands = [
                commands_.rename_references(c, name, new) if i != index else c
                for i, c in enumerate(commands)
            ]
        document = {**self.document, "commands": commands}
        rejected = self._check(document, index)
        if rejected:
            raise ToolError("Not changed: " + " ".join(rejected))
        self.document = document
        self.solved = None
        return {"updated": new, "index": index, **self.issues()}

    def delete_command(self, name):
        index, _ = self.find(name)
        users = [
            c["name"]
            for c in self.commands
            if any(ref == name for _, ref in commands_.references(c))
        ]
        if users:
            raise ToolError(
                f"'{name}' is used by {', '.join(users)}: change or delete them first."
            )
        del self.commands[index]
        self.solved = None
        return {"deleted": name, **self.issues()}

    # files and meshes

    def write_file(self, name, content):
        path = self._file(name)
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(content, encoding="utf-8")
        if path.suffix == ".py":
            self.trusted[path] = _digest(path)
        return {"written": name, "bytes": len(content.encode("utf-8"))}

    def _scripts(self):
        """The scripts of the meshes of the project."""
        return sorted(
            {c["file"] for c in self.commands if c["command"] == "mesh.script"}
        )

    def _may_run(self, names):
        """Raise unless the scripts may run (see the docstring of the module)."""
        if self.allow_scripts:
            return
        for name in names:
            path = self._file(name)
            if not path.is_file():
                continue
            if self.trusted.get(path) != _digest(path):
                raise ToolError(
                    f"The mesh script '{name}' runs Python code, and this server did "
                    "not write it (or it changed since). Check it, then write it with "
                    "write_file, or start the server with --allow-scripts."
                )

    def parameters(self):
        return {
            c["name"]: parameter_value(c)
            for c in self.commands
            if c["command"] == "parameter.add"
        }

    def inspect_mesh(self, file, item=None, parameters=None):
        path = self._file(file)
        if not path.is_file():
            raise ToolError(f"No file '{file}' in the project folder.")
        if path.suffix != ".py":
            return meshes.inspect(path)
        self._may_run([file])
        values = {**self.parameters(), **(parameters or {})}
        with contextlib.chdir(self.folder):
            info, _ = meshes.make(path, values, item)
        return json.loads(info)

    def check(self):
        self._need_folder()
        self._may_run(self._scripts())
        with contextlib.chdir(self.folder):
            return checks.check(self.document, self.folder)

    def script(self):
        try:
            return codegen(self.document)
        except commands_.ValidationError as error:
            raise ToolError("The project has errors: " + str(error)) from error

    # solve and results

    def solve(self, job=None, report=lambda event: None):
        self._need_folder()
        errors = commands_.errors(self.document)
        if errors:
            raise ToolError("Fix the errors first: " + " ".join(errors))
        self._may_run(self._scripts())
        document = self.document
        jobs = [c["name"] for c in self.commands if c["command"] == "job.add"]
        if not jobs:
            raise ToolError("The project has no job (job.add).")
        if job is not None:
            if job not in jobs:
                raise ToolError(f"No job '{job}'. Jobs: {', '.join(jobs)}.")
            # the jobs before it run too: a job starts from the state of the last one
            later = set(jobs[jobs.index(job) + 1 :])
            commands = [c for c in self.commands if c["name"] not in later]
            document = {**self.document, "commands": commands}
        with self.lock, contextlib.chdir(self.folder):
            try:
                results = runner.run(document, report)
            except Exception as error:
                trace = traceback.format_exc(limit=-6)
                self.solved = None
                raise ToolError(
                    f"The job failed: {type(error).__name__}: {error}\n{trace}"
                ) from error
        self.solved = results
        return {
            name: {
                "substeps": r["substeps"],
                "time": round(r["time"], 3),
                **({"curve": _curve(r)} if "x" in r else {}),
            }
            for name, r in results.items()
        }

    def _need_results(self, job):
        if not self.solved:
            raise ToolError("No results: solve the project first.")
        if job not in self.solved:
            raise ToolError(f"No results of job '{job}': {', '.join(self.solved)}.")

    def results(self, job, quantity="stress_mises", substep=None, method="cells"):
        self._need_results(job)
        if quantity not in results_.QUANTITIES:
            raise ToolError(
                f"Unknown quantity '{quantity}': {', '.join(results_.QUANTITIES)}."
            )
        last = results_.substeps(job)
        substep = last if substep is None else substep
        if not 1 <= substep <= last:
            raise ToolError(f"Job '{job}' has the substeps 1 to {last}.")
        try:
            meta, _ = results_.scene(job, substep, quantity, method)
        except ValueError as error:
            raise ToolError(str(error)) from error
        return {"job": job, "substep": substep, "substeps": last, **json.loads(meta)}

    def export(self, job, file_format, path, substep=None, method="cells"):
        self._need_results(job)
        target = Path(path).expanduser()
        target = target if target.is_absolute() else self._file(path)
        data = results_.export(job, file_format, substep, method)
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(data)
        return {"written": str(target), "bytes": len(data)}


def _curve(result):
    """The curve of a job: the displacements and forces (x, y, z) per substep."""
    return {"x": result["x"], "y": result["y"]}


def schema(command=None):
    """The commands with their descriptions, or the schema of one command with the
    definitions it references."""
    document = commands_.schema()
    definitions = document["$defs"]

    def resolve(ref):
        return ref.removeprefix("#/$defs/")

    entries = [resolve(r["$ref"]) for r in definitions["Command"]["oneOf"]]
    by_command = {}
    for key in entries:
        node = definitions[key]
        variants = [resolve(v["$ref"]) for v in node.get("oneOf", [])]
        name = (
            node["properties"]["command"]["const"]
            if "properties" in node
            else definitions[variants[0]]["properties"]["command"]["const"]
        )
        by_command[name] = key
    if command is None:
        return {
            "schema_version": SCHEMA_VERSION,
            "commands": [
                {
                    "command": name,
                    "kind": commands_.KINDS.get(name),
                    "description": definitions[key].get("description", ""),
                }
                for name, key in by_command.items()
            ],
            "note": "schema(command) gives the properties of a command.",
        }
    if command not in by_command:
        raise ToolError(f"Unknown command '{command}': {', '.join(by_command)}.")
    # the definition with all definitions it references
    key = by_command[command]
    needed, todo = {}, [key]
    while todo:
        name = todo.pop()
        if name in needed:
            continue
        needed[name] = definitions[name]
        text = json.dumps(definitions[name])
        for part in text.split('"$ref": "#/$defs/')[1:]:
            todo.append(part.split('"', 1)[0])
    return {"$ref": f"#/$defs/{key}", "$defs": needed}


def server(session=None):
    """The MCP server of a session (a new one by default)."""
    session = session or Session()
    mcp = MCPServer("felupe-studio", instructions=INSTRUCTIONS, version=__version__)

    @mcp.tool(name="schema")
    def schema_tool(command: str | None = None) -> dict[str, Any]:
        """Without a command: all commands with their descriptions. With a command
        (e.g. "material.add"): its JSON schema with the definitions it references,
        to write valid commands."""
        return schema(command)

    @mcp.tool()
    def samples() -> list[dict[str, Any]]:
        """The samples of FElupe Studio: id, title, description and topics."""
        return session.samples()

    @mcp.tool()
    def open_sample(sample: str, folder: str) -> dict[str, Any]:
        """Copy a sample (its id) into a new, empty folder and open it as the
        project. Returns the project and its issues."""
        return session.open_sample(sample, folder)

    @mcp.tool()
    def new_project(folder: str, name: str = "model") -> dict[str, Any]:
        """Start an empty project in a folder (created if needed), saved as
        <name>.felupe.json. Mesh files and scripts go into this folder."""
        return session.new_project(folder, name)

    @mcp.tool()
    def open_project(path: str, folder: str | None = None) -> dict[str, Any]:
        """Open a project file (*.felupe.json, its mesh files beside it) or an
        archive (*.felupe.zip, unpacked into a folder, by default beside it)."""
        return session.open_project(path, folder)

    @mcp.tool()
    def save_project(path: str | None = None, archive: bool = False) -> dict[str, Any]:
        """Save the project (by default to its file): a project file, or an archive
        (*.felupe.zip) with its mesh files and scripts. The web app FElupe Studio
        opens both."""
        return session.save_project(path, archive)

    @mcp.tool()
    def list_commands() -> dict[str, Any]:
        """The commands of the project in their order, with its errors and notes."""
        return {"commands": session.commands, **session.summary()}

    @mcp.tool()
    def add_command(
        command: dict[str, Any], before: str | None = None
    ) -> dict[str, Any]:
        """Add a command (an object with "command" and "name" and the properties of
        its schema), at the end or before the command of a name. A command that does
        not fit its schema is not added. Returns the errors and notes of the
        project: references must name earlier commands."""
        return session.add_command(command, before)

    @mcp.tool()
    def update_command(name: str, changes: dict[str, Any]) -> dict[str, Any]:
        """Change properties of a command (null removes a property). A new "name"
        renames it, and the references to it follow."""
        return session.update_command(name, changes)

    @mcp.tool()
    def delete_command(name: str) -> dict[str, Any]:
        """Delete a command that no other command references."""
        return session.delete_command(name)

    @mcp.tool()
    def write_file(name: str, content: str) -> dict[str, Any]:
        """Write a text file into the project folder, e.g. a mesh script (a Python
        script that makes a FElupe mesh `mesh`, or a dict of meshes, with the
        parameters of the model as variables) or a mesh file in a text format."""
        return session.write_file(name, content)

    @mcp.tool()
    def inspect_mesh(
        file: str, item: str | None = None, parameters: dict[str, Any] | None = None
    ) -> dict[str, Any]:
        """The cells, bounds and tags of a mesh file of the project folder, or of
        the mesh of a mesh script (an item of its dict of meshes, with the
        parameters of the model, changed by `parameters`)."""
        return session.inspect_mesh(file, item, parameters)

    @mcp.tool()
    def check() -> dict[str, Any]:
        """The checks that need the mesh data: cells in no or in two sections, and
        hanging points of interfaces."""
        return session.check()

    @mcp.tool()
    def script() -> str:
        """The FElupe script of the project, as the app exports it."""
        return session.script()

    @mcp.tool()
    async def solve(ctx: Context, job: str | None = None) -> dict[str, Any]:
        """Solve the jobs (up to and including `job`) with FElupe. Returns per job
        the substeps, the time and the curve: displacements x and forces y (x, y, z
        each) per substep. A failure returns the message and the traceback."""
        state = {"done": 0, "total": None, "jobs": [], "finished": 0}

        def report(event):
            # the converged substeps of all jobs, as the progress of the call
            if event["event"] == "start":
                state["jobs"] = event["jobs"]
                state["total"] = sum(sum(s) for s in event["substeps"].values())
            elif event["event"] == "finished":
                state["finished"] += 1
            elif event["event"] == "converged":
                state["done"] += 1
                job = state["jobs"][min(state["finished"], len(state["jobs"]) - 1)]
                message = f"{job}: {state['done']} of {state['total']} substeps"
                anyio.from_thread.run(
                    ctx.report_progress, state["done"], state["total"], message
                )

        return await anyio.to_thread.run_sync(lambda: session.solve(job, report))

    @mcp.tool()
    def results(
        job: str,
        quantity: str = "stress_mises",
        substep: int | None = None,
        method: str = "cells",
    ) -> dict[str, Any]:
        """The result of a quantity at a substep (the last one by default): its
        range, the minimum and the maximum with their section, node or cell and
        position, and the control points with their forces. Quantities:
        displacement, displacement_x/y/z, strain_max/mid/min, stress_max/mid/min,
        stress_mises, plastic_strain; methods: cells (the means of the cells) or
        mean, project, topoints (at the points)."""
        return session.results(job, quantity, substep, method)

    @mcp.tool()
    def export(
        job: str,
        format: str,
        path: str,
        substep: int | None = None,
        method: str = "cells",
    ) -> dict[str, Any]:
        """Export the results of a job: vtu (a substep, the last one by default),
        xdmf (all substeps) or csv (the curve and the control points), to a path
        (relative to the project folder)."""
        return session.export(job, format, path, substep, method)

    # the documentation of a clone of the repository
    def reader(path):
        return lambda: path.read_text(encoding="utf-8")

    for name, title in DOCUMENTS.items():
        path = DOCS / f"{name}.md"
        if path.is_file():
            mcp.resource(
                f"felupe-studio://docs/{name}",
                name=name,
                description=f"{title} of FElupe Studio (Markdown)",
                mime_type="text/markdown",
            )(reader(path))
    return mcp


def main(argv=None):
    parser = argparse.ArgumentParser(
        prog="felupe-studio-mcp",
        description="The MCP server of FElupe Studio (stdio).",
    )
    parser.add_argument(
        "--allow-scripts",
        action="store_true",
        help="run the mesh scripts of opened projects without asking",
    )
    parser.add_argument("--project", help="a project file to open at the start")
    args = parser.parse_args(argv)
    session = Session(allow_scripts=args.allow_scripts)
    if args.project:
        session.open_project(args.project)
    server(session).run("stdio")


if __name__ == "__main__":
    main()
