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

from .__about__ import __version__
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


def _options(node):
    """The variants of a ``oneOf``, with those of a nested ``oneOf``, e.g. the tools
    of ``mesh.generate`` among the commands."""
    for option in node.get("oneOf", []):
        option = _resolve(option)
        if "oneOf" in option:
            yield from _options(option)
        else:
            yield option


def _consts(option):
    properties = option.get("properties", {})
    return {k: p["const"] for k, p in properties.items() if "const" in p}


def _unknown_const(options, value):
    """The first key of the value that tells the variants apart (e.g. ``command``,
    ``tool`` or ``model``) and has a value that no variant has, as ``(key, value)``,
    else None. A missing key or a value that is no string is an error of the schema,
    not a new variant."""
    for key in dict.fromkeys(k for option in options for k in _consts(option)):
        known = {_consts(o)[key] for o in options if key in _consts(o)}
        loose = any(
            key in o.get("properties", {}) and key not in _consts(o) for o in options
        )
        if loose or not isinstance(value.get(key), str):
            continue
        if value[key] not in known:
            return key, value[key]
        options = [o for o in options if _consts(o).get(key, value[key]) == value[key]]
    return None


def _variant_of(value, node, path, found):
    """The variant of a ``oneOf`` for the value, or None if a part of the value is new
    or no variant fits."""
    options = list(_options(node))
    const = _unknown_const(options, value)
    if const:
        found.append(("value", [*path, const[0]], const[1]))
        return None
    fitting = [
        o for o in options if all(value.get(k, v) == v for k, v in _consts(o).items())
    ]
    if len(fitting) == 1:
        return fitting[0]
    # variants told apart by their keys, e.g. the select of a point set: a key of no
    # variant is new
    known = {k for option in fitting for k in option.get("properties", {})}
    new = [k for k in value if k not in known] if fitting else []
    found.extend(("property", [*path, k], None) for k in new)
    return None if new else _variant(node, value)


def _new_parts(value, node, path, found):
    """Collect the parts of a value that its schema node does not know: a value of a
    key that tells variants apart, a value of an enumeration or a property."""
    node = _resolve(node)
    if isinstance(value, list):
        for item in value:
            _new_parts(item, node.get("items", {}), path, found)
    elif isinstance(value, str):
        enum = node.get("enum", [])
        if enum and all(isinstance(e, str) for e in enum) and value not in enum:
            found.append(("value", path, value))
    elif isinstance(value, dict):
        if "oneOf" in node:
            node = _variant_of(value, node, path, found)
            if node is None:
                return
        properties = node.get("properties", {})
        if node.get("additionalProperties") is False:
            found.extend(
                ("property", [*path, k], None) for k in value if k not in properties
            )
        for key, child in properties.items():
            if key in value:
                _new_parts(value[key], child, [*path, key], found)


def _phrase(kind, path, value, command):
    where = ".".join(path)
    owner = f"`{command}`" if command else "the project"
    if kind == "property":
        return f"the property `{where}` of {owner}"
    if path == ["command"]:
        return f"`{value}`"
    if len(path) == 1:
        return f"the {where} `{value}` of {owner}"
    return f"the value `{value}` of `{where}` of {owner}"


def newer_features(document):
    """What a command list uses that this version of FElupe Studio does not know
    (#344): a command type, a tool of ``mesh.generate``, a material model, a value of
    an enumeration or a property. Such a project may have been saved with a newer
    version of the same schema version, since additive changes keep it.

    Returns the phrases of the message of :func:`newer_message`, without repeats.
    """
    root = schema()
    found = [
        _phrase("property", [key], None, None)
        for key in document
        if key not in root["properties"]
    ]
    commands = document.get("commands")
    for command in commands if isinstance(commands, list) else []:
        if isinstance(command, dict):
            parts = []
            _new_parts(command, root["$defs"]["Command"], [], parts)
            found += [_phrase(*part, command.get("command")) for part in parts]
    return list(dict.fromkeys(found))


def newer_message(features, version=__version__):
    """The message about the features of a newer version, or None without them."""
    if not features:
        return None
    listed = features[0]
    if len(features) > 1:
        listed = ", ".join(features[:-1]) + " and " + features[-1]
    return (
        f"This project uses {listed}, which FElupe Studio {version} does not know. "
        "It may have been saved with a newer version: please update FElupe Studio."
    )


def loads(text):
    """Read a project file and return the command list.

    The file is migrated to the current schema version and checked against the
    schema. References between commands are not checked here; see
    :func:`felupe_studio.commands.errors`. If the file uses what this version does
    not know, the first message says so (:func:`newer_features`).
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
        message = newer_message(newer_features(document))
        raise ProjectError([message, *errors] if message else errors)
    return document
