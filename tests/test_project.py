import copy
import json
from pathlib import Path

import pytest

from felupe_studio import project
from felupe_studio.project import ProjectError, dumps, js_number, loads

DATA = Path(__file__).parent / "data"
FILES = ["two_sections.felupe.json", "numbers.felupe.json"]


@pytest.mark.parametrize("name", FILES)
def test_round_trip(name):
    text = (DATA / name).read_text(encoding="utf-8")
    assert dumps(loads(text)) == text


def test_layout_does_not_depend_on_key_order():
    document = json.loads((DATA / "two_sections.json").read_text(encoding="utf-8"))
    shuffled = {
        "commands": [dict(reversed(list(c.items()))) for c in document["commands"]],
        "schema_version": 2,
    }
    text = (DATA / "two_sections.felupe.json").read_text(encoding="utf-8")
    assert dumps(document) == text
    assert dumps(shuffled) == text


def test_one_command_per_block():
    text = (DATA / "two_sections.felupe.json").read_text(encoding="utf-8")
    lines = text.splitlines()
    assert lines[:3] == ["{", '  "schema_version": 2,', '  "commands": [']
    starts = [i for i, line in enumerate(lines) if line == "    {"]
    assert len(starts) == 13
    assert all(lines[i + 1].startswith('      "command": ') for i in starts)
    assert all(lines[i + 2].startswith('      "name": ') for i in starts)
    assert text.endswith("}\n")


@pytest.mark.parametrize(
    "value, expected",
    [
        # outputs of JSON.stringify in Node.js
        (1e-8, "1e-8"),
        (0.3, "0.3"),
        (1.5e-7, "1.5e-7"),
        (1e21, "1e+21"),
        (1.23e21, "1.23e+21"),
        (123456789012345680000.0, "123456789012345680000"),
        (0.1 + 0.2, "0.30000000000000004"),
        (5000, "5000"),
        (5000.0, "5000"),
        (-0.0, "0"),
        (2.5e-6, "0.0000025"),
        (1e-6, "0.000001"),
        (1e-7, "1e-7"),
        (0.000001234, "0.000001234"),
        (1.7976931348623157e308, "1.7976931348623157e+308"),
        (5e-324, "5e-324"),
        (210000.5, "210000.5"),
        (-3.5, "-3.5"),
    ],
)
def test_js_number(value, expected):
    assert js_number(value) == expected


def test_js_number_rejects_invalid_values():
    for value in (float("nan"), float("inf"), True):
        with pytest.raises((ValueError, TypeError)):
            js_number(value)


def test_invalid_files():
    with pytest.raises(ProjectError, match="not valid JSON"):
        loads("{")
    with pytest.raises(ProjectError, match="does not contain"):
        loads("[]")
    with pytest.raises(ProjectError, match="no valid schema_version"):
        loads('{"commands": []}')
    with pytest.raises(ProjectError, match="Please update"):
        loads('{"schema_version": 3, "commands": []}')
    with pytest.raises(ProjectError) as error:
        loads('{"schema_version": 2, "commands": [{"command": "mesh.import"}]}')
    assert error.value.errors


def test_references_are_not_checked_when_loading():
    text = '{"schema_version": 2, "commands": [{"command": "cellset.from_file", '
    text += '"name": "a", "mesh": "missing"}]}'
    assert loads(text)["commands"][0]["mesh"] == "missing"


def test_migration_hook(monkeypatch):
    def from_0(document):
        document = copy.deepcopy(document)
        for cmd in document["commands"]:
            cmd["name"] = cmd.pop("id")
        return {**document, "schema_version": 1}

    monkeypatch.setitem(project.MIGRATIONS, 0, from_0)
    old = {
        "schema_version": 0,
        "commands": [{"command": "mesh.import", "id": "m", "file": "m.vtu"}],
    }
    assert loads(json.dumps(old))["commands"][0]["name"] == "m"

    monkeypatch.delitem(project.MIGRATIONS, 0)
    with pytest.raises(ProjectError, match="No migration from schema version 0"):
        loads(json.dumps(old))


def test_migration_of_ramps_from_version_1():
    old = json.loads((DATA / "two_sections.json").read_text(encoding="utf-8"))
    old["schema_version"] = 1
    step = next(c for c in old["commands"] if c["command"] == "step.add")
    step["ramp"] = {"boundary": "move", "also": ["fixed"], "end": 0.5, "num": 5}
    new = loads(json.dumps(old))
    assert new["schema_version"] == 2
    step = next(c for c in new["commands"] if c["command"] == "step.add")
    assert step["ramp"] == {
        "num": 5,
        "items": [
            {"target": "move", "end": 0.5},
            {"target": "fixed", "end": 0.5},
        ],
    }
    # the other commands are unchanged
    assert new["commands"][:-2] == old["commands"][:-2]
