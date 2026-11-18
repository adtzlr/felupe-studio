"""The agent bridge of ``felupe-studio serve --agent`` (#258, ADR 0015): an MCP
endpoint whose tools act on the model of the open app.

The user connects one tab of the app (*Help ▸ Connect an agent*), which opens the
WebSocket ``/agent`` to the server. :class:`Bridge` forwards a tool call to the tab
(``{"type": "call", "id", "tool", "arguments"}``) and returns its answer
(``{"type": "result", "id", "result"}`` or ``{"type": "error", "id", "message"}``);
a long tool reports ``{"type": "progress", "id", "progress", "total", "message"}``.
The tab starts with ``{"type": "hello", "version": 1}``; the server answers
``welcome``, or ``refused`` for another version. A newly connected tab replaces the
former one, which gets ``replaced``. The calls run one after the other.

:func:`agent_server` is the MCP server of the bridge: the tools of the MCP server of
project folders (:mod:`felupe_studio.mcp`, with the same descriptions), on the open
model, and the tools of the bridge (the selection, the view and its picture).
Needs ``felupe-studio[serve,mcp]``.
"""

import asyncio
import base64
from typing import Any

from mcp.server.mcpserver import Context, Image, MCPServer
from mcp.server.mcpserver.exceptions import ToolError

from . import __version__
from .mcp import DESCRIPTIONS, schema

VERSION = 1
"""The version of the protocol of the bridge."""

NO_APP = (
    "No app is connected. Open the app of felupe-studio serve in a browser and "
    "choose Help ▸ Connect an agent."
)
GONE = "The app was disconnected before it answered."

INSTRUCTIONS = """\
FElupe Studio models are command lists (JSON) that FElupe solves. These tools act on
the model that is open in the app of the user (felupe-studio serve): every change is
an undoable step that the user sees, and the user may change the model too. Workflow:
list the commands (or open a sample), add commands in the order of their references
(schema shows the commands and their properties), fix the errors that every change
returns, then solve and read the results. selection shows what the user selected,
select and show change the view, picture returns an image of it. A mesh script that
you write runs after the user agrees in the app. Lengths, forces and stresses are in
the units of model.settings."""


class Bridge:
    """The connection of the server to the tab of the app that answers the tools."""

    def __init__(self):
        self.tab = None
        self._pending = {}
        self._next = 1
        self._lock = asyncio.Lock()

    @property
    def connected(self):
        return self.tab is not None

    async def attach(self, tab):
        """Make a tab the one that answers the tools; a former one is replaced."""
        former, self.tab = self.tab, tab
        if former is not None:
            self._fail(GONE)
            try:
                await former.send_json({"type": "replaced"})
                await former.close()
            except Exception:
                pass

    def detach(self, tab):
        """A tab disconnected: its pending calls fail."""
        if self.tab is tab:
            self.tab = None
            self._fail(GONE)

    def _fail(self, message):
        for future, _ in self._pending.values():
            if not future.done():
                future.set_exception(ToolError(message))
        self._pending.clear()

    async def answer(self, tab, message):
        """A message of a tab: the result, the error or the progress of a call."""
        if tab is not self.tab or message.get("id") not in self._pending:
            return
        future, progress = self._pending[message["id"]]
        kind = message.get("type")
        if kind == "progress":
            if progress is not None:
                await progress(
                    message.get("progress", 0),
                    message.get("total"),
                    message.get("message"),
                )
        elif kind == "result" and not future.done():
            future.set_result(message.get("result"))
        elif kind == "error" and not future.done():
            future.set_exception(ToolError(message.get("message", "Failed.")))

    async def call(self, tool, arguments=None, progress=None):
        """Call a tool of the tab and wait for its answer; ``progress`` is called
        with the progress, its total and a message."""
        async with self._lock:
            tab = self.tab
            if tab is None:
                raise ToolError(NO_APP)
            id_ = self._next
            self._next += 1
            future = asyncio.get_running_loop().create_future()
            self._pending[id_] = (future, progress)
            arguments = {k: v for k, v in (arguments or {}).items() if v is not None}
            try:
                await tab.send_json(
                    {"type": "call", "id": id_, "tool": tool, "arguments": arguments}
                )
                return await future
            finally:
                self._pending.pop(id_, None)


def agent_server(bridge):
    """The MCP server of the bridge: its tools act on the model of the open app."""
    mcp = MCPServer(
        "felupe-studio",
        instructions=INSTRUCTIONS,
        version=__version__,
        log_level="WARNING",
    )

    @mcp.tool(name="schema", description=DESCRIPTIONS["schema"])
    def schema_tool(command: str | None = None) -> dict[str, Any]:
        return schema(command)

    @mcp.tool(description=DESCRIPTIONS["samples"])
    async def samples() -> list[dict[str, Any]]:
        return await bridge.call("samples")

    @mcp.tool()
    async def open_sample(sample: str) -> dict[str, Any]:
        """Open a sample (its id) in the app, instead of the open model; only if the
        open model has no unsaved changes. Returns the commands and their issues."""
        return await bridge.call("open_sample", {"sample": sample})

    @mcp.tool(description=DESCRIPTIONS["list_commands"])
    async def list_commands() -> dict[str, Any]:
        return await bridge.call("list_commands")

    @mcp.tool(
        description=DESCRIPTIONS["add_command"] + " One undo step of the open model."
    )
    async def add_command(
        command: dict[str, Any], before: str | None = None
    ) -> dict[str, Any]:
        return await bridge.call("add_command", {"command": command, "before": before})

    @mcp.tool(
        description=DESCRIPTIONS["update_command"] + " One undo step of the open model."
    )
    async def update_command(name: str, changes: dict[str, Any]) -> dict[str, Any]:
        return await bridge.call("update_command", {"name": name, "changes": changes})

    @mcp.tool(
        description=DESCRIPTIONS["delete_command"] + " One undo step of the open model."
    )
    async def delete_command(name: str) -> dict[str, Any]:
        return await bridge.call("delete_command", {"name": name})

    @mcp.tool()
    async def parameters() -> dict[str, Any]:
        """The parameters of the model with their values, units and ranges."""
        return await bridge.call("parameters")

    @mcp.tool()
    async def set_parameters(values: dict[str, float]) -> dict[str, Any]:
        """Set the values of parameters (by name), as one undo step; the meshes of
        scripts and the expressions follow. Returns the issues."""
        return await bridge.call("set_parameters", {"values": values})

    @mcp.tool()
    async def write_file(name: str, content: str) -> dict[str, Any]:
        """Write a text file into the files of the open model, e.g. a mesh script (a
        Python script that makes a FElupe mesh `mesh`, or a dict of meshes, with the
        parameters of the model as variables) or a mesh file in a text format. A
        mesh script runs after the user agrees in the app."""
        return await bridge.call("write_file", {"name": name, "content": content})

    @mcp.tool(description=DESCRIPTIONS["check"])
    async def check() -> dict[str, Any]:
        return await bridge.call("check")

    @mcp.tool(description=DESCRIPTIONS["script"])
    async def script() -> str:
        return await bridge.call("script")

    @mcp.tool(
        description=DESCRIPTIONS["solve"]
        + " The jobs run in the app, with its live results."
    )
    async def solve(ctx: Context, job: str | None = None) -> dict[str, Any]:
        return await bridge.call("solve", {"job": job}, progress=ctx.report_progress)

    @mcp.tool(description=DESCRIPTIONS["results"])
    async def results(
        job: str,
        quantity: str = "stress_mises",
        substep: int | None = None,
        method: str = "cells",
    ) -> dict[str, Any]:
        arguments = {
            "job": job,
            "quantity": quantity,
            "substep": substep,
            "method": method,
        }
        return await bridge.call("results", arguments)

    @mcp.tool()
    async def selection() -> dict[str, Any]:
        """The objects that the user selected in the app, and the shown view."""
        return await bridge.call("selection")

    @mcp.tool()
    async def select(names: list[str]) -> dict[str, Any]:
        """Select objects of the model in the app (an empty list clears it)."""
        return await bridge.call("select", {"names": names})

    @mcp.tool()
    async def show(
        view: str = "model",
        job: str | None = None,
        substep: int | None = None,
        quantity: str | None = None,
    ) -> dict[str, Any]:
        """Show the model (view "model") or the results (view "results") of a job,
        at a substep (the last one by default) with the contour of a quantity."""
        arguments = {
            "view": view,
            "job": job,
            "substep": substep,
            "quantity": quantity,
        }
        return await bridge.call("show", arguments)

    @mcp.tool()
    async def picture() -> Image:
        """A picture of the view of the app (PNG), as the user sees it."""
        result = await bridge.call("picture")
        return Image(data=base64.b64decode(result["png"]), format="png")

    return mcp
