import json
from pathlib import Path

import felupe as fem
import meshio
import numpy as np
import pytest

from felupe_studio._helpers import volume_cells
from felupe_studio.meshes import MAX_TAG_VALUES, inspect, load

GOLDEN = Path(__file__).parent / "golden"


def test_vtu_with_tag():
    info = inspect(GOLDEN / "bar_sections_tag" / "bar.vtu")
    assert info == {
        "file": "bar.vtu",
        "points": 325,
        "blocks": [{"type": "hexahedron", "cells": 192}],
        "solids": [
            {
                "cell_type": "hexahedron",
                "cells": 192,
                "bounds": [[0.0, 0.0, 0.0], [3.0, 1.0, 1.0]],
                "tags": [
                    {
                        "name": "material",
                        "values": [
                            {"value": 1, "cells": 96},
                            {"value": 2, "cells": 96},
                        ],
                    }
                ],
            }
        ],
        "unsupported": [],
        "ignored": [],
    }
    text, surfaces = load(GOLDEN / "bar_sections_tag" / "bar.vtu")
    assert json.loads(text) == info
    assert list(surfaces) == ["hexahedron"]
    assert surfaces["hexahedron"]["cells"] == 192


def test_gmsh_physical_first():
    info = inspect(GOLDEN / "bar_sections_gmsh" / "bar.msh")
    (solid,) = info["solids"]
    assert [t["name"] for t in solid["tags"]] == ["gmsh:physical", "gmsh:geometrical"]
    assert info["blocks"] == [{"type": "hexahedron", "cells": 192}]


def test_without_tags():
    info = inspect(GOLDEN / "bar_single_body" / "bar.vtu")
    assert info["solids"][0]["tags"] == []
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
    (solid,) = info["solids"]
    assert solid["cell_type"] == "tetra"
    assert solid["cells"] == len(mesh.cells)
    assert info["ignored"] == ["triangle"]
    # only the values of the solid cells; non-integer arrays are not tags
    names = [t["name"] for t in solid["tags"]]
    assert "density" not in names
    zone = next(t for t in solid["tags"] if t["name"] == "zone")
    assert zone["values"] == [{"value": 3, "cells": len(mesh.cells)}]
    assert ("many" in names) == (len(mesh.cells) <= MAX_TAG_VALUES)


def test_errors(tmp_path):
    surface = fem.Rectangle(n=3)
    meshio.Mesh(
        np.pad(surface.points, ((0, 0), (0, 1))), [("quad", surface.cells)]
    ).write(tmp_path / "surface.vtu")
    info = inspect(tmp_path / "surface.vtu")
    assert info["error"].startswith("The file needs solid cells (tetra, ")
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
    physical = inspect(tmp_path / "part.msh")["solids"][0]["tags"][0]
    assert physical == {
        "name": "gmsh:physical",
        "values": [
            {"value": 1, "cells": 4, "label": "rubber"},
            {"value": 2, "cells": 4, "label": "steel"},
        ],
    }


def test_one_entry_per_cell_type():
    info = inspect(GOLDEN / "bar_cell_types" / "bar.vtu")
    assert [(s["cell_type"], s["cells"]) for s in info["solids"]] == [
        ("hexahedron", 96),
        ("tetra", 576),
    ]
    assert [s["bounds"][1][0] for s in info["solids"]] == [1.5, 3.0]
    assert info["ignored"] == ["quad"]
    assert info["unsupported"] == []

    text, surfaces = load(GOLDEN / "bar_cell_types" / "bar.vtu")
    assert list(surfaces) == ["hexahedron", "tetra"]
    assert [s["cells"] for s in surfaces.values()] == [96, 576]


def test_tags_per_cell_type(tmp_path):
    mesh = fem.Cube(n=3)
    tetra = fem.Cube(a=(1, 0, 0), b=(2, 1, 1), n=3).triangulate()
    points = np.vstack([mesh.points, tetra.points])
    meshio.Mesh(
        points,
        [("hexahedron", mesh.cells), ("tetra", tetra.cells + len(mesh.points))],
        cell_data={"zone": [np.full(len(mesh.cells), 1), np.full(len(tetra.cells), 2)]},
    ).write(tmp_path / "parts.vtu")
    solids = inspect(tmp_path / "parts.vtu")["solids"]
    assert [s["tags"][0]["values"] for s in solids] == [
        [{"value": 1, "cells": 8}],
        [{"value": 2, "cells": len(tetra.cells)}],
    ]


def test_unsupported_solid_cells(tmp_path):
    mesh = fem.Cube(n=2)
    wedges = np.array([[0, 1, 2, 4, 5, 6]])
    meshio.Mesh(mesh.points, [("hexahedron", mesh.cells), ("wedge", wedges)]).write(
        tmp_path / "hybrid.vtu"
    )
    info = inspect(tmp_path / "hybrid.vtu")
    assert [s["cell_type"] for s in info["solids"]] == ["hexahedron"]
    assert info["unsupported"] == [{"type": "wedge", "cells": 1}]
    assert "error" not in info

    meshio.Mesh(mesh.points, [("wedge", wedges)]).write(tmp_path / "wedges.vtu")
    info = inspect(tmp_path / "wedges.vtu")
    assert info["error"].startswith("FElupe has no region for wedge cells")
    assert load(tmp_path / "wedges.vtu")[1] == {}


def test_volume_cells_by_cell_type():
    mesh = meshio.read(GOLDEN / "bar_cell_types" / "bar.vtu")
    with pytest.raises(ValueError, match=r"one of \['hexahedron', 'tetra'\]"):
        volume_cells(mesh)
    with pytest.raises(ValueError, match="to take"):
        volume_cells(mesh, cell_type="tetra10")
    tetra = volume_cells(mesh, cell_type="tetra")
    assert (tetra.cell_type, tetra.cells.shape) == ("tetra", (576, 4))
    assert tetra.points is mesh.points


BLOCKS = """import felupe as fem

left = fem.Cube(b=(length, 1, 1), n=(cells + 1, 2, 2))
right = left.translate(length, axis=0)
mesh = {"left": left, "right": fem.MeshContainer([right, right.translate(1, axis=1)])}
"""


def test_meshes_of_scripts(tmp_path, monkeypatch):
    # the mesh made by a script with parameters, like a mesh file (#182)
    from felupe_studio.meshes import make, make_json

    monkeypatch.chdir(tmp_path)
    (tmp_path / "blocks.py").write_text(BLOCKS, encoding="utf-8")
    text, surfaces = make("blocks.py", {"length": 2.0, "cells": 4}, "left")
    info = json.loads(text)
    assert info["solids"][0]["cells"] == 4
    assert info["solids"][0]["bounds"] == [[0, 0, 0], [2, 1, 1]]
    assert list(surfaces) == ["hexahedron"]
    # a fem.MeshContainer, and the parameters as JSON text of the worker
    text, _ = make_json("blocks.py", json.dumps({"length": 1, "cells": 1}), "right")
    assert json.loads(text)["solids"][0]["cells"] == 2

    # errors with the traceback of the script, not of FElupe Studio
    info = json.loads(make("blocks.py", {"length": 2.0}, "left")[0])
    assert info["error"] == "NameError: name 'cells' is not defined"
    assert 'File "' in info["traceback"] and "blocks.py" in info["traceback"]
    assert "felupe_studio" not in info["traceback"]
    info = json.loads(make("blocks.py", {"length": 2.0, "cells": 1}, "middle")[0])
    assert "is a dict of ['left', 'right']" in info["error"]
    info = json.loads(make("blocks.py", {"length": 2.0, "cells": 1})[0])
    assert "take one of them, not None" in info["error"]
    (tmp_path / "none.py").write_text("x = 1\n", encoding="utf-8")
    assert "makes no variable 'mesh'" in json.loads(make("none.py", {})[0])["error"]
    (tmp_path / "text.py").write_text("mesh = 'a mesh'\n", encoding="utf-8")
    assert "is a str, not a fem.Mesh" in json.loads(make("text.py", {})[0])["error"]
    (tmp_path / "plain.py").write_text(
        "import felupe as fem\nmesh = fem.Cube(n=2)\n", encoding="utf-8"
    )
    assert "is not a dict" in json.loads(make("plain.py", {}, "left")[0])["error"]
    assert json.loads(make("plain.py", {})[0])["solids"][0]["cells"] == 1
