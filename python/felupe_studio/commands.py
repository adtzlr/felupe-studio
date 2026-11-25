"""Command schema and validation of command lists.

A command list is a JSON document ``{"schema_version": 2, "commands": [...]}``. Every
command creates one named object; other commands reference it by its name. The
validation first checks the JSON schema, then the expressions of the parameters and
then the rules of the commands (:mod:`.rules`), e.g. their references.
"""

import json
from functools import cache
from importlib.resources import files

from .directions import DIRECTIONS

SCHEMA_VERSION = 3

# kind of object created by each command
# commands of which a model has at most one
SINGLE = ("model.settings", "mesh.merge")

KINDS = {
    "mesh.import": "mesh",
    # a mesh made by a script (#182)
    "mesh.script": "mesh",
    # a mesh made by a tool of FElupe (ADR 0019)
    "mesh.generate": "mesh",
    "model.settings": "settings",
    "parameter.add": "parameter",
    "mesh.merge": "merge",
    "cellset.from_tag": "cellset",
    "cellset.from_file": "cellset",
    "material.add": "material",
    # a user-defined material of a Python file (ADR 0025), referenced by a section
    # like a material of the registry
    "material.script": "material",
    "section.add": "section",
    "pointset.add": "pointset",
    # a control point is a point set of one point (boundaries, constraints, curves)
    "point.add": "pointset",
    # a rigid surface (#219): its reference point is used like a point set of one
    # point by boundaries and loads
    "rigid.add": "rigid",
    "faceset.add": "faceset",
    "boundary.add": "boundary",
    # a load case is referenced like a boundary (ramps of steps, curves of jobs)
    "loadcase.add": "boundary",
    # symmetry planes (#186): boundaries of all steps, neither ramped nor a curve
    "symmetry.add": "symmetry",
    "mpc.add": "constraint",
    # a Cartesian constraint (#421): an item of the steps like a multi-point
    # constraint, also ramped by the steps and the curve of a job
    "cartesian.add": "constraint",
    # a cylindrical constraint (#422): like a Cartesian constraint, about an axis
    "cylindrical.add": "constraint",
    # a contact with a rigid surface (#220): an item of the steps like a constraint
    "contact.add": "constraint",
    "load.add": "load",
    "pressure.add": "pressure",
    "step.add": "step",
    "job.add": "job",
}

# the names of the kinds in the messages, if not the kind itself
KIND_NAMES = {"rigid": "rigid surface"}

AXES = ("x", "y", "z")

# the commands of the vertices of the control points: control points and the
# reference points of rigid surfaces (#219)
VERTICES = {"point.add": "control point", "rigid.add": "rigid surface"}

# kinds of objects that a step can ramp (a load case is a boundary)
RAMPED = ("boundary", "load", "pressure")

# the constraints that a step can ramp and that can be the curve of a job: those in
# local coordinates (#421, #422)
MOVED = tuple(DIRECTIONS)

# references of a command: field name (or a path of fields, joined by dots) -> (kind,
# is a list)
REFERENCES = {
    "mesh.script": {"parameters": ("parameter", True)},
    "material.script": {"parameters": ("parameter", True)},
    # the meshes that an operation of the mesh tools takes (ADR 0019)
    "mesh.generate": {"inputs": ("mesh", True)},
    "cellset.from_tag": {"mesh": ("mesh", False)},
    "cellset.from_file": {"mesh": ("mesh", False)},
    "section.add": {"cellset": ("cellset", False), "material": ("material", False)},
    "faceset.add": {"section": ("section", False)},
    # the points of the cells of a section (#241), a path in the command
    "pointset.add": {"select.section": ("section", False)},
    # the reference point of a rigid surface is moved by boundaries (#219)
    "boundary.add": {"pointset": (("pointset", "rigid"), False)},
    "mpc.add": {
        "points": ("pointset", False),
        "center": ("pointset", False),
        "rotation": ("pointset", False),
    },
    "cartesian.add": {"points": ("pointset", False)},
    "cylindrical.add": {"points": ("pointset", False)},
    "load.add": {"points": (("pointset", "rigid"), False)},
    "contact.add": {
        "points": (("pointset", "faceset"), False),
        "surface": ("rigid", False),
    },
    "pressure.add": {"faces": ("faceset", False)},
    "step.add": {
        "sections": ("section", True),
        "constraints": ("constraint", True),
        "loads": (("load", "pressure"), True),
        # the boundaries, load cases and symmetry planes of a step (#393)
        "boundaries": (("boundary", "symmetry"), True),
    },
    # the curve of a job: a boundary (force-displacement), a point load or a
    # Cartesian or cylindrical constraint (#421, #422, checked by a rule)
    "job.add": {
        "steps": ("step", True),
        "curve": (("boundary", "load", "constraint"), False),
    },
}


# the commands of the files next to a project (ADR 0007): of the mesh files, and of
# the Python scripts of meshes (#182) and of user-defined materials (ADR 0025)
FILES = ("mesh.import", "mesh.script", "material.script")

# the commands of the scripts, which run Python code of their own
SCRIPTS = ("mesh.script", "material.script")


def file_names(commands):
    """Return the names of the files next to a project that its commands use, once
    each and sorted: the mesh files and the scripts of meshes and materials.

    Examples
    --------
    >>> file_names([
    ...     {"command": "mesh.import", "name": "bar", "file": "bar.vtu"},
    ...     {"command": "material.script", "name": "soft", "file": "soft.py"},
    ...     {"command": "mesh.import", "name": "other", "file": "bar.vtu"},
    ... ])
    ['bar.vtu', 'soft.py']
    """
    return sorted({c["file"] for c in commands if c["command"] in FILES})


def script_names(commands):
    """Return the names of the scripts of a project, which run Python code of their
    own: of meshes (#182) and of user-defined materials (ADR 0025)."""
    return sorted({c["file"] for c in commands if c["command"] in SCRIPTS})


# the names of the kinds of references in the messages, if not the kinds themselves:
# the curve of a job is a constraint only of a Cartesian or cylindrical constraint
# (#421, #422)
REFERENCE_NAMES = {
    ("job.add", "curve"): "boundary, load, Cartesian or cylindrical constraint"
}


# the names of the numbers of a parameter in the messages (#180)
PARAMETER_FIELDS = {
    "value": "value",
    "min": "minimum",
    "max": "maximum",
    "step": "step",
}


def parameter_problems(parameter):
    """Return the problems of a parameter of the model (#180): its value within its
    range, and integers for an integer parameter.

    Examples
    --------
    >>> parameter_problems({"name": "layers", "value": 3, "integer": True, "max": 2})
    ['the value is larger than the maximum.']
    >>> parameter_problems({"name": "layers", "value": 2.5, "integer": True})
    ['the value of an integer parameter is an integer.']
    """
    problems = []
    if parameter.get("integer"):
        for key, label in PARAMETER_FIELDS.items():
            if key in parameter and parameter[key] != int(parameter[key]):
                problems.append(f"the {label} of an integer parameter is an integer.")
    low, high = parameter.get("min"), parameter.get("max")
    if low is not None and high is not None and low >= high:
        problems.append("the minimum is not smaller than the maximum.")
    if low is not None and parameter["value"] < low:
        problems.append("the value is smaller than the minimum.")
    if high is not None and parameter["value"] > high:
        problems.append("the value is larger than the maximum.")
    return problems


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


def value_at(command, path):
    """Return the value of a field of a command, or of a path of fields joined by dots
    (e.g. ``select.section``), or None.

    Examples
    --------
    >>> value_at({"select": {"section": "metal"}}, "select.section")
    'metal'
    >>> value_at({"select": {"axis": "x"}}, "select.section") is None
    True
    """
    value = command
    for key in path.split("."):
        if not isinstance(value, dict) or key not in value:
            return None
        value = value[key]
    return value


def references(command):
    """Return the names that a command references, as ``(field, name)`` pairs (the
    targets of the ramp of a step as ``ramp``), like ``references()`` of the app.

    Examples
    --------
    >>> references({"command": "pointset.add", "name": "inner",
    ...             "select": {"section": "metal"}})
    [('select.section', 'metal')]
    """
    result = []
    for field, (_, is_list) in REFERENCES.get(command["command"], {}).items():
        value = value_at(command, field)
        if value is None:
            continue
        result.extend((field, name) for name in (value if is_list else [value]))
    if command["command"] == "step.add":
        result.extend(("ramp", item["target"]) for item in command["ramp"]["items"])
    return result


def rename_references(command, old, new):
    """Return a copy of a command whose references to a name point to another one,
    like ``renameReferences()`` of the app."""
    copy = json.loads(json.dumps(command))
    for field, (_, is_list) in REFERENCES.get(command["command"], {}).items():
        *path, key = field.split(".")
        owner = value_at(copy, ".".join(path)) if path else copy
        if not isinstance(owner, dict) or key not in owner:
            continue
        if is_list:
            owner[key] = [new if name == old else name for name in owner[key]]
        elif owner[key] == old:
            owner[key] = new
    if command["command"] == "step.add":
        for item in copy["ramp"]["items"]:
            if item["target"] == old:
                item["target"] = new
    # a renamed parameter in the expressions (#242)
    from .expressions import rename_parameter

    return rename_parameter(copy, old, new)


def _number(value):
    """A coordinate as text like in the app (JavaScript), e.g. 0 or 12.5."""
    value = float(value)
    return str(int(value)) if value.is_integer() else repr(value)


def _names(kind, names):
    """Names in a sentence, e.g. ``step 'a'`` or ``steps 'a', 'b' and 'c'``.

    Examples
    --------
    >>> _names("step", ["a"]), _names("step", ["a", "b", "c"])
    ("step 'a'", "steps 'a', 'b' and 'c'")
    """
    quoted = [f"'{name}'" for name in names]
    if len(quoted) == 1:
        return f"{kind} {quoted[0]}"
    return f"{kind}s {', '.join(quoted[:-1])} and {quoted[-1]}"


def off_curves(commands):
    """Return notes about jobs whose curve is a boundary or a load case that is off in
    some of their steps (#393): its force is zero there."""
    steps = {c["name"]: c for c in commands if c["command"] == "step.add"}
    boundaries = {
        c["name"] for c in commands if c["command"] in ("boundary.add", "loadcase.add")
    }
    messages = []
    for i, cmd in enumerate(commands):
        curve = cmd.get("curve")
        if cmd["command"] != "job.add" or curve not in boundaries:
            continue
        off = [
            name
            for name in dict.fromkeys(cmd["steps"])
            if name in steps and curve not in steps[name].get("boundaries", [curve])
        ]
        if off:
            messages.append(
                f"commands/{i}: job '{cmd['name']}' records the curve of '{curve}', "
                f"which is off in {_names('step', off)}: its force is zero there."
            )
    return messages


def notes(commands):
    """Return notes about a command list that are not errors: the planes of symmetry
    objects that a load case or another symmetry object already has (#186), and the
    curves of jobs that are off in some of their steps (:func:`off_curves`). The same
    plane twice prescribes the same degrees of freedom twice, which does no harm.

    Examples
    --------
    >>> [note] = notes([
    ...     {"command": "loadcase.add", "name": "t", "type": "uniaxial"},
    ...     {"command": "symmetry.add", "name": "h", "axes": ["x"]},
    ... ])
    >>> note.removeprefix("commands/1: ")
    "the plane x = 0 of symmetry 'h' is already a symmetry plane of load case 't'."
    """
    from .expressions import resolve
    from .loadcases import symmetry_planes

    # with the values of the expressions of the parameters (#242)
    commands = resolve({"commands": commands})[0]["commands"]
    owners = {}  # (axis, coordinate) -> the first object with the plane
    for cmd in commands:
        if cmd["command"] == "loadcase.add":
            for axis in symmetry_planes(cmd):
                owners.setdefault((axis, 0.0), f"load case '{cmd['name']}'")
    messages = []
    for i, cmd in enumerate(commands):
        if cmd["command"] != "symmetry.add":
            continue
        for axis in AXES:
            if axis not in cmd["axes"]:
                continue
            coordinate = cmd.get(axis, 0)
            if isinstance(coordinate, str):
                continue  # an expression with a problem
            plane = (axis, float(coordinate))
            if plane in owners:
                messages.append(
                    f"commands/{i}: the plane {axis} = {_number(plane[1])} of "
                    f"symmetry '{cmd['name']}' is already a symmetry plane of "
                    f"{owners[plane]}."
                )
            else:
                owners[plane] = f"symmetry '{cmd['name']}'"
    return messages + off_curves(commands)


def errors(document, check_schema=True):
    """Return a list of error messages of a command list (empty if valid).

    With ``check_schema=False``, only the references between the commands are checked
    (without the package ``jsonschema``), for a command list that was validated
    against the same schema before, e.g. by the app with Ajv.
    """
    from .expressions import resolve
    from .rules import problems as rule_problems

    messages = schema_errors(document) if check_schema else []
    if messages:
        return messages
    # the expressions of the parameters (#242): their problems first, then the
    # rules on their values
    resolved, problems = resolve(document)
    if problems:
        return problems
    return rule_problems(resolved["commands"])


def validate(document, check_schema=True):
    """Raise a :class:`ValidationError` if the command list is not valid (see
    :func:`errors`)."""
    messages = errors(document, check_schema)
    if messages:
        raise ValidationError(messages)
    return document
