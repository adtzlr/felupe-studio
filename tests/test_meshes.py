import json
from pathlib import Path

import felupe as fem
import meshio
import numpy as np

from felupe_studio.meshes import MAX_TAG_VALUES, inspect, inspect_json

GOLDEN = Path(__file__).parent / "golden"


def test_vtu_with_tag():
    info = inspect(GOLDEN / "bar_sections_tag" / "bar.vtu")
    assert info == {
        "file": "bar.vtu",
        "points": 325,
        "blocks": [{"type": "hexahedron", "cells": 192}],
        "cell_type": "hexahedron",
        "cells": 192,
        "ignored": [],
        "bounds": [[0.0, 0.0, 0.0], [3.0, 1.0, 1.0]],
        "tags": [
            {
                "name": "material",
                "values": [{"value": 1, "cells": 96}, {"value": 2, "cells": 96}],
            }
        ],
    }
    assert json.loads(inspect_json(GOLDEN / "bar_sections_tag" / "bar.vtu")) == info


def test_gmsh_physical_first():
    info = inspect(GOLDEN / "bar_sections_gmsh" / "bar.msh")
    assert [t["name"] for t in info["tags"]] == ["gmsh:physical", "gmsh:geometrical"]
    assert info["blocks"] == [{"type": "hexahedron", "cells": 192}]


def test_without_tags():
    info = inspect(GOLDEN / "bar_single_body" / "bar.vtu")
    assert info["tags"] == []
    assert "error" not in info


def test_ignores_faces_and_float_tags(tmp_path):
    mesh = fem.Cube(n=3).triangulate()
    faces = np.array([[0, 1, 2], [1, 2, 3]])
    meshio.Mesh(
        mesh.points,
        [("triangle", faces), ("tetra", mesh.cells)],
        cell_data={
            "zone": [np.array([7.0, 7.0]), np.full(len(mesh.cells), 3.0)],
            "density": [np.array([0.5, 0.5]), np.full(len(mesh.cells), 1.5)],
            "many": [np.arange(2), np.arange(len(mesh.cells))],
        },
    ).write(tmp_path / "part.vtu")
    info = inspect(tmp_path / "part.vtu")
    assert info["cell_type"] == "tetra"
    assert info["cells"] == len(mesh.cells)
    assert info["ignored"] == ["triangle"]
    # only the values of the solid cells; non-integer arrays are not tags
    names = [t["name"] for t in info["tags"]]
    assert "density" not in names
    zone = next(t for t in info["tags"] if t["name"] == "zone")
    assert zone["values"] == [{"value": 3, "cells": len(mesh.cells)}]
    assert ("many" in names) == (len(mesh.cells) <= MAX_TAG_VALUES)


def test_errors(tmp_path):
    surface = fem.Rectangle(n=3)
    meshio.Mesh(
        np.pad(surface.points, ((0, 0), (0, 1))), [("quad", surface.cells)]
    ).write(tmp_path / "surface.vtu")
    info = inspect(tmp_path / "surface.vtu")
    assert info["error"].startswith("The file needs one type of solid cells")
    assert info["error"].endswith("found quad.")

    (tmp_path / "broken.vtu").write_text("not a mesh")
    assert inspect(tmp_path / "broken.vtu")["error"].startswith("meshio could not")
    assert inspect(tmp_path / "missing.vtu")["error"].startswith("meshio could not")


def test_gmsh_physical_names(tmp_path):
    mesh = fem.Cube(n=3)
    left = mesh.points[mesh.cells].mean(axis=1)[:, 0] < 0.5
    cells = [mesh.cells[left], mesh.cells[~left]]
    meshio.Mesh(
        mesh.points,
        [("hexahedron", c) for c in cells],
        cell_data={
            "gmsh:physical": [np.full(len(c), i + 1) for i, c in enumerate(cells)],
            "gmsh:geometrical": [np.full(len(c), i + 1) for i, c in enumerate(cells)],
        },
        field_data={
            "rubber": np.array([1, 3]),
            "steel": np.array([2, 3]),
            "top": [5, 2],
        },
    ).write(tmp_path / "part.msh", file_format="gmsh22", binary=False)
    physical = inspect(tmp_path / "part.msh")["tags"][0]
    assert physical == {
        "name": "gmsh:physical",
        "values": [
            {"value": 1, "cells": 4, "label": "rubber"},
            {"value": 2, "cells": 4, "label": "steel"},
        ],
    }
