"""Write reference.md: the command reference, generated from the JSON schema (#33).

Run ``python docs/make_reference.py`` after changing the schema;
``tests/test_reference.py`` checks that the file is up to date. The script is not a
module of the package, which the app loads into the worker.
"""

import json
import re
from pathlib import Path

from felupe_studio.commands import RAMPED, REFERENCES, SCHEMA_VERSION, schema

# names of the kinds of objects that a reference points to
KIND_NAMES = {
    "mesh": "mesh",
    "cellset": "cell set",
    "material": "material",
    "section": "section",
    "pointset": "point set, control point",
    "faceset": "face set",
    # a load case is referenced like a boundary
    "boundary": "boundary, load case",
    "constraint": "multi-point constraint",
    "load": "point load",
    "pressure": "pressure",
    "step": "step",
}

# headings of the variants of the selection of a point set
SELECT = {
    "axis": "By a plane",
    "points": "By coordinates",
    "ids": "By ids",
    "centers": "By centers",
}


def _ref(node):
    return node.get("$ref", "").rsplit("/", 1)[-1]


def _resolve(node):
    defs = schema()["$defs"]
    while "$ref" in node:
        node = {**defs[_ref(node)], **{k: v for k, v in node.items() if k != "$ref"}}
    return node


def _code(value):
    return f"`{json.dumps(value)}`" if not isinstance(value, str) else f"`{value}`"


def _join(words):
    if len(words) == 1:
        return words[0]
    return " or ".join([", ".join(words[:-1]), words[-1]])


def _kinds(command, key, plural=False):
    """The names of the kinds that a reference field points to, if it is one."""
    if command == "step.add" and key == "ramp.items[].target":
        kinds = RAMPED
    elif (reference := REFERENCES.get(command, {}).get(key)) is None:
        return None
    else:
        kinds = reference[0]
    kinds = (kinds,) if isinstance(kinds, str) else kinds
    words = [w for k in kinds for w in KIND_NAMES[k].split(", ")]
    return _join([f"{w}s" for w in words] if plural else words)


def _bounds(node):
    parts = []
    for key, symbol in [
        ("minimum", "≥"),
        ("exclusiveMinimum", ">"),
        ("maximum", "≤"),
        ("exclusiveMaximum", "<"),
    ]:
        if key in node:
            parts.append(f"{symbol} {node[key]}")
    return [", ".join(parts)] if parts else []


def _type(node, command="", key=""):
    """A short text of the type of a property."""
    name = _ref(node)
    if name == "Name":
        kinds = _kinds(command, key)
        return f"name of a {kinds}" if kinds else "name"
    if name == "Axis":
        return "axis: `x`, `y` or `z`"
    if name == "Coordinates":
        return "three numbers `[x, y, z]`"
    node = _resolve(node)
    if "const" in node:
        return _code(node["const"])
    if "enum" in node:
        return _join([_code(v) for v in node["enum"]])
    kind = node.get("type")
    if kind == "array":
        items = node["items"]
        item = _type(items, command, key)
        if _ref(items) == "Name" and _kinds(command, key):
            item = f"names of {_kinds(command, key, plural=True)}"
        elif _resolve(items).get("type") == "object":
            item = "list of objects"
        else:
            item = f"list of {item}"
        extra = []
        if node.get("minItems"):
            extra.append(f"at least {node['minItems']}")
        if node.get("uniqueItems"):
            extra.append("unique")
        return item + (f" ({', '.join(extra)})" if extra else "")
    if kind in ("number", "integer"):
        return " ".join([kind, *_bounds(node)])
    if kind == "object":
        return "object"
    if "oneOf" in node:
        return "one of the variants below"
    return kind or ""


def _conditions(node):
    """Required properties that depend on another one (``if``/``then``)."""
    result = {}
    condition = node.get("if", {}).get("properties", {})
    required = node.get("then", {}).get("required", [])
    for key, value in condition.items():
        if "const" in value:
            for name in required:
                result[name] = f"if `{key}` is {_code(value['const'])}"
    return result


def _rows(node, command, prefix=""):
    """The rows of the table of the properties of an object, nested with dots."""
    node = _resolve(node)
    required = set(node.get("required", []))
    conditions = _conditions(node)
    rows = []
    for key, raw in node.get("properties", {}).items():
        if key == "command":
            continue
        path = f"{prefix}{key}"
        prop = _resolve(raw)
        if _ref(raw) == "Name":
            # not the general description of names
            text = raw.get("description", "")
            if key == "name" and not prefix:
                text = "Name of the object."
        else:
            text = raw.get("description") or prop.get("description", "")
        if "default" in raw or "default" in prop:
            text = _default(text, raw.get("default", prop.get("default")))
        need = "yes" if key in required else conditions.get(key, "")
        rows.append((f"`{path}`", _type(raw, command, path), need, text))
        if prop.get("type") == "object" and "properties" in prop:
            rows += _rows(prop, command, prefix=f"{path}.")
        items = prop.get("items")
        if items and _resolve(items).get("type") == "object":
            rows += _rows(items, command, prefix=f"{path}[].")
    return rows


def _default(text, value):
    """Append the default value to a description."""
    text = text.strip()
    if text and not text.endswith("."):
        text += "."
    return f"{text} Default {_code(value)}.".strip()


def _first_sentence(text):
    return re.split(r"\. (?=[A-Z])", text)[0].rstrip(".") + "."


def _table(rows, header=("Property", "Type", "Required", "Description")):
    lines = [
        "| " + " | ".join(header) + " |",
        "| " + " | ".join("---" for _ in header) + " |",
    ]
    for row in rows:
        cells = [str(c).replace("|", "\\|").replace("\n", " ") for c in row]
        lines.append("| " + " | ".join(cells) + " |")
    return "\n".join(lines)


def _variants(name, node, command):
    """The variants of a property or of a command (``oneOf``)."""
    out = []
    for variant in node["oneOf"]:
        title = variant.get("x-label") or _resolve(variant).get("x-label")
        resolved = _resolve(variant)
        consts = [
            f"`{k}: {json.dumps(v['const'])}`"
            for k, v in resolved.get("properties", {}).items()
            if "const" in v and k != "command"
        ]
        required = [
            f"`{k}`"
            for k in resolved.get("required", [])
            if k not in ("command", "name")
        ]
        keys = [k for k in resolved.get("required", []) if k in SELECT]
        label = title or (SELECT[keys[0]] if keys else ", ".join(required))
        head = f"#### {label}" + (f" ({', '.join(consts)})" if consts else "")
        out.append(head)
        description = resolved.get("description")
        if description:
            out.append(description)
        felupe = resolved.get("x-felupe")
        if isinstance(felupe, dict) and felupe:
            functions = [f"`{v}`" for v in felupe.values() if isinstance(v, str)]
            out.append("FElupe: " + ", ".join(functions))
        params = resolved.get("properties", {}).get("parameters")
        if params:
            rows = []
            for key, p in _resolve(params).get("properties", {}).items():
                need = "yes" if key in _resolve(params).get("required", []) else ""
                text = p.get("description", "")
                if "default" in p:
                    text = _default(text, p["default"])
                symbol = p.get("x-label", key)
                if p.get("type") == "array":
                    items = p["items"]
                    item = (
                        "numbers ≠ 0" if items.get("not") == {"const": 0} else "numbers"
                    )
                    kind = f"list of {p['minItems']} to {p['maxItems']} {item}"
                else:
                    kind = " ".join(["number", *_bounds(p)])
                rows.append((f"`{key}` ({symbol})", kind, need, text))
            out.append(_table(rows, ("Parameter", "Type", "Required", "Description")))
        else:
            rows = [
                r
                for r in _rows(resolved, command, prefix=f"{name}." if name else "")
                if not (name == "" and r[0] in ("`name`", "`type`", "`model`"))
            ]
            if rows:
                out.append(_table(rows))
    return out


def _blocks(blocks):
    """Join blocks of Markdown with one blank line between them."""
    return "\n\n".join(b for b in blocks if b) + "\n"


def markdown():
    """Return the command reference as Markdown text."""
    s = schema()
    defs = s["$defs"]
    names = defs["Name"]
    reserved = names["x-reserved"]
    commands = []
    for ref in defs["Command"]["oneOf"]:
        node = defs[_ref(ref)]
        variant = _resolve(node["oneOf"][0]) if "oneOf" in node else node
        commands.append((variant["properties"]["command"]["const"], node))
    out = [
        "# Command reference",
        "<!-- Generated from python/felupe_studio/commands.schema.json by\n"
        "     `python docs/make_reference.py`. Do not edit. -->",
        "Every command of a project creates one named object. The "
        "[user guide](guide.md) shows how the commands work together, "
        "[commands.md](commands.md) how they become a FElupe script.",
        "A project file is a JSON document "
        f'`{{"schema_version": {SCHEMA_VERSION}, "commands": [...]}}`. Every command '
        "has the key `command` and a unique `name`; other commands reference the "
        "object by its name. Older project files are migrated when they are opened.",
        "## Names",
        names.get("description", ""),
        f"A name matches `{names['pattern']}` and has at most "
        f"{names.get('maxLength', '')} characters. Reserved, because the script uses "
        "them: "
        + ", ".join(f"`{n}`" for n in reserved["names"])
        + "; names starting with "
        + ", ".join(f"`{p}`" for p in reserved["prefixes"])
        + "; and the keywords of Python.",
        "## Commands",
        "\n".join(
            f"- [`{command}`](#{command.replace('.', '')}): "
            + _first_sentence(node.get("description", ""))
            for command, node in commands
        ),
    ]
    for command, node in commands:
        out += [f"### `{command}`", node.get("description", "")]
        if "oneOf" in node:
            out.append("Every variant has a `name`, the name of the object.")
            out += _variants("", node, command)
            continue
        out.append(_table(_rows(node, command)))
        for key, raw in node.get("properties", {}).items():
            prop = _resolve(raw)
            if "oneOf" in prop:
                out.append(f"Variants of `{key}`:")
                out += _variants(key, prop, command)
    return _blocks(out)


if __name__ == "__main__":
    path = Path(__file__).parent / "reference.md"
    path.write_text(markdown(), encoding="utf-8")
