"""The mesh tools (ADR 0019, #193): the registry in the schema, the dimensions of the
made meshes, their lines in the script and the meshes they make."""

import json
from pathlib import Path

import felupe as fem
import meshio
import numpy as np
import pytest

from felupe_studio import checks, codegen, meshes, meshtools
from felupe_studio.commands import errors
from felupe_studio.expressions import resolve

GOLDEN = Path(__file__).parent / "golden"


def made(tool, name="mesh", **parameters):
    command = {"command": "mesh.generate", "name": name, "tool": tool}
    return {**command, "parameters": parameters}


def test_the_registry_of_the_tools():
    assert list(meshtools.tools()) == [
        *("Point", "Line", "Rectangle", "Cube"),
        *("expand", "revolve", "embed", "translate", "rotate", "mirror"),
    ]
    for name, definition in meshtools.tools().items():
        rule = definition["x-dimension"]
        if "inputs" in rule:
            # an operation: a method of its input, or a function of its inputs
            assert definition["x-group"] == "Operations"
            assert set(rule) == {"inputs", "cell_type", "points"}
        else:
            assert definition["x-label"] == name
            assert definition["x-felupe"].startswith("fem.")
            assert set(rule) == {"points", "cells", "cell_type"}


@pytest.mark.parametrize(
    ("command", "dimension"),
    [
        (made("Point", a=0.5), (1, 0, "vertex")),
        (made("Line", a=0, b=2, n=5), (1, 1, "line")),
        (made("Rectangle", a=[0, 0], b=[2, 1], n=[3, 2]), (2, 2, "quad")),
        (made("Cube", a=[0, 0, 0], b=[2, 1, 1], n=[3, 2, 2]), (3, 3, "hexahedron")),
    ],
)
def test_the_dimensions_are_those_of_felupe(command, dimension):
    # known from the commands, and the same as of the mesh that FElupe makes
    known = meshtools.dimensions([command])["mesh"]
    assert (known["points"], known["cells"], known["cell_type"]) == dimension
    mesh = meshtools.generate([command])["mesh"]
    assert isinstance(mesh, fem.Mesh)
    assert mesh.points.shape[1] == known["points"]
    assert mesh.cell_type == known["cell_type"]


def test_the_lines_of_the_script():
    assert meshtools.call(made("Line", a=0, b=2.5, n=6)) == (
        "fem.mesh.Line",
        ["a=0", "b=2.5", "n=6"],
    )
    document = {
        "schema_version": 3,
        "commands": [
            {"command": "parameter.add", "name": "width", "value": 2.0},
            made("Rectangle", "face", a=[0, 0], b=["width", 1], n=[3, 2]),
        ],
    }
    script = codegen(document, evaluate=False)
    assert "face = fem.Rectangle(a=[0, 0], b=[width, 1], n=[3, 2])" in script
    # the meshes made with the lines of the script and the values of the parameters
    resolved = resolve(document)[0]["commands"]
    mesh = meshtools.generate(resolved, {"width": 2.0})["face"]
    np.testing.assert_allclose(mesh.points.max(axis=0), [2, 1])


def test_the_values_of_the_tools():
    assert meshtools.problems(made("Cube", a=[0, 0, 0], b=[1, 1, 1])) == []
    assert meshtools.problems(made("Cube", a=[0, 2, 0], b=[1, 1, 0])) == [
        "b must be larger than a in y and z."
    ]
    assert meshtools.problems(made("Line", a=1, b=0)) == ["b must be larger than a."]
    assert meshtools.problems(made("Point", a=1)) == []


def test_a_cube_made_by_a_tool_is_checked_like_a_file(tmp_path):
    # the cells of a mesh of the model made by a tool are assigned to its section;
    # a construction mesh is no mesh of the model
    document = json.loads((GOLDEN / "cube_made_by_tools" / "commands.json").read_text())
    document["commands"].insert(2, made("Line", "bottom", a=0, b=1, n=3))
    assert errors(document) == []
    report = checks.check(document, tmp_path)
    assert report["ok"]
    assert report["cells"]["total"] == 8
    assert report["cells"]["unassigned"] == []


@pytest.mark.parametrize(
    ("tool", "parameters", "surface", "triangles"),
    [
        ("Point", {"a": 1}, "vertex", 0),
        ("Line", {"a": 0, "b": 2, "n": 5}, "line", 0),
        ("Rectangle", {"a": [0, 0], "b": [2, 1], "n": [3, 2]}, "quad", 4),
        ("Cube", {"a": [0, 0, 0], "b": [2, 1, 1], "n": [3, 2, 2]}, "hexahedron", 20),
    ],
)
def test_the_meshes_of_the_worker(tool, parameters, surface, triangles):
    # summarized for the app with their dimension: meshes of 2D and 3D cells like a
    # mesh file, lines and vertices with their lines for the viewer (ADR 0019)
    info, surfaces = meshes.generate([made(tool, **parameters)], "mesh")
    info = json.loads(info)
    assert info["dimension"]["cell_type"] == surface
    assert list(surfaces) == [surface]
    assert len(surfaces[surface]["triangles"]) // 12 == triangles
    lines = len(surfaces[surface]["edges"]) // 8
    if tool == "Line":
        assert lines == 4
    if tool == "Point":
        assert lines == 0 and info["points"] == 1


def test_an_error_of_felupe_is_the_state_of_the_mesh():
    # e.g. a number of points that is not an integer, which the validation reports
    cube = made("Cube", a=[0, 0, 0], b=[1, 1, 1], n=[2.5, 2, 2])
    info, surfaces = meshes.generate([cube], "mesh")
    assert "Error" in json.loads(info)["error"] and surfaces == {}


def test_a_made_mesh_is_exported_like_a_file(tmp_path):
    # the solid cells of a made mesh as a file (ADR 0019, #230); a line has none
    cube = made("Cube", "block", a=[0, 0, 0], b=[2, 1, 1], n=[3, 2, 2])
    data = meshes.export_generated([cube], "block", "vtu")
    (tmp_path / "block.vtu").write_bytes(data)
    mesh = meshio.read(tmp_path / "block.vtu")
    assert mesh.cells[0].type == "hexahedron" and len(mesh.cells[0].data) == 2
    line = made("Line", "edge", a=0, b=1, n=3)
    with pytest.raises(ValueError, match="'edge' has no solid cells"):
        meshes.export_generated([line], "edge", "vtu")


LINE = made("Line", "line", a=0, b=2, n=3)
RECTANGLE = made("Rectangle", "face", a=[0, 0], b=[2, 1], n=[3, 2])
CUBE = made("Cube", "block", a=[0, 0, 0], b=[2, 1, 1], n=[3, 2, 2])


def operation(tool, inputs, **parameters):
    return {**made(tool, "made", **parameters), "inputs": inputs}


@pytest.mark.parametrize(
    "chain",
    [
        [made("Point", "point", a=1), operation("expand", ["point"], n=3, z=2)],
        [LINE, operation("expand", ["line"], n=3, z=2)],
        [RECTANGLE, operation("expand", ["face"], n=3, z=2)],
        [
            made("Point", "point", a=1),
            operation("revolve", ["point"], n=3, phi=90, axis="x"),
        ],
        [LINE, operation("revolve", ["line"], n=3, phi=90, axis="x")],
        [RECTANGLE, operation("revolve", ["face"], n=4, phi=90, axis="x")],
        [LINE, operation("embed", ["line"], value=3)],
        [RECTANGLE, operation("embed", ["face"], value=3)],
        [CUBE, operation("translate", ["block"], move=2, axis="z")],
        [
            RECTANGLE,
            operation("rotate", ["face"], angle_deg=30, axis="z", center=[1, 0]),
        ],
        [CUBE, operation("rotate", ["block"], angle_deg=30, axis="x")],
        [CUBE, operation("mirror", ["block"], axis="y", value=0.5)],
        [RECTANGLE, operation("mirror", ["face"], axis="x", value=0)],
    ],
)
def test_the_dimensions_of_the_operations_are_those_of_felupe(chain):
    # known from the commands, and the same as of the mesh that FElupe makes
    assert errors({"schema_version": 3, "commands": chain}) == []
    known = meshtools.dimensions(chain)["made"]
    mesh = meshtools.generate(chain)["made"]
    assert mesh.points.shape[1] == known["points"]
    assert mesh.cell_type == known["cell_type"]


def test_the_lines_of_the_operations():
    chain = [
        LINE,
        operation("embed", ["line"], value=30.0),
        {**operation("expand", ["made"], n=3, z=10), "name": "face"},
        {**operation("mirror", ["face"], axis="y", value=0.5), "name": "flipped"},
    ]
    script = codegen({"schema_version": 3, "commands": chain}, evaluate=False)
    assert "made = embed(line, value=30.0)" in script
    assert "face = made.expand(n=3, z=10)" in script
    assert "flipped = face.mirror(normal=[0, 1, 0], centerpoint=[0, 0.5, 0])" in script
    assert "def embed(mesh, value=0.0):" in script
    # the helper only in scripts with embedded meshes
    assert "def embed" not in codegen({"schema_version": 3, "commands": [LINE]})
