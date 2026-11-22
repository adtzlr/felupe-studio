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
    lines = fem.mesh.Line(n=3)
    meshio.Mesh(np.pad(lines.points, ((0, 0), (0, 2))), [("line", lines.cells)]).write(
        tmp_path / "lines.vtu"
    )
    info = inspect(tmp_path / "lines.vtu")
    assert info["error"].startswith("The file needs solid cells (tetra, ")
    assert info["error"].endswith("found line.")

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
    # JavaScript's null of the worker arrives as pyodide.ffi.jsnull, which is no item
    jsnull = type("JsNull", (), {"__bool__": lambda self: False})()
    text, _ = make_json("plain.py", "{}", jsnull)
    assert json.loads(text)["solids"][0]["cells"] == 1


def test_2d_meshes(tmp_path):
    # the 2D cells of a 2D model (#175): the quads of a 2D mesh, not the faces of
    # the hexahedrons of a 3D mesh
    surface = fem.Rectangle(b=(2, 1), n=3)
    cube = fem.Cube(n=2)
    meshio.Mesh(
        np.pad(surface.points, ((0, 0), (0, 1))),
        [("quad", surface.cells), ("line", [[0, 1]])],
    ).write(tmp_path / "surface.vtu")
    info = inspect(tmp_path / "surface.vtu")
    assert info["solids"] == [
        {
            "cell_type": "quad",
            "cells": 4,
            "bounds": [[0.0, 0.0, 0.0], [2.0, 1.0, 0.0]],
            "tags": [],
        }
    ]
    assert info["ignored"] == ["line"]
    solid = volume_cells(meshio.read(tmp_path / "surface.vtu"), dim=2)
    assert solid.points.shape == (9, 2) and solid.cell_type == "quad"
    # the 2D cells of a 3D model and the 3D cells of a 2D model
    with pytest.raises(ValueError, match="which are 2D cells: set the analysis"):
        volume_cells(meshio.read(tmp_path / "surface.vtu"))
    with pytest.raises(ValueError, match="which are 3D cells: a 2D model"):
        volume_cells(meshio.Mesh(cube.points, [("hexahedron", cube.cells)]), dim=2)

    faces = fem.Rectangle(n=2)
    meshio.Mesh(cube.points, [("hexahedron", cube.cells), ("quad", faces.cells)]).write(
        tmp_path / "cube.vtu"
    )
    info = inspect(tmp_path / "cube.vtu")
    assert [s["cell_type"] for s in info["solids"]] == ["hexahedron"]
    assert info["ignored"] == ["quad"]


@pytest.mark.parametrize("format", ["vtu", "vtk", "msh", "inp", "bdf"])
def test_export_mesh_files(tmp_path, format):
    # a mesh of the project as a file of another format (#230): the solid cells with
    # their tags, without the faces of the file
    from felupe_studio.meshes import EXPORT_FORMATS, export

    data = export(GOLDEN / "bar_sections_tag" / "bar.vtu", format)
    target = tmp_path / f"bar.{format}"
    target.write_bytes(data)
    mesh = meshio.read(target, file_format=EXPORT_FORMATS[format][1])
    original = meshio.read(GOLDEN / "bar_sections_tag" / "bar.vtu")
    np.testing.assert_allclose(mesh.points, original.points)
    assert [(b.type, len(b.data)) for b in mesh.cells] == [("hexahedron", 192)]
    np.testing.assert_array_equal(mesh.cells[0].data, original.cells[0].data)
    if format in ["vtu", "vtk", "msh"]:
        tags = np.ravel(original.cell_data["material"][0])
        np.testing.assert_array_equal(np.ravel(mesh.cell_data["material"][0]), tags)

    # of a file with two types of solid cells and faces: one type, if given
    cell_types = GOLDEN / "bar_cell_types" / "bar.vtu"
    mesh = meshio.read(io_bytes(export(cell_types, "vtu"), tmp_path))
    assert [b.type for b in mesh.cells] == ["hexahedron", "tetra"]
    mesh = meshio.read(io_bytes(export(cell_types, "vtu", cell_type="tetra"), tmp_path))
    assert [b.type for b in mesh.cells] == ["tetra"]
    # with the scale of the mesh, as the model uses it
    mesh = meshio.read(io_bytes(export(cell_types, "vtu", scale=1000), tmp_path))
    np.testing.assert_allclose(mesh.points.max(axis=0), [3000, 1000, 1000])


def io_bytes(data, folder, name="mesh.vtu"):
    """The bytes of an exported mesh as a file to read with meshio."""
    (folder / name).write_bytes(data)
    return folder / name


def test_export_meshes_of_scripts(tmp_path, monkeypatch):
    # the mesh that a script makes with the parameters, an item of a dict, a 2D mesh
    # in 3D, and the parameters as JSON text of the worker (#230)
    from felupe_studio.meshes import export, export_json

    monkeypatch.chdir(tmp_path)
    (tmp_path / "blocks.py").write_text(BLOCKS, encoding="utf-8")
    data = export("blocks.py", "vtu", {"length": 2.0, "cells": 4}, "left")
    mesh = meshio.read(io_bytes(data, tmp_path))
    assert len(mesh.cells[0].data) == 4
    np.testing.assert_allclose(mesh.points.max(axis=0), [2, 1, 1])
    data = export_json(
        "blocks.py", "msh", json.dumps({"length": 1, "cells": 1}), "right"
    )
    mesh = meshio.read(io_bytes(data, tmp_path, "mesh.msh"))
    assert sum(len(b.data) for b in mesh.cells if b.type == "hexahedron") == 2

    (tmp_path / "plate.py").write_text(
        "import felupe as fem\nmesh = fem.Rectangle(b=(2, 1), n=3)\n", encoding="utf-8"
    )
    jsnull = type("JsNull", (), {"__bool__": lambda self: False})()
    mesh = meshio.read(io_bytes(export_json("plate.py", "vtu", "{}", jsnull), tmp_path))
    assert mesh.points.shape == (9, 3) and np.all(mesh.points[:, 2] == 0)
    assert [b.type for b in mesh.cells] == ["quad"]

    # errors: an unknown format, a mesh without solid cells
    with pytest.raises(ValueError, match="Unknown format 'stl'"):
        export("plate.py", "stl", {})
    lines = "mesh = meshio.Mesh([[0, 0, 0], [1, 0, 0]], [('line', [[0, 1]])])"
    (tmp_path / "lines.py").write_text(f"import meshio\n{lines}\n", encoding="utf-8")
    with pytest.raises(ValueError, match="no solid cells to export"):
        export("lines.py", "vtu", {})


def test_cuts_of_kept_meshes(tmp_path, monkeypatch):
    """A cut of the view (#395) cuts the kept cells of the latest read of a file, run
    of a script or mesh of tools, without a new read or run; a new file forgets
    them."""
    from felupe_studio import meshes
    from felupe_studio.meshes import generate, make

    monkeypatch.chdir(tmp_path)
    monkeypatch.setattr(meshes, "_kept", type(meshes._kept)())
    cut = {"axis": "x", "value": 0.5, "half": "+"}
    triangles = lambda surface: len(surface["triangles"]) // 12  # noqa: E731

    fem.Cube(n=3).write("cube.vtu")
    plain = load("cube.vtu")[1]["hexahedron"]
    assert plain["sources"] is None
    # the file is not read again: a cut of the kept cells, with the summary
    (tmp_path / "cube.vtu").unlink()
    text, surfaces = load("cube.vtu", cut)
    assert json.loads(text)["solids"][0]["cells"] == 8
    sources = np.frombuffer(surfaces["hexahedron"]["sources"], "<i4")
    assert (sources < 0).any() and (sources >= 0).any()
    assert 0 < triangles(surfaces["hexahedron"]) != triangles(plain)

    # a script is not run again (it counts its runs), with the same parameters
    script = (
        "import felupe as fem\nopen('runs', 'a').write('.')\nmesh = fem.Cube(n=n)\n"
    )
    (tmp_path / "cube.py").write_text(script, encoding="utf-8")
    make("cube.py", {"n": 3})
    _, surfaces = make("cube.py", {"n": 3}, cut=cut)
    assert (tmp_path / "runs").read_text() == "."
    assert surfaces["hexahedron"]["sources"] is not None
    # other parameters are another mesh, made for the cut
    make("cube.py", {"n": 2}, cut=cut)
    assert (tmp_path / "runs").read_text() == ".."

    # a mesh of tools, and a construction mesh whose lines are not cut
    block = {"command": "mesh.generate", "name": "block", "tool": "Cube"}
    commands = [{**block, "parameters": {"a": [0, 0, 0], "b": [1, 1, 1], "n": 3}}]
    _, surfaces = generate(commands, "block", cut)
    assert surfaces["hexahedron"]["sources"] is not None
    line = {"command": "mesh.generate", "name": "edge", "tool": "Line"}
    commands = [{**line, "parameters": {"a": 0, "b": 2, "n": 5}}]
    _, surfaces = generate(commands, "edge", cut)
    assert list(surfaces) == ["line"] and "sources" not in surfaces["line"]

    # the latest meshes are kept, a new file forgets them
    assert len(meshes._kept) == 5
    monkeypatch.setattr(meshes, "KEPT", 2)
    make("cube.py", {"n": 4})
    assert len(meshes._kept) == 2
    meshes.forget()
    assert not meshes._kept
