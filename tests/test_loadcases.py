import runpy
from pathlib import Path

import felupe as fem
import meshio
import numpy as np
import pytest

from felupe_studio.codegen import codegen
from felupe_studio.commands import errors
from felupe_studio.loadcases import loadcase_call, moving, problems


def model(loadcase, end=0.2, mesh=None):
    """A cube of an incompressible Neo-Hookean material with a load case."""
    return {
        "schema_version": 2,
        "commands": [
            {"command": "mesh.import", "name": "cube", "file": "cube.vtu"},
            {"command": "cellset.from_file", "name": "all", "mesh": "cube"},
            {
                "command": "material.add",
                "name": "rubber",
                "model": "NeoHooke",
                "parameters": {"mu": 1.0},
            },
            {
                "command": "section.add",
                "name": "body",
                "cellset": "all",
                "material": "rubber",
                "formulation": "u-p-J",
                "bulk": 5000.0,
            },
            {"command": "loadcase.add", "name": "test", **loadcase},
            {
                "command": "step.add",
                "name": "step_1",
                "ramp": {"num": 4, "items": [{"target": "test", "end": end}]},
            },
            {
                "command": "job.add",
                "name": "job_1",
                "steps": ["step_1"],
                "curve": "test",
            },
        ],
    }


def run(document, directory, monkeypatch, mesh=None):
    mesh = mesh or fem.Cube(n=4)
    meshio.Mesh(mesh.points, [(mesh.cell_type, mesh.cells)]).write(
        Path(directory) / "cube.vtu"
    )
    script = Path(directory) / "script.py"
    script.write_text(codegen(document), encoding="utf-8")
    monkeypatch.chdir(directory)
    return runpy.run_path(str(script))


def test_calls():
    assert loadcase_call({"type": "uniaxial"}) == (
        "fem.dof.uniaxial",
        ["field", "axis=0", "move=0.0"],
    )
    assert loadcase_call(
        {"type": "planar", "axis": "y", "second": "z", "clamped": True}
    ) == (
        "fem.dof.biaxial",
        ["field", "axes=(1, 2)", "clampes=(True, True)", "moves=(0.0, 0.0)"],
    )
    assert loadcase_call({"type": "shear", "symmetry": False, "compression": -0.1}) == (
        "fem.dof.shear",
        ["field", "axes=(0, 1)", "sym=False", "moves=(0.0, 0.0, -0.1)"],
    )


def test_moving_end_faces():
    assert moving({"type": "uniaxial"}) == [("move", 1)]
    assert moving({"type": "planar", "axis": "z"}) == [("move-right-2", 1)]
    assert moving({"type": "biaxial", "symmetry": False}) == [
        ("move-right-0", 1),
        ("move-right-1", 1),
        ("move-left-0", -1),
        ("move-left-1", -1),
    ]


def test_problems():
    assert problems({"name": "a", "type": "shear", "normal": "x"}) == [
        "load case 'a' needs different axes for 'axis' and 'normal'."
    ]
    assert "free" in problems({"name": "a", "type": "biaxial", "symmetry": False})[0]
    assert (
        problems({"name": "a", "type": "uniaxial", "symmetry": False, "clamped": True})
        == []
    )
    document = model({"type": "biaxial", "second": "x"})
    assert errors(document) == [
        "commands/4: load case 'test' needs different axes for 'axis' and 'second'."
    ]


@pytest.mark.parametrize(
    "kind, analytical",
    [
        # nominal stress of an incompressible Neo-Hookean material at a stretch of 1.2
        ("uniaxial", lambda s: s - s**-2),
        ("planar", lambda s: s - s**-3),
        ("biaxial", lambda s: s - s**-5),
    ],
)
def test_homogeneous_tests_of_a_cube(kind, analytical, tmp_path, monkeypatch):
    # an eighth of a cube with symmetry planes: a homogeneous deformation
    namespace = run(model({"type": kind}), tmp_path, monkeypatch)
    force = np.array(namespace["job_1"].y)[:, 0]
    np.testing.assert_allclose(force[-1], analytical(1.2), rtol=2e-3)


def test_shear(tmp_path, monkeypatch):
    namespace = run(model({"type": "shear"}, end=0.1), tmp_path, monkeypatch)
    force = np.array(namespace["job_1"].y)[:, 0]
    # close to the shear modulus times the shear strain (free lateral faces)
    assert 0.07 < force[-1] < 0.13


def test_like_explicit_boundaries(tmp_path, monkeypatch):
    # a clamped uniaxial test of the whole bar equals explicit boundaries
    bar = fem.Cube(b=(3, 1, 1), n=(7, 3, 3))
    clamped = model({"type": "uniaxial", "clamped": True, "symmetry": False})
    forces = [run(clamped, tmp_path, monkeypatch, mesh=bar)]

    explicit = model({"type": "uniaxial"})
    explicit["commands"][4:] = [
        {
            "command": "pointset.add",
            "name": "left",
            "select": {"axis": "x", "value": 0},
        },
        {
            "command": "pointset.add",
            "name": "right",
            "select": {"axis": "x", "value": 3},
        },
        {
            "command": "boundary.add",
            "name": "fixed",
            "pointset": "left",
            "constrained": ["x", "y", "z"],
        },
        {
            "command": "boundary.add",
            "name": "lateral",
            "pointset": "right",
            "constrained": ["y", "z"],
        },
        {
            "command": "boundary.add",
            "name": "move",
            "pointset": "right",
            "constrained": ["x"],
        },
        {
            "command": "step.add",
            "name": "step_1",
            "ramp": {"num": 4, "items": [{"target": "move", "end": 0.2}]},
        },
        {"command": "job.add", "name": "job_1", "steps": ["step_1"], "curve": "move"},
    ]
    forces.append(run(explicit, tmp_path, monkeypatch, mesh=bar))
    a, b = (np.array(ns["job_1"].y)[:, 0] for ns in forces)
    np.testing.assert_allclose(a, b, rtol=1e-10)
    assert a[-1] > 0


def test_biaxial_without_symmetry_moves_both_ends(tmp_path, monkeypatch):
    loadcase = {"type": "biaxial", "symmetry": False, "clamped": True}
    script = codegen(model(loadcase))
    assert 'boundaries["test/move-left-0"]: -ramp_step_1' in script
    namespace = run(model(loadcase), tmp_path, monkeypatch, mesh=fem.Cube(n=3))
    u = namespace["field"][0].values
    points = namespace["field"].mesh_container.points
    # the faces at x = 0 and x = 1 move apart by 2 * 0.2 (the edges of the clamped
    # faces normal to y keep x, like in fem.dof.biaxial)
    inner = ~np.isclose(points[:, 1], 0) & ~np.isclose(points[:, 1], 1)
    left = np.isclose(points[:, 0], 0) & inner
    right = np.isclose(points[:, 0], 1) & inner
    np.testing.assert_allclose(u[left, 0], -0.2)
    np.testing.assert_allclose(u[right, 0], 0.2)
