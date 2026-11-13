"""Command schema and validation of command lists.

A command list is a JSON document ``{"schema_version": 2, "commands": [...]}``. Every
command creates one named object; other commands reference it by its name. The
validation first checks the JSON schema and then the references between commands.
"""

import json
from functools import cache
from importlib.resources import files

SCHEMA_VERSION = 3

# kind of object created by each command
# commands of which a model has at most one
SINGLE = ("model.settings", "mesh.merge")

KINDS = {
    "mesh.import": "mesh",
    # a mesh made by a script (#182)
    "mesh.script": "mesh",
    "model.settings": "settings",
    "parameter.add": "parameter",
    "mesh.merge": "merge",
    "cellset.from_tag": "cellset",
    "cellset.from_file": "cellset",
    "material.add": "material",
    "section.add": "section",
    "pointset.add": "pointset",
    # a control point is a point set of one point (boundaries, constraints, curves)
    "point.add": "pointset",
    "faceset.add": "faceset",
    "boundary.add": "boundary",
    # a load case is referenced like a boundary (ramps of steps, curves of jobs)
    "loadcase.add": "boundary",
    # symmetry planes (#186): boundaries of all steps, neither ramped nor a curve
    "symmetry.add": "symmetry",
    "mpc.add": "constraint",
    "load.add": "load",
    "pressure.add": "pressure",
    "step.add": "step",
    "job.add": "job",
}

AXES = ("x", "y", "z")

# kinds of objects that a step can ramp (a load case is a boundary)
RAMPED = ("boundary", "load", "pressure")

# references of a command: field name -> (kind, is a list)
REFERENCES = {
    "mesh.script": {"parameters": ("parameter", True)},
    "cellset.from_tag": {"mesh": ("mesh", False)},
    "cellset.from_file": {"mesh": ("mesh", False)},
    "section.add": {"cellset": ("cellset", False), "material": ("material", False)},
    "faceset.add": {"section": ("section", False)},
    "boundary.add": {"pointset": ("pointset", False)},
    "mpc.add": {
        "points": ("pointset", False),
        "center": ("pointset", False),
        "rotation": ("pointset", False),
    },
    "load.add": {"points": ("pointset", False)},
    "pressure.add": {"faces": ("faceset", False)},
    "step.add": {
        "sections": ("section", True),
        "constraints": ("constraint", True),
        "loads": (("load", "pressure"), True),
    },
    # the curve of a job: a boundary (force-displacement) or a point load
    "job.add": {"steps": ("step", True), "curve": (("boundary", "load"), False)},
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


# the cell types of the solid cells of 3D models; 2D models have 2D cells (#175)
CELLS_3D = ("tetra", "tetra10", "hexahedron", "hexahedron20", "hexahedron27")

# the objects that 2D models do not have yet (#175)
NOT_IN_2D = {
    "mpc.add": "Multi-point constraints",
    "point.add": "Control points",
}


def analysis_problems(cmd, analysis):
    """Return the problems of a command in a model of a type of analysis (#175): a
    2D model (plane strain or axisymmetric) has 2D cells and no z components, and
    not yet all objects of a 3D model.

    Examples
    --------
    >>> analysis_problems(
    ...     {"command": "boundary.add", "name": "fixed", "constrained": ["x", "z"]},
    ...     "axisymmetric",
    ... )
    ["boundary 'fixed' constrains z, which a 2D model does not have."]
    """
    kind, name = cmd["command"], cmd["name"]
    cell_type = cmd.get("cell_type") if kind in ("mesh.import", "mesh.script") else None
    if analysis == "3d":
        if cell_type and cell_type not in CELLS_3D:
            return [
                f"mesh '{name}' takes {cell_type} cells, which are 2D cells: set the "
                "analysis of the settings to plane strain or axisymmetric."
            ]
        return []
    if cell_type in CELLS_3D:
        return [f"mesh '{name}' takes {cell_type} cells, but a 2D model has 2D cells."]
    if kind in NOT_IN_2D:
        return [
            f"{NOT_IN_2D[kind]} are not available in 2D models yet: remove "
            f"'{name}' or make the model 3D."
        ]
    if kind == "boundary.add" and "z" in cmd["constrained"]:
        return [f"boundary '{name}' constrains z, which a 2D model does not have."]
    if kind == "load.add" and cmd["force"][2] != 0:
        return [
            f"point load '{name}' has a force in z, which a 2D model does not have."
        ]
    if kind == "symmetry.add" and "z" in cmd["axes"]:
        return [
            f"symmetry '{name}' has a plane normal to z, which a 2D model does not "
            "have."
        ]
    if kind == "loadcase.add":
        keys = [k for k in ("axis", "second", "normal") if cmd.get(k) == "z"]
        if keys:
            return [
                f"load case '{name}' has the axis z in '{keys[0]}', which a 2D model "
                "does not have."
            ]
    if kind == "faceset.add":
        select = cmd["select"]
        if select.get("axis") == "z":
            return [f"face set '{name}' selects by z, which a 2D model does not have."]
        if any(c[2] != 0 for c in select.get("centers", [])):
            return [
                f"face set '{name}' has centers with a z coordinate: the edges of a "
                "2D model are in the plane z = 0."
            ]
    if kind == "pointset.add":
        select = cmd["select"]
        if ("value" in select or "bound" in select) and select["axis"] == "z":
            return [f"point set '{name}' selects by z, which a 2D model does not have."]
        if "radius" in select and select["axis"] != "z":
            return [
                f"point set '{name}' selects by a radius about {select['axis']}: in a "
                "2D model, a radius is about z (a circle in the xy-plane)."
            ]
        if "points" in select and any(p[2] != 0 for p in select["points"]):
            return [
                f"point set '{name}' has points with a z coordinate: the points of a "
                "2D model are in the plane z = 0."
            ]
    return []


def _reference_errors(commands):
    # the registries read the schema of this module
    from .loadcases import problems as loadcase_problems
    from .materials import needs_bulk
    from .materials import problems as material_problems

    keywords, reserved_names, reserved_prefixes = reserved()
    messages = []
    defined = {}  # name -> (index, command)
    # the type of the analysis of the settings (#175)
    settings = [c for c in commands if c["command"] == "model.settings"]
    analysis = settings[0].get("analysis", "3d") if settings else "3d"

    for i, cmd in enumerate(commands):
        name = cmd["name"]
        messages.extend(f"commands/{i}: {p}" for p in analysis_problems(cmd, analysis))

        # references must point to objects of the right kind, created before
        for field, (ref_kinds, is_list) in REFERENCES.get(cmd["command"], {}).items():
            if field not in cmd:
                continue
            if isinstance(ref_kinds, str):
                ref_kinds = (ref_kinds,)
            ref_kind = " or ".join(ref_kinds)
            for ref in cmd[field] if is_list else [cmd[field]]:
                if ref not in defined:
                    messages.append(
                        f"commands/{i}: {cmd['command']} '{name}' references "
                        f"unknown {ref_kind} '{ref}' in '{field}'."
                    )
                elif KINDS[defined[ref][1]["command"]] not in ref_kinds:
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
                        f"commands/{i}: step '{name}' ramps unknown boundary or "
                        f"load '{ref}'."
                    )
            for ref in sorted({t for t in targets if targets.count(t) > 1}):
                messages.append(f"commands/{i}: step '{name}' ramps '{ref}' twice.")

        # cell sets from tags need a mesh imported with a tag
        if cmd["command"] == "cellset.from_tag" and cmd["mesh"] in defined:
            mesh = defined[cmd["mesh"]][1]
            if mesh["command"] in ("mesh.import", "mesh.script") and "tag" not in mesh:
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

        if cmd["command"] == "material.add":
            for problem in material_problems(cmd):
                messages.append(f"commands/{i}: material '{name}': {problem}")

        if cmd["command"] == "parameter.add":
            for problem in parameter_problems(cmd):
                messages.append(f"commands/{i}: parameter '{name}': {problem}")

        if cmd["command"] in SINGLE and any(
            c["command"] == cmd["command"] for _, c in defined.values()
        ):
            messages.append(f"commands/{i}: only one {cmd['command']} is allowed.")

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


def _number(value):
    """A coordinate as text like in the app (JavaScript), e.g. 0 or 12.5."""
    value = float(value)
    return str(int(value)) if value.is_integer() else repr(value)


def notes(commands):
    """Return notes about a command list that are not errors: the planes of symmetry
    objects that a load case or another symmetry object already has (#186). The same
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
    from .loadcases import symmetry_planes

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
            plane = (axis, float(cmd.get(axis, 0)))
            if plane in owners:
                messages.append(
                    f"commands/{i}: the plane {axis} = {_number(plane[1])} of "
                    f"symmetry '{cmd['name']}' is already a symmetry plane of "
                    f"{owners[plane]}."
                )
            else:
                owners[plane] = f"symmetry '{cmd['name']}'"
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
