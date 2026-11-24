"""Write reference.md: the command reference, generated from the JSON schema (#33).

Run ``python docs/make_reference.py`` after changing the schema;
``tests/test_reference.py`` checks that the file is up to date. The script is not a
module of the package, which the app loads into the worker.
"""

import json
import re
from collections import Counter
from pathlib import Path

from felupe_studio.commands import RAMPED, REFERENCES, SCHEMA_VERSION, schema

# names of the kinds of objects that a reference points to
KIND_NAMES = {
    "parameter": "parameter",
    "mesh": "mesh",
    "cellset": "cell set",
    "material": "material",
    "section": "section",
    "pointset": "point set, control point",
    "rigid": "rigid surface",
    "faceset": "face set",
    # a load case is referenced like a boundary
    "boundary": "boundary, load case",
    "symmetry": "symmetry plane",
    "constraint": "multi-point constraint, contact",
    "load": "point load",
    "pressure": "pressure",
    "step": "step",
}

# headings of the variants of the selection of a point set
SELECT = {
    "axis": "By a plane",
    "bound": "At a bound",
    "radius": "On a cylinder",
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


def _plural(word):
    """The plural of the name of a kind, e.g. ``boundaries``."""
    return word[:-1] + "ies" if word.endswith("ry") else word + "s"


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
    return _join([_plural(w) for w in words] if plural else words)


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


def _types(node, kind, command, key):
    """A short text of a property of several types."""
    # a number or an expression of the parameters (#242, ADR 0013)
    if "string" in kind and ("number" in kind or "integer" in kind):
        kind = [k for k in kind if k != "string"]
        text = _type({**node, "type": kind if len(kind) > 1 else kind[0]}, command, key)
        return f"{text} (or an expression)"
    # a value of more than one type, e.g. a number or one per component (#225)
    return _join([_type({**node, "type": k}, command, key) for k in kind])


def _array(node, command, key):
    """A short text of an array: its items and its length."""
    items = node["items"]
    item = _type(items, command, key)
    if _ref(items) == "Name" and _kinds(command, key):
        item = f"names of {_kinds(command, key, plural=True)}"
    elif _resolve(items).get("type") == "object":
        item = "list of objects"
    elif _resolve(items).get("type") in ("number", ["number", "string"]):
        item = "numbers"
    elif _resolve(items).get("type") in ("integer", ["integer", "string"]):
        # e.g. the points per axis of a mesh tool (ADR 0019)
        minimum = _resolve(items).get("minimum")
        item = "integers" + (f" ≥ {minimum}" if minimum is not None else "")
    else:
        item = f"list of {item}"
    extra = []
    low, high = node.get("minItems"), node.get("maxItems")
    if low and high:
        count = low if low == high else f"{low} to {high}"
        item = f"list of {count} {item}"
    elif low:
        extra.append(f"at least {low}")
    if node.get("uniqueItems"):
        extra.append("unique")
    return item + (f" ({', '.join(extra)})" if extra else "")


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
    if isinstance(kind, list):
        return _types(node, kind, command, key)
    if kind == "array":
        return _array(node, command, key)
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
    # the number of variants of a menu of the ribbon (x-group)
    groups = Counter(_resolve(v).get("x-group") for v in node["oneOf"])
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
        felupe = resolved.get("x-felupe")
        group = resolved.get("x-group")
        if isinstance(felupe, dict) and "body" in felupe and groups[group] > 1:
            # a formulation in a menu of the ribbon, e.g. Nearly incompressible ▸
            # Automatic (#420)
            label = f"{group} ▸ {label}"
        head = f"#### {label}" + (f" ({', '.join(consts)})" if consts else "")
        out.append(head)
        description = resolved.get("description")
        if description:
            out.append(description)
        if isinstance(felupe, dict) and "strain" in felupe:
            # a strain-based material (#191): fem.MaterialStrain of a function
            statevars = felupe.get("statevars")
            out.append(
                f"FElupe: `fem.MaterialStrain` of `{felupe['strain']}`"
                + (f", state variables `{statevars}`" if statevars else "")
            )
        elif isinstance(felupe, dict) and "body" in felupe:
            # a formulation of a section (ADR 0024), and when to use it (#420)
            out.append(_formulation(felupe, resolved.get("x-hint")))
        elif isinstance(felupe, dict) and felupe:
            functions = [f"`{v}`" for v in felupe.values() if isinstance(v, str)]
            out.append("FElupe: " + ", ".join(functions))
        framework = resolved.get("properties", {}).get("framework")
        if framework:
            choices = ", ".join(f"`{v}`" for v in framework["enum"])
            out.append(
                f"Framework (`framework`): {choices}, default `{framework['default']}`."
            )
        exponent = resolved.get("properties", {}).get("strain_exponent")
        if exponent:
            out.append(
                f"Strain exponent (`strain_exponent`): {exponent['description']}"
            )
        inputs = resolved.get("properties", {}).get("inputs")
        if inputs:
            # the meshes of an operation of the mesh tools (ADR 0019)
            count = inputs.get("maxItems")
            noun = "one mesh" if count == 1 else f"{count} meshes"
            if count is None:
                # a list of any length, e.g. the meshes of a stack (#394)
                noun = f"{inputs['minItems']} or more meshes, each once"
            out.append(f"Inputs (`inputs`): {noun}. {inputs['description']}")
        params = resolved.get("properties", {}).get("parameters")
        if params:
            rows = _parameter_rows(params, command)
            out.append(_table(rows, ("Parameter", "Type", "Required", "Description")))
            if "mullins" in resolved.get("properties", {}):
                # an option of the hyperelastic materials (#346)
                out.append(
                    "Optional: the Mullins effect (`mullins`), see [The Mullins "
                    "effect](#the-mullins-effect)."
                )
        else:
            rows = [
                r
                for r in _rows(resolved, command, prefix=f"{name}." if name else "")
                if not (
                    name == ""
                    and r[0] in ("`name`", "`type`", "`model`", "`formulation`")
                )
            ]
            if rows:
                out.append(_table(rows))
    return out


# what the material of a formulation has (x-felupe: material, ADR 0024)
MATERIALS = {
    "volumetric": "has a volumetric part of its own",
    "isochoric": "is the isochoric part of a strain energy: the section adds the "
    "volumetric part",
    "none": "has no volumetric part, and the section adds none",
}


def _formulation(felupe, hint=None):
    """The solid body, the fields, the cells and the material of a formulation, and
    when to use it."""
    cells = felupe["cells"]
    cells = (
        "all cell types"
        if cells == "all"
        else "the cell types " + _join([f"`{c}`" for c in cells])
    )
    text = (
        f"FElupe: the solid body `{felupe['body']}` of the fields "
        f"`{felupe['fields']}`, {cells}. The material "
        f"{MATERIALS[felupe['material']]}."
    )
    return f"{text} When to use it: {hint[0].lower()}{hint[1:]}." if hint else text


def _parameter_rows(params, command):
    """The rows of the parameters of a material model, or of the Mullins effect."""
    rows = []
    node = _resolve(params)
    for key, p in node.get("properties", {}).items():
        need = "yes" if key in node.get("required", []) else ""
        text = p.get("description", "")
        if "default" in p:
            text = _default(text, p["default"])
        symbol = p.get("x-label", key)
        if p.get("type") == "array":
            kind = _array(p, command, key)
            if p["items"].get("not") == {"const": 0}:
                kind = kind.replace("numbers", "numbers ≠ 0")
        elif "$ref" in p:
            # e.g. the axis of an operation of the mesh tools (ADR 0019)
            kind = _type(p, command, key)
        else:
            integer = "integer" in p.get("type", [])
            kind = " ".join(["integer" if integer else "number", *_bounds(p)])
        rows.append((f"`{key}` ({symbol})", kind, need, text))
    return rows


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
        "## Expressions",
        "A number of a command (*or an expression* below) may be an expression of "
        'the parameters as a string, e.g. `"end": "0.25 * layers * height"` (#242, '
        "[ADR 0013](adr/0013-expressions-of-parameters.md)): numbers, the names of "
        "the parameters, `pi`, `+ - * / **`, parentheses and the functions `sqrt`, "
        "`exp`, `log`, `sin`, `cos`, `tan`, `abs`, `min` and `max`. It is evaluated "
        "with the values of the parameters, the script shows it as written. A "
        "parameter whose value is an expression is a derived parameter ([ADR "
        "0021](adr/0021-derived-parameters.md)). The range and the step of "
        "`parameter.add`, the numbers that name things (a tag, ids) and the "
        "decimals of `mesh.merge` are numbers. See [Expressions of "
        "parameters](commands.md#expressions-of-parameters).",
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
            if command == "material.add":
                # the option of the hyperelastic materials (#346)
                mullins = defs["Mullins"]
                rows = _parameter_rows(mullins, command)
                header = ("Parameter", "Type", "Required", "Description")
                out += ["#### The Mullins effect", mullins["description"]]
                out.append(_table(rows, header))
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
