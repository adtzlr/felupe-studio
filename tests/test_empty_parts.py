"""Empty parts of mesh scripts (#418): a part that is empty for some values of the
parameters is one degenerate cell of its cell type, all its points one point. Its
section has no volume and is off in every step (#429, see
``test_sections_without_volume.py``), or the user leaves it out of the steps. A mesh
without cells is an error of the script that says so."""

import contextlib
import io
import json

import meshio
import numpy as np
import pytest

from felupe_studio._helpers import run_mesh_script
from felupe_studio.codegen import codegen
from felupe_studio.commands import errors
from felupe_studio.meshes import _summary, make

# a soft block 0 <= x, y, z <= 1 and a sheet on top of it, or the sheet as an
# expression of the dict of the script
SCRIPT = """import felupe as fem
import meshio
import numpy as np

soft = fem.Cube(n=3)
sheet = fem.Cube(a=(0, 0, 1), b=(1, 1, 1.25), n=(3, 3, 2))
mesh = {{"soft": soft, "metal": {metal}}}
"""

# one degenerate cell on the middle point of the soft block
DEGENERATE = (
    "fem.Mesh(points=np.full((1, 3), 0.5), cells=np.zeros((1, 8), dtype=int), "
    'cell_type="hexahedron")'
)

EMPTY = {
    "fem.Mesh": 'fem.Mesh(np.zeros((0, 3)), np.zeros((0, 8), dtype=int), "hexahedron")',
    "fem.MeshContainer": (
        "fem.MeshContainer([fem.Mesh(np.zeros((0, 3)), np.zeros((0, 4), dtype=int), "
        '"tetra")])'
    ),
    "meshio.Mesh": "meshio.Mesh(np.zeros((0, 3)), [])",
    "meshio.Mesh with an empty block": (
        'meshio.Mesh(np.zeros((0, 3)), [("hexahedron", np.zeros((0, 8), dtype=int))])'
    ),
}


@pytest.fixture
def folder(tmp_path, monkeypatch):
    monkeypatch.chdir(tmp_path)
    return tmp_path


def script(folder, metal):
    (folder / "parts.py").write_text(SCRIPT.format(metal=metal), encoding="utf-8")


def model(metal=True):
    """The soft block, fixed at x = 0 and pulled at x = 1, with the metal part of the
    script as the section ``sheets``, left out of the step, or without it."""
    commands = [
        {
            "command": "mesh.script",
            "name": "soft_mesh",
            "file": "parts.py",
            "item": "soft",
        },
        {"command": "cellset.from_file", "name": "soft_cells", "mesh": "soft_mesh"},
        {
            "command": "material.add",
            "name": "rubber",
            "model": "NeoHookeCompressible",
            "parameters": {"mu": 1.0, "lmbda": 2.0},
        },
        {
            "command": "section.add",
            "name": "soft",
            "cellset": "soft_cells",
            "material": "rubber",
            "formulation": "u",
        },
    ]
    if metal:
        commands += [
            {
                "command": "mesh.script",
                "name": "metal_mesh",
                "file": "parts.py",
                "item": "metal",
            },
            {
                "command": "cellset.from_file",
                "name": "metal_cells",
                "mesh": "metal_mesh",
            },
            {
                "command": "material.add",
                "name": "steel",
                "model": "LinearElasticLargeStrain",
                "parameters": {"E": 210.0, "nu": 0.3},
            },
            {
                "command": "section.add",
                "name": "sheets",
                "cellset": "metal_cells",
                "material": "steel",
                "formulation": "u",
            },
        ]
    step = {
        "command": "step.add",
        "name": "pull",
        "ramp": {"num": 3, "items": [{"target": "move", "start": 0, "end": 0.3}]},
    }
    if metal:
        step["sections"] = ["soft"]
    commands += [
        {
            "command": "pointset.add",
            "name": "left",
            "select": {"axis": "x", "value": 0},
        },
        {
            "command": "pointset.add",
            "name": "right",
            "select": {"axis": "x", "value": 1},
        },
        {
            "command": "boundary.add",
            "name": "fixed",
            "pointset": "left",
            "constrained": ["x", "y", "z"],
        },
        {
            "command": "boundary.add",
            "name": "move",
            "pointset": "right",
            "constrained": ["x"],
        },
        step,
        {"command": "job.add", "name": "job", "steps": ["pull"], "curve": "move"},
    ]
    return {"schema_version": 3, "commands": commands}


def run(document):
    """The namespace of the script of a command list, after its jobs."""
    assert errors(document) == []
    namespace = {}
    with contextlib.redirect_stdout(io.StringIO()):
        exec(codegen(document), namespace)  # noqa: S102
    return namespace


@pytest.mark.parametrize("metal", list(EMPTY.values()), ids=list(EMPTY))
def test_an_empty_mesh_of_a_script(folder, metal):
    """An empty item of the dict of a script is an error of the script with its
    message, in the app and in the generated script, not an exception of the
    summary."""
    script(folder, metal)
    info = json.loads(make("parts.py", {}, "metal")[0])
    message = info["error"]
    assert message.startswith(
        "ValueError: The mesh 'metal' of 'parts.py' has no cells. Make an empty part "
        "one degenerate cell of its cell type, e.g. fem.Mesh("
    )
    assert message.endswith("): its section has no volume and is off in every step.")
    assert info["traceback"].endswith(message + "\n")
    assert "solids" not in info
    with pytest.raises(ValueError, match="has no cells"):
        run_mesh_script("parts.py", {}, "metal")
    with pytest.raises(ValueError, match="The mesh 'metal' of 'parts.py' has no cells"):
        run(model())


def test_the_example_of_the_message_is_of_the_cell_type(folder):
    """The degenerate cell of the message has the cell type of the empty mesh, of 3D
    or 2D cells, and that of hexahedrons without a cell block."""
    quads = 'fem.Mesh(np.zeros((0, 2)), np.zeros((0, 4), dtype=int), "quad")'
    expected = [
        (EMPTY["fem.Mesh"], 3, 8, "hexahedron"),
        (EMPTY["fem.MeshContainer"], 3, 4, "tetra"),
        (EMPTY["meshio.Mesh"], 3, 8, "hexahedron"),
        (quads, 2, 4, "quad"),
    ]
    for metal, dim, npoints, cell_type in expected:
        script(folder, metal)
        message = json.loads(make("parts.py", {}, "metal")[0])["error"]
        assert (
            f"e.g. fem.Mesh(points=np.zeros((1, {dim})), cells=np.zeros((1, "
            f'{npoints}), dtype=int), cell_type="{cell_type}"): its section'
        ) in message
    # a mesh that is not an item of a dict
    (folder / "alone.py").write_text("import meshio\nmesh = meshio.Mesh([], [])\n")
    message = json.loads(make("alone.py", {})[0])["error"]
    assert message.startswith("ValueError: The mesh of 'alone.py' has no cells.")


def test_the_summary_of_a_degenerate_cell(folder):
    """A degenerate cell is a mesh of one point and one cell, without an error and
    without volume (#429)."""
    script(folder, DEGENERATE)
    info = json.loads(make("parts.py", {}, "metal")[0])
    assert "error" not in info
    assert info["points"] == 1
    assert info["solids"] == [
        {
            "cell_type": "hexahedron",
            "cells": 1,
            "volume": 0.0,
            "bounds": [[0.5, 0.5, 0.5], [0.5, 0.5, 0.5]],
            "tags": [],
        }
    ]


# the region of a degenerate cell divides by its volume 0
@pytest.mark.filterwarnings("ignore:invalid value encountered:RuntimeWarning")
def test_a_degenerate_cell_left_out_of_the_step(folder):
    """The example of #418: the sheet is one degenerate cell on a point of the soft
    block (merged with it), its section left out of the step. The force is the one
    of the soft block alone."""
    script(folder, DEGENERATE)
    degenerate = run(model())
    without = run(model(metal=False))
    forces = [np.array(namespace["job"].y)[:, 0] for namespace in (degenerate, without)]
    assert forces[1][-1] > 0.1
    np.testing.assert_allclose(forces[0], forces[1], rtol=1e-8, atol=1e-12)


def test_a_mesh_of_empty_cell_blocks():
    """A mesh whose cell blocks have no cells has no cells, like a mesh without cell
    blocks, e.g. a mesh of the tools of FElupe (meshio cannot read such a file)."""
    empty = meshio.Mesh(np.zeros((0, 3)), [("hexahedron", np.zeros((0, 8), dtype=int))])
    info, solids = _summary(empty, {"file": "empty"})
    assert info["error"] == "The file has no cells."
    assert info["blocks"] == [{"type": "hexahedron", "cells": 0}]
    assert solids == {}
