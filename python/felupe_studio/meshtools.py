"""The mesh tools (ADR 0019, #193): meshes made with the tools of FElupe.

A ``mesh.generate`` command makes one mesh with a tool of the registry in the
command schema (the definitions of ``MeshGenerate``): its FElupe call
(``x-felupe``), the dimensions of its points and cells and its cell type
(``x-dimension``) and its parameters. Its inputs are meshes of the model before:
made by tools, of files or of scripts (#438). :func:`dimensions` knows them before
Python runs, like ``dimensions()`` of ``app/src/core/meshtools.ts``; the cell type of
a mesh of a file or a script is unknown before its read, unless it is given. A mesh
whose points and cells have the dimension of the model is a model mesh with cell
sets; a lower one is a construction mesh. :func:`call` is the line of a tool in the
script, and :func:`generate` makes the meshes with these lines, like the script.
"""

from functools import cache

from .analysis import analysis_of
from .commands import schema
from .formatting import List, vector
from .project import js_number

__all__ = [
    "call",
    "dimensions",
    "generate",
    "input_problems",
    "measured",
    "model_mesh",
    "problems",
    "tools",
]

AXES = ("x", "y", "z")

# the dimension of the cells of a cell type: of the tools, and of the solid cells of
# files and scripts (#438)
CELLS = {
    "vertex": 0,
    "line": 1,
    **dict.fromkeys(["quad", "quad8", "quad9", "triangle", "triangle6"], 2),
    **dict.fromkeys(["hexahedron", "hexahedron20", "hexahedron27"], 3),
    **dict.fromkeys(["tetra", "tetra10"], 3),
}

# the mesh objects of files and scripts, inputs of the tools like made meshes (#438)
SOURCES = ("mesh.import", "mesh.script")


@cache
def tools():
    """The definitions of the mesh tools by their names, from the schema.

    Examples
    --------
    >>> list(tools())[:7]
    ['Point', 'Line', 'Rectangle', 'Cube', 'Circle', 'Triangle', 'expand']
    >>> tools()["Rectangle"]["x-dimension"]
    {'points': 2, 'cells': 2, 'cell_type': 'quad'}
    """
    defs = schema()["$defs"]
    result = {}
    for branch in defs["MeshGenerate"]["oneOf"]:
        definition = defs[branch["$ref"].split("/")[-1]]
        result[definition["properties"]["tool"]["const"]] = definition
    return result


def output(rule, dimension):
    """The dimensions of the mesh of an operation (``x-dimension`` of its tool) from
    those of its input, or None if the input does not fit. An input of an unknown
    cell type (of a file before its read, #438) is taken as the cell type of its
    dimension that the operation takes, if there is one; the app checks it with the
    read."""
    cell_type = dimension["cell_type"]
    types = rule["cell_type"]
    if cell_type is None and types != "same":
        fitting = [t for t in types if CELLS[t] == dimension["cells"]]
        cell_type = fitting[0] if len(fitting) == 1 else None
    if types != "same" and cell_type not in types:
        return None
    new = cell_type if types == "same" else types[cell_type]
    added = rule["points"]
    added = added if isinstance(added, int) else added[cell_type]
    return {
        "points": dimension["points"] + added,
        "cells": dimension["cells"] if new is None else CELLS[new],
        "cell_type": new,
    }


def source_dimension(command, dim):
    """The dimensions of a mesh of a file or of a script (#438), from its command: the
    points and the cells of the model of dimension ``dim``, which it reads, or of the
    dimension of its cell type. The cell type is unknown (None) before the read,
    unless it is given.

    Examples
    --------
    >>> mesh = {"command": "mesh.import", "name": "half", "file": "half.vtu"}
    >>> source_dimension(mesh, 3)
    {'points': 3, 'cells': 3, 'cell_type': None}
    """
    cell_type = command.get("cell_type")
    cells = CELLS.get(cell_type, dim)
    return {"points": cells, "cells": cells, "cell_type": cell_type}


def same(inputs):
    """The dimensions of the inputs of an operation, if they have the same points and
    cells and the same cell type where it is known (with the known one), else
    None."""
    first = inputs[0]
    types = {d["cell_type"] for d in inputs} - {None}
    sizes = {(d["points"], d["cells"]) for d in inputs}
    if len(types) > 1 or len(sizes) > 1:
        return None
    return {**first, "cell_type": next(iter(types), None)}


def measured(meshes):
    """The dimensions of meshes (``fem.Mesh``) by their names, e.g. of the meshes of
    files and scripts that the tools take (#438)."""
    return {
        name: {
            "points": mesh.dim,
            "cells": CELLS.get(mesh.cell_type, mesh.dim),
            "cell_type": mesh.cell_type,
        }
        for name, mesh in meshes.items()
    }


def cells_of(dimension):
    """The cells of a mesh in a message: its cell type, or the dimension of its cells
    if the cell type is unknown before the read (#438)."""
    return dimension["cell_type"] or f"{dimension['cells']}D"


def dimensions(commands, known=None):
    """Return the dimensions of the points and of the cells and the cell type of every
    mesh of the model, by its name, from the commands alone: of a mesh of a file or a
    script from the model (:func:`source_dimension`, #438) unless it is ``known``
    (e.g. of its read, see :func:`measured`), of a primitive from its tool, of an
    operation from its input (none if it does not fit).

    Examples
    --------
    >>> line = {"command": "mesh.generate", "name": "bottom", "tool": "Line",
    ...         "parameters": {"a": 0, "b": 1, "n": 5}}
    >>> face = {"command": "mesh.generate", "name": "face", "tool": "expand",
    ...         "inputs": ["bottom"], "parameters": {"n": 3, "z": 1}}
    >>> dimensions([line, face])["face"]
    {'points': 2, 'cells': 2, 'cell_type': 'quad'}
    """
    dim = 3 if analysis_of(commands) == "3d" else 2
    result = dict(known or {})
    for c in commands:
        if c["command"] in SOURCES:
            result.setdefault(c["name"], source_dimension(c, dim))
            continue
        if c["command"] != "mesh.generate" or c.get("tool") not in tools():
            continue
        rule = tools()[c["tool"]]["x-dimension"]
        if "inputs" not in rule:
            result[c["name"]] = dict(rule)
            continue
        inputs = [result.get(name) for name in c.get("inputs", [])]
        # inputs of the same cells and points, and an output of up to 3D points
        # with at least the dimension of its cells
        if not inputs or not all(inputs) or (input := same(inputs)) is None:
            continue
        made = output(rule, input)
        if made is not None and made["cells"] <= made["points"] <= 3:
            result[c["name"]] = made
    return result


def model_mesh(dimension, dim):
    """Whether a mesh of these dimensions is a mesh of a model of dimension ``dim``:
    its points and its cells have the dimension of the model."""
    return dimension["points"] == dim and dimension["cells"] == dim


def problems(command):
    """Return what is wrong with the values of a tool beyond the schema: the corner
    ``b`` (the end of a line) is larger than ``a`` in every axis, the corners of a
    triangle go around counterclockwise, and the quarters of a circle do not overlap.

    Examples
    --------
    >>> problems({"tool": "Rectangle", "parameters": {"a": [0, 2], "b": [1, 1]}})
    ['b must be larger than a in y.']
    >>> problems({"tool": "Line", "parameters": {"a": 1, "b": 1}})
    ['b must be larger than a.']
    >>> problems({"tool": "Circle", "parameters": {"sections": [0, 45]}})
    ['sections 0 and 45 overlap: the quarters need 90 degrees between them.']
    """
    if command["tool"] == "Triangle":
        return _triangle_problems(command["parameters"])
    if command["tool"] == "Circle":
        return _circle_problems(command["parameters"])
    return _corner_problems(command["parameters"])


def _triangle_problems(parameters):
    """The corners of a triangle go around counterclockwise, else its cells are
    inverted, and they do not lie on a line."""
    corners = [parameters.get(key) for key in "abc"]
    if not all(isinstance(p, list) and len(p) == 2 for p in corners):
        return []
    (ax, ay), (bx, by), (cx, cy) = ([float(x) for x in p] for p in corners)
    area = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax)
    size = max((bx - ax) ** 2 + (by - ay) ** 2, (cx - ax) ** 2 + (cy - ay) ** 2)
    if abs(area) <= 1e-12 * size:
        return ["a, b and c lie on a line."]
    if area < 0:
        return ["a, b and c go around clockwise; swap b and c."]
    return []


def _circle_problems(parameters):
    """The quarters of a circle start at least 90 degrees apart, else they overlap."""
    if not isinstance(parameters.get("sections"), list):
        return []
    sections = [float(s) for s in parameters["sections"]]
    for i, first in enumerate(sections):
        for second in sections[i + 1 :]:
            gap = abs(second - first) % 360
            if min(gap, 360 - gap) < 90 - 1e-9:
                pair = f"{js_number(first)} and {js_number(second)}"
                return [
                    f"sections {pair} overlap: the quarters need 90 degrees between "
                    "them."
                ]
    return []


def _corner_problems(parameters):
    """The corner ``b`` (the end of a line) is larger than ``a`` in every axis."""
    if "a" not in parameters or "b" not in parameters:
        return []
    a, b = parameters["a"], parameters["b"]
    if not isinstance(a, list):
        return [] if float(b) > float(a) else ["b must be larger than a."]
    axes = [AXES[i] for i, (x, y) in enumerate(zip(a, b, strict=True)) if y <= x]
    if not axes:
        return []
    names = axes[0] if len(axes) == 1 else ", ".join(axes[:-1]) + " and " + axes[-1]
    return [f"b must be larger than a in {names}."]


def input_problems(command, known):
    """Return why the inputs of an operation do not fit it, with the dimensions of the
    meshes made before (``known``, see :func:`dimensions`).

    Examples
    --------
    >>> block = {"points": 3, "cells": 3, "cell_type": "hexahedron"}
    >>> input_problems({"tool": "expand", "inputs": ["block"]}, {"block": block})
    ["expand needs a mesh of vertex, line or quad cells; 'block' has hexahedron cells."]
    """
    rule = tools()[command["tool"]]["x-dimension"]
    if "inputs" not in rule:
        return []
    label = command["tool"]
    problems = _same_inputs(command, known)
    for name in command.get("inputs", []):
        dimension = known.get(name)
        if dimension is None:
            continue
        made = output(rule, dimension)
        if made is None:
            types = list(rule["cell_type"])
            names = ", ".join(types[:-1]) + " or " + types[-1]
            problems.append(
                f"{label} needs a mesh of {names} cells; '{name}' has "
                f"{cells_of(dimension)} cells."
            )
        elif made["points"] > 3:
            problems.append(
                f"{label} of '{name}' would need {made['points']}D points; its "
                f"points are {dimension['points']}D."
            )
        elif made["points"] < made["cells"]:
            problems.append(
                f"{label} of '{name}' needs {made['cells']}D points; its points are "
                f"{dimension['points']}D: embed it first."
            )
        else:
            problems.extend(_axis_problems(command, name, dimension, made))
    return problems


def _same_inputs(command, known):
    """The inputs of an operation of several meshes have the same cell type (where it
    is known, #438) and the same dimension of their points."""
    inputs = [
        (name, known[name]) for name in command.get("inputs", []) if name in known
    ]
    if len(inputs) < 2 or same([d for _, d in inputs]) is not None:
        return []
    meshes = ", ".join(
        f"'{name}' {cells_of(d)} cells with {d['points']}D points" for name, d in inputs
    )
    return [f"{command['tool']} needs meshes of the same cells and points: {meshes}."]


def _axis_problems(command, name, dimension, made):
    """The axis of an operation is one of the points of its input (of its output for
    revolve), and a rotation of 2D points turns about z."""
    parameters = command["parameters"]
    problems = []
    axis = parameters.get("axis")
    points = made["points"] if command["tool"] == "revolve" else dimension["points"]
    if command["tool"] == "rotate" and points == 2 and axis != "z":
        problems.append(f"'{name}' has 2D points, which rotate about z only.")
    elif command["tool"] == "rotate" and points < 2:
        problems.append(f"'{name}' has 1D points, which cannot rotate.")
    elif (
        axis is not None and command["tool"] != "rotate" and AXES.index(axis) >= points
    ):
        problems.append(f"'{name}' has {points}D points, without the axis {axis}.")
    for key in ("center", "centerpoint"):
        center = parameters.get(key)
        if center is not None and len(center) != points:
            problems.append(
                f"the {key} needs {points} coordinates, one per dimension of the "
                f"points of '{name}'."
            )
    values = parameters.get("values")
    if command["tool"] == "add_runouts" and len(values) != points - 1:
        count = "1 value" if points == 2 else f"{points - 1} values"
        problems.append(
            f"'{name}' has {points}D points: the runouts need {count}, one per "
            "coordinate perpendicular to the axis."
        )
    return problems


def _values(command, known):
    """The values of the parameters of a tool in the script: an axis as its index, the
    plane of a mirror as its normal and a point on it."""
    parameters = dict(command["parameters"])
    if command["tool"] == "mirror":
        points = known[command["inputs"][0]]["points"]
        index = AXES.index(parameters.pop("axis"))
        value = parameters.pop("value")
        parameters["normal"] = [int(i == index) for i in range(points)]
        parameters["centerpoint"] = [value if i == index else 0 for i in range(points)]
    elif "axis" in parameters:
        parameters["axis"] = AXES.index(parameters["axis"])
    return parameters


def call(command, known=None):
    """Return the FElupe call of a tool, its arguments and the end of its line in the
    script: the values of its parameters as written, expressions as their code (#242).
    An operation is a method of its input, or a function of its inputs (``known`` are
    the dimensions of the meshes made before, see :func:`dimensions`). A stack is the
    method ``stack()`` of a mesh container of the list of its inputs, whose points are
    merged (#394).

    Examples
    --------
    >>> call({"tool": "Cube", "parameters": {"a": [0, 0, 0], "b": [1, 2, 3],
    ...                                      "n": [2, 3, 4]}})
    ('fem.Cube', ['a=[0, 0, 0]', 'b=[1, 2, 3]', 'n=[2, 3, 4]'], '')
    >>> call({"tool": "revolve", "inputs": ["face"],
    ...       "parameters": {"n": 19, "phi": 360, "axis": "x"}})
    ('face.revolve', ['n=19', 'phi=360', 'axis=0'], '')
    >>> function, args, end = call({"tool": "stack", "inputs": ["left", "right"],
    ...                             "parameters": {"decimals": 10}})
    >>> f"{function}({', '.join(map(str, args))}){end}"
    'fem.MeshContainer([left, right], merge=True, decimals=10).stack()'
    """
    definition = tools()[command["tool"]]
    parameters = _values(command, known or {})
    felupe = definition["x-felupe"]
    inputs = command.get("inputs", [])
    args = [] if felupe.startswith(".") else list(inputs)
    function = f"{inputs[0]}{felupe}" if felupe.startswith(".") else felupe
    end = ""
    if definition["x-dimension"].get("inputs") == "list":
        args, end = [List(inputs), "merge=True"], ".stack()"
    for key, value in parameters.items():
        text = vector(value) if isinstance(value, list) else repr(value)
        args.append(f"{key}={text}")
    return function, args, end


def uses_embed(commands):
    """Whether a script needs the helper ``embed()``."""
    return any(
        c["command"] == "mesh.generate" and c.get("tool") == "embed" for c in commands
    )


def generate(commands, values=None, meshes=None):
    """Make the meshes of the tools of resolved commands with the lines of the script
    and return them by their names (``fem.Mesh``). ``values`` are the values of the
    parameters of the model, which the expressions of the values use, and ``meshes``
    the meshes of files and scripts that the tools take, by their names (#438).

    Examples
    --------
    >>> meshes = generate([{"command": "mesh.generate", "name": "block",
    ...                     "tool": "Cube", "parameters": {"a": [0, 0, 0],
    ...                     "b": [1, 1, 1], "n": [3, 3, 3]}}])
    >>> meshes["block"].npoints, meshes["block"].cell_type
    (27, 'hexahedron')
    """
    import felupe as fem
    import numpy as np

    from ._helpers import embed
    from .formatting import call as call_line

    # embed() is a helper of the script (ADR 0019)
    namespace = {"fem": fem, "np": np, "embed": embed, **(values or {})}
    namespace.update(meshes or {})
    known = dimensions(commands, measured(meshes or {}))
    names = []
    for command in commands:
        if command["command"] != "mesh.generate":
            continue
        function, args, end = call(command, known)
        exec(call_line(command["name"], function, args, end), namespace)
        names.append(command["name"])
    return {name: namespace[name] for name in names}
