"""Command schema and validation of command lists.

A command list is a JSON document ``{"schema_version": 2, "commands": [...]}``. Every
command creates one named object; other commands reference it by its name. The
validation first checks the JSON schema and then the references between commands.
"""

import json
from functools import cache
from importlib.resources import files

SCHEMA_VERSION = 2

# kind of object created by each command
KINDS = {
    "mesh.import": "mesh",
    "mesh.merge": "merge",
    "cellset.from_tag": "cellset",
    "cellset.from_file": "cellset",
    "material.add": "material",
    "section.add": "section",
    "pointset.add": "pointset",
    # a control point is a point set of one point (boundaries, constraints, curves)
    "point.add": "pointset",
    "boundary.add": "boundary",
    # a load case is referenced like a boundary (ramps of steps, curves of jobs)
    "loadcase.add": "boundary",
    "mpc.add": "constraint",
    "step.add": "step",
    "job.add": "job",
}

AXES = ("x", "y", "z")

# kinds of objects that a step can ramp (a load case is a boundary)
RAMPED = ("boundary",)

# references of a command: field name -> (kind, is a list)
REFERENCES = {
    "cellset.from_tag": {"mesh": ("mesh", False)},
    "cellset.from_file": {"mesh": ("mesh", False)},
    "section.add": {"cellset": ("cellset", False), "material": ("material", False)},
    "boundary.add": {"pointset": ("pointset", False)},
    "mpc.add": {
        "points": ("pointset", False),
        "center": ("pointset", False),
        "rotation": ("pointset", False),
    },
    "step.add": {"sections": ("section", True), "constraints": ("constraint", True)},
    "job.add": {"steps": ("step", True), "curve": ("boundary", False)},
}


class ValidationError(ValueError):
    """A command list is not valid. The messages are stored in ``errors``."""

    def __init__(self, errors):
        self.errors = list(errors)
        super().__init__("\n".join(self.errors))


@cache
def schema():
    """Return the JSON schema of a command list as a dict."""
    source = files("felupe_studio").joinpath("commands.schema.json")
    return json.loads(source.read_text(encoding="utf-8"))


def reserved():
    """Return the reserved keywords, names and prefixes of names (from the schema)."""
    names = schema()["$defs"]["Name"]["x-reserved"]
    return set(names["keywords"]), set(names["names"]), tuple(names["prefixes"])


def schema_errors(document):
    """Return the messages of the JSON schema validation (empty if valid)."""
    from jsonschema import Draft202012Validator

    validator = Draft202012Validator(schema())
    errors = sorted(validator.iter_errors(document), key=lambda e: list(e.path))
    messages = []
    for error in errors:
        path = "/".join(str(p) for p in error.absolute_path)
        messages.append(f"{path or '(document)'}: {error.message}")
    return messages


def _reference_errors(commands):
    # the registries read the schema of this module
    from .loadcases import problems as loadcase_problems
    from .materials import needs_bulk

    keywords, reserved_names, reserved_prefixes = reserved()
    messages = []
    defined = {}  # name -> (index, command)

    for i, cmd in enumerate(commands):
        name = cmd["name"]

        # references must point to objects of the right kind, created before
        for field, (ref_kind, is_list) in REFERENCES.get(cmd["command"], {}).items():
            if field not in cmd:
                continue
            for ref in cmd[field] if is_list else [cmd[field]]:
                if ref not in defined:
                    messages.append(
                        f"commands/{i}: {cmd['command']} '{name}' references "
                        f"unknown {ref_kind} '{ref}' in '{field}'."
                    )
                elif KINDS[defined[ref][1]["command"]] != ref_kind:
                    other = KINDS[defined[ref][1]["command"]]
                    messages.append(
                        f"commands/{i}: '{ref}' in '{field}' of '{name}' is a "
                        f"{other}, not a {ref_kind}."
                    )

        # the ramped items of a step
        if cmd["command"] == "step.add" and "ramp" in cmd:
            targets = [item["target"] for item in cmd["ramp"]["items"]]
            for ref in targets:
                kind = KINDS[defined[ref][1]["command"]] if ref in defined else None
                if kind not in RAMPED:
                    messages.append(
                        f"commands/{i}: step '{name}' ramps unknown boundary '{ref}'."
                    )
            for ref in sorted({t for t in targets if targets.count(t) > 1}):
                messages.append(f"commands/{i}: step '{name}' ramps '{ref}' twice.")

        # cell sets from tags need a mesh imported with a tag
        if cmd["command"] == "cellset.from_tag" and cmd["mesh"] in defined:
            mesh = defined[cmd["mesh"]][1]
            if mesh["command"] == "mesh.import" and "tag" not in mesh:
                messages.append(
                    f"commands/{i}: cell set '{name}' uses tag values, but mesh "
                    f"'{mesh['name']}' was imported without a tag."
                )

        # a model with an optional bulk modulus has no volumetric part without it
        if cmd["command"] == "section.add" and cmd["formulation"] == "u":
            material = defined.get(cmd["material"], (None, {}))[1]
            if material.get("command") == "material.add" and needs_bulk(material):
                messages.append(
                    f"commands/{i}: section '{name}' uses the displacement "
                    f"formulation with {material['model']} '{material['name']}' "
                    "without a bulk modulus. Add 'bulk' to the material or use "
                    "'u-p-J'."
                )

        if cmd["command"] == "loadcase.add":
            messages.extend(f"commands/{i}: {p}" for p in loadcase_problems(cmd))

        # control points at the same coordinates are merged by the script
        if cmd["command"] == "point.add":
            same = next(
                (
                    c["name"]
                    for _, c in defined.values()
                    if c["command"] == "point.add"
                    and c["coordinates"] == cmd["coordinates"]
                ),
                None,
            )
            if same is not None:
                messages.append(
                    f"commands/{i}: control point '{name}' is at the coordinates of "
                    f"control point '{same}': the script merges them."
                )

        # a rotation point needs all components of the center point
        if (
            cmd["command"] == "mpc.add"
            and "rotation" in cmd
            and set(cmd["constrained"]) != {"x", "y", "z"}
        ):
            messages.append(
                f"commands/{i}: constraint '{name}' with a rotation point connects "
                "all components x, y and z."
            )

        if cmd["command"] == "mesh.merge" and any(
            c["command"] == "mesh.merge" for _, c in defined.values()
        ):
            messages.append(f"commands/{i}: only one mesh.merge is allowed.")

        if (
            name in keywords
            or name in reserved_names
            or name.startswith(reserved_prefixes)
        ):
            messages.append(
                f"commands/{i}: name '{name}' is reserved for the generated script."
            )

        if name in defined:
            messages.append(
                f"commands/{i}: name '{name}' is already used by "
                f"commands/{defined[name][0]}."
            )
        else:
            defined[name] = (i, cmd)

    # a control point has no stiffness of its own: its components need a boundary
    # or a constraint (as the center point, or all of them as the rotation point)
    for i, cmd in enumerate(commands):
        if cmd["command"] != "point.add":
            continue
        fixed = set()
        for other in commands:
            if other["command"] == "boundary.add" and other["pointset"] == cmd["name"]:
                fixed.update(other["constrained"])
            elif other["command"] == "mpc.add":
                if other["center"] == cmd["name"]:
                    fixed.update(other["constrained"])
                if other.get("rotation") == cmd["name"]:
                    fixed.update(AXES)
        missing = [a for a in AXES if a not in fixed]
        if missing:
            components = (
                ", ".join(missing[:-1]) + " and " + missing[-1]
                if len(missing) > 1
                else missing[0]
            )
            messages.append(
                f"commands/{i}: control point '{cmd['name']}' has no stiffness in "
                f"{components}: it needs a boundary or a multi-point constraint of "
                "these components."
            )

    return messages


def errors(document, check_schema=True):
    """Return a list of error messages of a command list (empty if valid).

    With ``check_schema=False``, only the references between the commands are checked
    (without the package ``jsonschema``), for a command list that was validated
    against the same schema before, e.g. by the app with Ajv.
    """
    messages = schema_errors(document) if check_schema else []
    if messages:
        return messages
    return _reference_errors(document["commands"])


def validate(document, check_schema=True):
    """Raise a :class:`ValidationError` if the command list is not valid (see
    :func:`errors`)."""
    messages = errors(document, check_schema)
    if messages:
        raise ValidationError(messages)
    return document
