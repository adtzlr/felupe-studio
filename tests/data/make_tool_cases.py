"""Write tool_cases.json: the answers of the tools that change commands (#258, ADR
0015), shared by the MCP server of project folders (felupe_studio.mcp.Session) and
the agent bridge of the app (app/src/agent/tools.ts).

Every case starts from the document of two_sections.json and calls tools one after
the other. A step has the answer of the server: the errors and notes of the
validation, the name and the index of the changed command and the names of all
commands, or the message of a refused change. A refusal by the schema has only its
prefix (Python and the app word the messages of their schema validators
differently). Run ``python tests/data/make_tool_cases.py`` after a change of the
tools or of the validation.
"""

import copy
import json
import tempfile
from pathlib import Path

from mcp.server.mcpserver.exceptions import ToolError

from felupe_studio.mcp import Session

HERE = Path(__file__).parent
BASE = json.loads((HERE / "two_sections.json").read_text(encoding="utf-8"))
SCHEMA_PREFIXES = ("Not added: commands/", "Not changed: commands/")

h = {"command": "parameter.add", "name": "h", "value": 2}
CASES = {
    "add a parameter and use it in an expression": [
        ("add_command", {"command": h}),
        (
            "update_command",
            {"name": "right", "changes": {"select": {"axis": "x", "value": "h + 1"}}},
        ),
    ],
    "add a command before another one": [
        ("add_command", {"command": h, "before": "right"}),
    ],
    "an unknown parameter in an expression": [
        ("add_command", {"command": h}),
        (
            "update_command",
            {"name": "right", "changes": {"select": {"axis": "x", "value": "2 * hh"}}},
        ),
    ],
    "a renamed parameter in the expressions": [
        ("add_command", {"command": h}),
        (
            "update_command",
            {"name": "right", "changes": {"select": {"axis": "x", "value": "h"}}},
        ),
        ("update_command", {"name": "h", "changes": {"name": "height"}}),
    ],
    "a renamed object in the references": [
        ("update_command", {"name": "right", "changes": {"name": "end"}}),
    ],
    "a reference to a missing object": [
        (
            "add_command",
            {
                "command": {
                    "command": "boundary.add",
                    "name": "other",
                    "pointset": "nowhere",
                    "constrained": ["x"],
                }
            },
        ),
    ],
    "null removes a property": [
        ("update_command", {"name": "step_1", "changes": {"ramp": None}}),
    ],
    "a symmetry plane of a load case": [
        (
            "add_command",
            {
                "command": {
                    "command": "symmetry.add",
                    "name": "half",
                    "axes": ["x", "z"],
                },
                "before": "step_1",
            },
        ),
        (
            "add_command",
            {
                "command": {
                    "command": "loadcase.add",
                    "name": "test",
                    "type": "uniaxial",
                },
                "before": "step_1",
            },
        ),
    ],
    "delete a command": [("delete_command", {"name": "job_1"})],
    "delete a used command": [("delete_command", {"name": "right"})],
    "a command that does not exist": [
        ("update_command", {"name": "nothing", "changes": {}}),
        ("delete_command", {"name": "nothing"}),
    ],
    "a name twice": [
        ("add_command", {"command": {**h, "name": "right"}}),
        ("update_command", {"name": "left", "changes": {"name": "right"}}),
    ],
    # the Mullins effect of a hyperelastic material (#346), not of a linear-elastic
    "the mullins effect of a material": [
        (
            "update_command",
            {
                "name": "umat_soft",
                "changes": {"mullins": {"r": 3, "m": 0.2, "beta": 0.1}},
            },
        ),
        (
            "update_command",
            {
                "name": "umat_hard",
                "changes": {"mullins": {"r": 3, "m": 0.2, "beta": 0.1}},
            },
        ),
    ],
    "a command against its schema": [
        (
            "add_command",
            {"command": {"command": "material.add", "name": "m", "model": "NeoHooke"}},
        ),
        ("update_command", {"name": "step_1", "changes": {"ramp": {"num": 0}}}),
    ],
}


def answer(session, tool, arguments):
    """The answer of a tool of the server, as the shared cases have it."""
    try:
        result = getattr(session, tool)(**copy.deepcopy(arguments))
    except ToolError as error:
        message = str(error)
        for prefix in SCHEMA_PREFIXES:
            if message.startswith(prefix):
                return {"refused": prefix[: -len("commands/")]}
        return {"refused": message}
    kept = {
        key: result[key]
        for key in ("added", "updated", "deleted", "index", "errors", "notes")
        if key in result
    }
    return {**kept, "commands": [c["name"] for c in session.commands]}


def case(steps):
    session = Session()
    with tempfile.TemporaryDirectory() as folder:
        session.new_project(folder)
        session.document = copy.deepcopy(BASE)
        return [
            {
                "tool": tool,
                "arguments": arguments,
                "answer": answer(session, tool, arguments),
            }
            for tool, arguments in steps
        ]


if __name__ == "__main__":
    cases = [{"name": name, "steps": case(steps)} for name, steps in CASES.items()]
    text = json.dumps(cases, indent=2) + "\n"
    (HERE / "tool_cases.json").write_text(text, encoding="utf-8")
