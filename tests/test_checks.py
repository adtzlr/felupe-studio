import copy
import json
from pathlib import Path

import felupe as fem
import meshio
import numpy as np
import pytest

from felupe_studio.checks import boundary_faces, check

GOLDEN = Path(__file__).parent / "golden"


def load(case):
    return json.loads((GOLDEN / case / "commands.json").read_text(encoding="utf-8"))


def write(path, mesh, cell_type=None):
    meshio.Mesh(mesh.points, [(cell_type or mesh.cell_type, mesh.cells)]).write(path)


def two_files(left="left.vtu", right="right.vtu"):
    """Command list with one section per file, like the golden case."""
    document = load("bar_sections_files")
    for cmd in document["commands"]:
        if cmd["name"] == "left_file":
            cmd["file"] = left
        if cmd["name"] == "right_file":
            cmd["file"] = right
    return document


def test_boundary_faces_of_a_cube():
    mesh = fem.Cube(n=3)
    (faces,) = boundary_faces(mesh.cells, mesh.cell_type)
    assert len(faces) == 6 * 4
    tetra = mesh.triangulate()
    (faces,) = boundary_faces(tetra.cells, tetra.cell_type)
    assert len(np.unique(faces)) == mesh.npoints - 1  # all but the center point


def test_single_body():
    report = check(load("bar_single_body"), GOLDEN / "bar_single_body")
    assert report["ok"]
    assert report["interfaces"] == []
    assert report["messages"] == ["192 / 192 cells assigned once."]


@pytest.mark.parametrize(
    "case",
    [
        "bar_sections_tag",
        "bar_sections_gmsh",
        "bar_sections_files",
        "bar_two_materials",
    ],
)
def test_conforming_sections(case):
    report = check(load(case), GOLDEN / case)
    assert report["ok"], report["messages"]
    assert report["cells"]["total"] == 192
    (interface,) = report["interfaces"]
    assert interface["shared"] == 25  # 5 x 5 points at x = 1.5
    assert interface["hanging"] == 0


def test_meshes_of_cell_types_of_one_file():
    # hexahedra and tetrahedra on the same points: connected at their corner points
    report = check(load("bar_cell_types"), GOLDEN / "bar_cell_types")
    assert report["ok"], report["messages"]
    assert report["cells"]["total"] == 96 + 576
    (interface,) = report["interfaces"]
    assert (interface["shared"], interface["hanging"]) == (25, 0)


def test_non_conforming_interface(tmp_path):
    # the right half is finer: 9 x 9 points at the interface, 5 x 5 of them shared
    write(tmp_path / "left.vtu", fem.Cube(b=(1.5, 1, 1), n=(7, 5, 5)))
    write(tmp_path / "right.vtu", fem.Cube(a=(1.5, 0, 0), b=(3, 1, 1), n=(7, 9, 9)))
    report = check(two_files(), tmp_path)

    assert not report["ok"]
    (interface,) = report["interfaces"]
    assert interface == {
        "sections": ["left_body", "right_body"],
        "shared": 25,
        "hanging": 81 - 25,
    }
    assert "56 hanging" in report["messages"][-1]


def test_slightly_different_coordinates(tmp_path):
    # same discretization, but the right file is shifted by a tiny amount: no point is
    # merged, all interface points of both sides are hanging
    write(tmp_path / "left.vtu", fem.Cube(b=(1.5, 1, 1), n=(7, 5, 5)))
    right = fem.Cube(a=(1.5, 0, 0), b=(3, 1, 1), n=(7, 5, 5))
    right.points[:, 0] += 1e-9
    write(tmp_path / "right.vtu", right)
    report = check(two_files(), tmp_path)

    (interface,) = report["interfaces"]
    assert interface["shared"] == 0
    assert interface["hanging"] == 2 * 25


def test_slightly_different_coordinates_merged(tmp_path):
    write(tmp_path / "left.vtu", fem.Cube(b=(1.5, 1, 1), n=(7, 5, 5)))
    right = fem.Cube(a=(1.5, 0, 0), b=(3, 1, 1), n=(7, 5, 5))
    right.points[:, 0] += 1e-9
    write(tmp_path / "right.vtu", right)
    document = two_files()
    document["commands"].insert(
        2, {"command": "mesh.merge", "name": "m", "decimals": 6}
    )
    report = check(document, tmp_path)

    assert report["ok"]
    (interface,) = report["interfaces"]
    assert interface["shared"] == 25
    assert interface["hanging"] == 0


def test_separate_bodies_have_no_interface(tmp_path):
    write(tmp_path / "left.vtu", fem.Cube(b=(1.5, 1, 1), n=(7, 5, 5)))
    write(tmp_path / "right.vtu", fem.Cube(a=(2, 0, 0), b=(3, 1, 1), n=(7, 5, 5)))
    report = check(two_files(), tmp_path)
    assert report["ok"]
    assert report["interfaces"] == []


def test_tetrahedrons_non_conforming(tmp_path):
    left = fem.Cube(b=(1.5, 1, 1), n=(4, 3, 3)).triangulate()
    right = fem.Cube(a=(1.5, 0, 0), b=(3, 1, 1), n=(4, 5, 5)).triangulate()
    write(tmp_path / "left.vtu", left)
    write(tmp_path / "right.vtu", right)
    (interface,) = check(two_files(), tmp_path)["interfaces"]
    assert interface["shared"] == 9
    assert interface["hanging"] == 25 - 9


def test_unassigned_and_multiple_cells():
    document = load("bar_sections_tag")
    commands = document["commands"]

    unassigned = copy.deepcopy(document)
    unassigned["commands"] = [c for c in commands if c["name"] != "right_body"]
    report = check(unassigned, GOLDEN / "bar_sections_tag")
    assert not report["ok"]
    assert report["cells"]["unassigned"] == [{"mesh": "bar", "cells": 96}]
    assert "96 of 192 cells of mesh 'bar' are not assigned" in report["messages"][0]

    multiple = copy.deepcopy(document)
    index = next(i for i, c in enumerate(commands) if c["name"] == "right_body")
    multiple["commands"][index:index] = [
        {"command": "cellset.from_file", "name": "everything", "mesh": "bar"},
        {
            "command": "section.add",
            "name": "extra",
            "cellset": "everything",
            "material": "rubber",
            "formulation": "u",
        },
    ]
    report = check(multiple, GOLDEN / "bar_sections_tag")
    assert not report["ok"]
    assert report["cells"]["multiple"] == [
        {"mesh": "bar", "cells": 192, "sections": ["extra", "left_body", "right_body"]}
    ]
    assert report["cells"]["unassigned"] == []


def test_report_is_json(tmp_path):
    report = check(load("bar_two_materials"), GOLDEN / "bar_two_materials")
    assert json.loads(json.dumps(report)) == report
