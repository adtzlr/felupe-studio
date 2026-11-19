"""The mesh tools (ADR 0019, #193): the registry in the schema, the dimensions of the
made meshes, their lines in the script and the meshes they make."""

import json
from pathlib import Path

import felupe as fem
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
    assert list(meshtools.tools()) == ["Point", "Line", "Rectangle", "Cube"]
    for name, definition in meshtools.tools().items():
        assert definition["x-label"] == name
        assert definition["x-felupe"].startswith("fem.")
        assert set(definition["x-dimension"]) == {"points", "cells", "cell_type"}


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
