"""The mesh tools (ADR 0019, #193): meshes made with the tools of FElupe.

A ``mesh.generate`` command makes one mesh with a tool of the registry in the
command schema (the definitions of ``MeshGenerate``): its FElupe call
(``x-felupe``), the dimensions of its points and cells and its cell type
(``x-dimension``) and its parameters. :func:`dimensions` knows them before Python
runs, like ``dimensions()`` of ``app/src/core/meshtools.ts``. A mesh whose points and
cells have the dimension of the model is a model mesh with cell sets; a lower one is
a construction mesh. :func:`call` is the line of a tool in the script, and
:func:`generate` makes the meshes with these lines, like the script.
"""

from functools import cache

from .commands import schema
from .formatting import vector

__all__ = ["call", "dimensions", "generate", "model_mesh", "problems", "tools"]

AXES = ("x", "y", "z")


@cache
def tools():
    """The definitions of the mesh tools by their names, from the schema.

    Examples
    --------
    >>> list(tools())
    ['Point', 'Line', 'Rectangle', 'Cube']
    >>> tools()["Rectangle"]["x-dimension"]
    {'points': 2, 'cells': 2, 'cell_type': 'quad'}
    """
    defs = schema()["$defs"]
    result = {}
    for branch in defs["MeshGenerate"]["oneOf"]:
        definition = defs[branch["$ref"].split("/")[-1]]
        result[definition["properties"]["tool"]["const"]] = definition
    return result


def dimensions(commands):
    """Return the dimensions of the points and of the cells and the cell type of every
    mesh made by a tool, by its name, from the commands alone.

    Examples
    --------
    >>> dimensions([{"command": "mesh.generate", "name": "bottom", "tool": "Line",
    ...              "parameters": {"a": 0, "b": 1, "n": 5}}])
    {'bottom': {'points': 1, 'cells': 1, 'cell_type': 'line'}}
    """
    return {
        c["name"]: dict(tools()[c["tool"]]["x-dimension"])
        for c in commands
        if c["command"] == "mesh.generate"
    }


def model_mesh(dimension, dim):
    """Whether a mesh of these dimensions is a mesh of a model of dimension ``dim``:
    its points and its cells have the dimension of the model."""
    return dimension["points"] == dim and dimension["cells"] == dim


def problems(command):
    """Return what is wrong with the values of a tool beyond the schema: the corner
    ``b`` (the end of a line) is larger than ``a`` in every axis.

    Examples
    --------
    >>> problems({"tool": "Rectangle", "parameters": {"a": [0, 2], "b": [1, 1]}})
    ['b must be larger than a in y.']
    >>> problems({"tool": "Line", "parameters": {"a": 1, "b": 1}})
    ['b must be larger than a.']
    """
    parameters = command["parameters"]
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


def call(command):
    """Return the FElupe call of a tool and its arguments in the script: the values of
    its parameters as written, expressions as their code (#242).

    Examples
    --------
    >>> call({"tool": "Cube", "parameters": {"a": [0, 0, 0], "b": [1, 2, 3],
    ...                                      "n": [2, 3, 4]}})
    ('fem.Cube', ['a=[0, 0, 0]', 'b=[1, 2, 3]', 'n=[2, 3, 4]'])
    """
    definition = tools()[command["tool"]]
    parameters = command["parameters"]
    args = []
    for key in definition["properties"]["parameters"]["properties"]:
        if key in parameters:
            value = parameters[key]
            text = vector(value) if isinstance(value, list) else repr(value)
            args.append(f"{key}={text}")
    return definition["x-felupe"], args


def generate(commands, values=None):
    """Make the meshes of the tools of resolved commands with the lines of the script
    and return them by their names (``fem.Mesh``). ``values`` are the values of the
    parameters of the model, which the expressions of the values use.

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

    from .formatting import call as call_line

    namespace = {"fem": fem, "np": np, **(values or {})}
    names = []
    for command in commands:
        if command["command"] != "mesh.generate":
            continue
        function, args = call(command)
        exec(call_line(command["name"], function, args), namespace)
        names.append(command["name"])
    return {name: namespace[name] for name in names}
