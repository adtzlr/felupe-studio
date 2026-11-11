"""Project files (``*.felupe.json``): save and load command lists.

A project file is the command list as JSON with a stable layout, so that it is easy
to diff and review:

- keys in the order of the schema (``schema_version`` first, every command starts
  with ``command`` and ``name``), other keys sorted at the end,
- two spaces of indentation, a newline at the end,
- numbers written like JavaScript's ``JSON.stringify``.

The app (``app/src/core/project.ts``) writes byte-identical files; both are tested
with ``tests/data/two_sections.felupe.json``.
"""

import json
from decimal import Decimal

from .commands import SCHEMA_VERSION, schema, schema_errors

SUFFIX = ".felupe.json"


def _ramp_items(document):
    """Schema version 1 → 2: the ramp of a step has items with their own values
    (``boundary`` and ``also`` become items with the same ``start`` and ``end``)."""
    commands = []
    for cmd in document.get("commands", []):
        ramp = cmd.get("ramp") if isinstance(cmd, dict) else None
        if cmd.get("command") == "step.add" and isinstance(ramp, dict):
            values = {k: ramp[k] for k in ("start", "end") if k in ramp}
            also = ramp.get("also", [])
            targets = [ramp.get("boundary"), *(also if isinstance(also, list) else [])]
            ramp = {k: ramp[k] for k in ("num",) if k in ramp}
            ramp["items"] = [{"target": t, **values} for t in targets]
            cmd = {**cmd, "ramp": ramp}
        commands.append(cmd)
    return {**document, "schema_version": 2, "commands": commands}


def _cutback_settings(document):
    """Schema version 2 → 3: the cutback of a job has settings (#133), ``"cutback":
    true`` becomes ``"cutback": {}`` (the defaults of FElupe) and ``false`` is
    removed. The settings of the model (#132) are new."""
    commands = []
    for command in document["commands"]:
        if command.get("command") == "job.add" and "cutback" in command:
            command = dict(command)
            if command.pop("cutback") is True:
                command["cutback"] = {}
        commands.append(command)
    return {**document, "schema_version": 3, "commands": commands}


# migrations from a schema version to the next one: {version: function(document)}
MIGRATIONS = {1: _ramp_items, 2: _cutback_settings}


class ProjectError(ValueError):
    """A project file cannot be read. The messages are stored in ``errors``."""

    def __init__(self, errors):
        self.errors = list(errors)
        super().__init__("\n".join(self.errors))


def _resolve(node):
    while "$ref" in node:
        node = schema()["$defs"][node["$ref"].split("/")[-1]]
    return node


def _variant(node, value):
    """Return the variant of a ``oneOf`` that matches the value (or None)."""
    for option in node["oneOf"]:
        option = _resolve(option)
        if "oneOf" in option:
            nested = _variant(option, value)
            if nested is not None:
                return nested
            continue
        properties = option.get("properties", {})
        consts = {k: p["const"] for k, p in properties.items() if "const" in p}
        if not isinstance(value, dict):
            continue
        if all(value.get(k) == v for k, v in consts.items()) and all(
            k in value for k in option.get("required", [])
        ):
            return option
    return None


def _canonical(value, node):
    """Order the keys of the value like the properties of its schema node."""
    node = _resolve(node) if node is not None else None
    if node is not None and "oneOf" in node:
        node = _variant(node, value)
    if isinstance(value, dict):
        properties = (node or {}).get("properties", {})
        keys = [k for k in properties if k in value]
        keys += sorted(k for k in value if k not in properties)
        return {k: _canonical(value[k], properties.get(k)) for k in keys}
    if isinstance(value, list):
        items = (node or {}).get("items")
        return [_canonical(v, items) for v in value]
    return value


def js_number(x):
    """Format a number like JavaScript's ``JSON.stringify``."""
    if isinstance(x, bool):
        raise TypeError("Booleans are not numbers.")
    if isinstance(x, int):
        return str(x)
    if x != x or x in (float("inf"), float("-inf")):
        raise ValueError(f"{x} is not allowed in JSON.")
    if x == 0:
        return "0"

    sign, digits, exponent = Decimal(repr(x)).as_tuple()
    digits = list(digits)
    while len(digits) > 1 and digits[-1] == 0:
        digits.pop()
        exponent += 1
    k = len(digits)
    n = exponent + k  # x = 0.d1...dk * 10**n
    s = "".join(map(str, digits))

    if k <= n <= 21:
        text = s + "0" * (n - k)
    elif 0 < n <= 21:
        text = s[:n] + "." + s[n:]
    elif -6 < n <= 0:
        text = "0." + "0" * (-n) + s
    else:
        e = n - 1
        text = (s if k == 1 else s[0] + "." + s[1:]) + "e" + ("+" if e >= 0 else "-")
        text += str(abs(e))
    return ("-" if sign else "") + text


def _dump(value, level):
    pad = "  " * level
    if isinstance(value, dict):
        if not value:
            return "{}"
        items = [
            f"{pad}  {json.dumps(k, ensure_ascii=False)}: {_dump(v, level + 1)}"
            for k, v in value.items()
        ]
        return "{\n" + ",\n".join(items) + "\n" + pad + "}"
    if isinstance(value, list):
        if not value:
            return "[]"
        items = [f"{pad}  {_dump(v, level + 1)}" for v in value]
        return "[\n" + ",\n".join(items) + "\n" + pad + "]"
    if value is None or isinstance(value, bool):
        return json.dumps(value)
    if isinstance(value, int | float):
        return js_number(value)
    return json.dumps(value, ensure_ascii=False)


def dumps(document):
    """Return the text of a project file for a command list."""
    return _dump(_canonical(document, schema()), 0) + "\n"


def migrate(document):
    """Bring a command list to the current schema version."""
    version = document.get("schema_version")
    if not isinstance(version, int) or isinstance(version, bool):
        raise ProjectError(["The file has no valid schema_version."])
    if version > SCHEMA_VERSION:
        raise ProjectError(
            [
                f"The file has schema version {version}, but this version of "
                f"FElupe Studio supports {SCHEMA_VERSION}. Please update FElupe Studio."
            ]
        )
    while version < SCHEMA_VERSION:
        if version not in MIGRATIONS:
            raise ProjectError([f"No migration from schema version {version}."])
        document = MIGRATIONS[version](document)
        version = document["schema_version"]
    return document


def loads(text):
    """Read a project file and return the command list.

    The file is migrated to the current schema version and checked against the
    schema. References between commands are not checked here; see
    :func:`felupe_studio.commands.errors`.
    """
    try:
        document = json.loads(text)
    except json.JSONDecodeError as error:
        raise ProjectError([f"The file is not valid JSON: {error}"]) from error
    if not isinstance(document, dict):
        raise ProjectError(["The file does not contain a command list."])
    document = migrate(document)
    errors = schema_errors(document)
    if errors:
        raise ProjectError(errors)
    return document
