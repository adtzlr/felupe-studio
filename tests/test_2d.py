"""2D models: plane strain and axisymmetric (#175)."""

import copy
import json
from pathlib import Path

import felupe as fem
import meshio
import numpy as np
import pytest

from felupe_studio import results
from felupe_studio.codegen import codegen
from felupe_studio.commands import analysis_problems, errors
from felupe_studio.runner import LAST, run

GOLDEN = Path(__file__).parent / "golden"


def document(case="plate_plane_strain"):
    text = (GOLDEN / case / "commands.json").read_text(encoding="utf-8")
    return json.loads(text)


def with_mesh(tmp_path, monkeypatch, mesh, analysis, formulation="u"):
    """The plate of the golden case with another mesh, analysis and formulation."""
    meshio.Mesh(
        np.pad(mesh.points, ((0, 0), (0, 1))), [(mesh.cell_type, mesh.cells)]
    ).write(tmp_path / "plate.vtu")
    monkeypatch.chdir(tmp_path)
    doc = copy.deepcopy(document())
    for cmd in doc["commands"]:
        if cmd["command"] == "model.settings":
            cmd["analysis"] = analysis
        if cmd["command"] == "section.add":
            cmd["formulation"] = formulation
            if formulation == "u-p-J":
                cmd["bulk"] = 5.0
        if cmd["command"] == "step.add":
            cmd["ramp"]["num"] = 2
            cmd["ramp"]["items"][0]["end"] = 0.2
    return doc


def test_script_of_a_2d_model():
    script = codegen(document())
    assert (
        "# plane strain in the xy-plane: the forces are per unit thickness in z"
        in script
    )
    assert "fem.FieldContainer([fem.FieldPlaneStrain(region_body, dim=2)])" in script
    axisymmetric = codegen(document("cylinder_axisymmetric"))
    assert "fem.FieldAxisymmetric(region_body, dim=2)" in axisymmetric
    assert "# axisymmetric: x is the axis of rotation, y the radius" in axisymmetric


@pytest.mark.parametrize("analysis", ["plane-strain", "axisymmetric"])
@pytest.mark.parametrize(
    "cells, formulation",
    [
        ("quad", "u"),
        ("quad", "u-p-J"),
        ("triangle", "u"),
        ("triangle", "u-p-J"),
        ("quad8", "u"),
        ("quad9", "u-p-J"),
        ("triangle6", "u"),
    ],
)
def test_runs_2d_cells(tmp_path, monkeypatch, analysis, cells, formulation):
    mesh = fem.Rectangle(b=(3, 1), n=(4, 3))
    if cells.startswith("triangle"):
        mesh = mesh.triangulate()
    if cells in ("quad8", "triangle6"):
        mesh = fem.mesh.convert(mesh, order=2)
    if cells == "quad9":
        mesh = fem.mesh.convert(mesh, order=2, calc_midfaces=True)
    assert mesh.cell_type == cells
    doc = with_mesh(tmp_path, monkeypatch, mesh, analysis, formulation)
    if formulation == "u-p-J":
        script = codegen(doc)
        flag = "planestrain" if analysis == "plane-strain" else "axisymmetric"
        assert f"fem.FieldsMixed(region_body, n=3, {flag}=True)" in script
    result = run(doc)["job_1"]
    assert result["substeps"] == 3
    assert result["y"][-1][0] > 0
    # the results in the plane z = 0, with the out-of-plane stress
    meta, surfaces = results.scene("job_1", 3, "displacement_z")
    positions = np.frombuffer(surfaces[0]["positions"], "<f4").reshape(-1, 3)
    displacement = np.frombuffer(surfaces[0]["displacement"], "<f4").reshape(-1, 3)
    assert np.all(positions[:, 2] == 0) and np.all(displacement[:, 2] == 0)
    assert positions[:, :2].max(axis=0) == pytest.approx([3, 1])
    meta, _ = results.scene("job_1", 3, "stress_min")
    assert json.loads(meta)["range"] is not None
    for file_format in ("vtu", "xdmf"):
        assert results.export("job_1", file_format, 3)


def pressure_document(analysis, select):
    """A plate (a cylinder of radius 1) pulled by a pressure at its end x = 3."""
    commands = [
        {"command": "model.settings", "name": "settings", "analysis": analysis},
        {"command": "mesh.import", "name": "plate", "file": "plate.vtu"},
        {"command": "cellset.from_file", "name": "all_cells", "mesh": "plate"},
        {
            "command": "material.add",
            "name": "rubber",
            "model": "NeoHookeCompressible",
            "parameters": {"mu": 1.0, "lmbda": 2.0},
        },
        {
            "command": "section.add",
            "name": "body",
            "cellset": "all_cells",
            "material": "rubber",
            "formulation": "u",
        },
        {
            "command": "pointset.add",
            "name": "x_min",
            "select": {"axis": "x", "value": 0},
        },
        {
            "command": "pointset.add",
            "name": "y_min",
            "select": {"axis": "y", "value": 0},
        },
        {"command": "faceset.add", "name": "end", "section": "body", "select": select},
        {
            "command": "boundary.add",
            "name": "sym_x",
            "pointset": "x_min",
            "constrained": ["x"],
        },
        {
            "command": "boundary.add",
            "name": "sym_y",
            "pointset": "y_min",
            "constrained": ["y"],
        },
        {"command": "pressure.add", "name": "pull", "faces": "end", "pressure": -1e-3},
        {
            "command": "step.add",
            "name": "step_1",
            "ramp": {"num": 1, "items": [{"target": "pull", "end": 1}]},
        },
        {"command": "job.add", "name": "job_1", "steps": ["step_1"], "curve": "sym_x"},
    ]
    return {"schema_version": 3, "commands": commands}


@pytest.mark.parametrize("analysis", ["plane-strain", "axisymmetric"])
@pytest.mark.parametrize("cells", ["quad", "quad8", "quad9"])
@pytest.mark.parametrize("picked", [False, True])
def test_pressures_on_edges(tmp_path, monkeypatch, analysis, cells, picked):
    # the face sets of 2D models are edges of quads (#175)
    mesh = fem.Rectangle(b=(3, 1), n=(4, 5))
    if cells != "quad":
        mesh = fem.mesh.convert(mesh, order=2, calc_midfaces=cells == "quad9")
    meshio.Mesh(
        np.pad(mesh.points, ((0, 0), (0, 1))), [(mesh.cell_type, mesh.cells)]
    ).write(tmp_path / "plate.vtu")
    monkeypatch.chdir(tmp_path)
    # the end by its plane, or by the centers of its edges (in the plane z = 0)
    centers = [[3, y, 0] for y in (0.125, 0.375, 0.625, 0.875)]
    select = {"centers": centers} if picked else {"axis": "x", "value": 3}
    doc = pressure_document(analysis, select)
    assert errors(doc) == []
    script = codegen(doc)
    field = "FieldPlaneStrain" if analysis == "plane-strain" else "FieldAxisymmetric"
    assert f"fem.FieldContainer([fem.{field}(region_end, dim=2)])" in script
    if picked:
        assert "[3, 0.125]," in script
    # the reaction force at x = 0 is the pressure times the area of the end: per unit
    # thickness, or over the circumference of the cylinder of radius 1
    area = 1 if analysis == "plane-strain" else np.pi
    force = run(doc)["job_1"]["y"][-1][0]
    assert abs(force) == pytest.approx(1e-3 * area, rel=1e-3)


def test_edges_of_triangles(tmp_path, monkeypatch):
    # FElupe 12 has no boundary regions of triangles
    mesh = fem.Rectangle(b=(3, 1), n=(4, 5)).triangulate()
    meshio.Mesh(
        np.pad(mesh.points, ((0, 0), (0, 1))), [(mesh.cell_type, mesh.cells)]
    ).write(tmp_path / "plate.vtu")
    monkeypatch.chdir(tmp_path)
    doc = pressure_document("plane-strain", {"axis": "x", "value": 3})
    with pytest.raises(NotImplementedError, match="triangle cells have no boundary"):
        run(doc)


def test_rotation_point_of_a_2d_model(tmp_path, monkeypatch):
    # a rigid end turned about z by a rotation point (#175): the curve and the results
    # of the control points have the rotation and the moment about z
    doc = document("plate_rotation_plane_strain")
    for name in ("plate.vtu",):
        (tmp_path / name).write_bytes(
            (GOLDEN / "plate_rotation_plane_strain" / name).read_bytes()
        )
    monkeypatch.chdir(tmp_path)
    for cmd in doc["commands"]:
        if cmd["command"] == "step.add":
            cmd["ramp"]["num"] = 2
    result = run(doc)["job_1"]
    assert [x[:2] for x in result["x"]] == [[0, 0]] * 3
    assert result["x"][-1][2] == pytest.approx(0.1)
    assert result["y"][-1][2] > 0
    csv = results.export("job_1", "csv").decode().splitlines()
    assert csv[0].startswith("substep,center.u_x,center.u_y,center.u_z,center.F_x")
    assert "pivot.phi_z [rad]" in csv[0]
    last = dict(zip(csv[0].split(","), map(float, csv[-1].split(",")), strict=True))
    assert last["pivot.phi_z [rad]"] == pytest.approx(0.1)
    assert (
        last["pivot.phi_x [rad]"]
        == last["pivot.phi_y [rad]"]
        == last["center.u_z"]
        == 0
    )
    assert last["pivot.M_z"] == pytest.approx(result["y"][-1][2], rel=1e-6)
    # the control points of the scenes, in the plane z = 0
    meta = json.loads(results.scene("job_1", 3, "displacement")[0])
    pivot = next(p for p in meta["points"] if p["name"] == "pivot")
    assert pivot["position"] == [3.5, 0.6, 0] and pivot["rotation"]
    assert pivot["displacement"][2] == pytest.approx(0.1)
    # the end turns rigidly about the center
    field = LAST["field"]
    points = field.mesh_container.points
    end = np.isclose(points[:, 0], 3)
    angle = 0.1
    rotation = np.array(
        [[np.cos(angle), -np.sin(angle)], [np.sin(angle), np.cos(angle)]]
    )
    arms = points[end] - [3.5, 0.5]
    expected = arms @ rotation.T - arms
    np.testing.assert_allclose(field[0].values[end], expected, atol=1e-4)


def test_problems_of_2d_models():
    def problems(cmd, analysis="axisymmetric", rotations=()):
        return analysis_problems({"name": "a", **cmd}, analysis, rotations)

    assert problems({"command": "boundary.add", "constrained": ["x", "y"]}) == []
    assert problems({"command": "boundary.add", "constrained": ["z"]}) == [
        "boundary 'a' constrains z, which a 2D model does not have."
    ]
    assert problems({"command": "load.add", "force": [0, 1, 2]})
    assert problems({"command": "load.add", "force": [0, 1, 0]}) == []
    assert problems({"command": "symmetry.add", "axes": ["x", "z"]})
    assert problems({"command": "loadcase.add", "type": "shear", "normal": "z"})
    assert problems({"command": "loadcase.add", "type": "uniaxial"}) == []
    assert problems({"command": "pointset.add", "select": {"axis": "z", "value": 0}})
    assert problems(
        {"command": "pointset.add", "select": {"bound": "max", "axis": "z"}}
    )
    assert problems({"command": "pointset.add", "select": {"radius": 1, "axis": "x"}})
    assert (
        problems({"command": "pointset.add", "select": {"radius": 1, "axis": "z"}})
        == []
    )
    assert problems({"command": "pointset.add", "select": {"points": [[0, 1, 2]]}})
    assert (
        problems({"command": "pointset.add", "select": {"points": [[0, 1, 0]]}}) == []
    )
    # control points and constraints in the xy-plane, rotations about z
    assert problems({"command": "point.add", "coordinates": [1, 2, 3]})
    assert problems({"command": "point.add", "coordinates": [1, 2, 0]}) == []
    mpc = {"command": "mpc.add", "constrained": ["x", "y"], "rotation": "r"}
    assert problems(mpc, "plane-strain") == []
    assert problems(mpc) == [
        "constraint 'a' has a rotation point: a rotation about z is no motion of an "
        "axisymmetric model."
    ]
    assert problems({"command": "mpc.add", "constrained": ["x", "z"]}) == [
        "constraint 'a' connects z, which a 2D model does not have."
    ]
    turn = {"command": "boundary.add", "pointset": "r", "constrained": ["z"]}
    assert problems(turn, "plane-strain", {"r"}) == []
    assert problems(turn, "plane-strain") == [
        "boundary 'a' constrains z, which a 2D model does not have."
    ]
    assert problems({**turn, "constrained": ["x", "z"]}, "plane-strain", {"r"}) == [
        "boundary 'a' constrains x of the rotation point 'r': the rotation point of a "
        "2D model has the rotation about z only."
    ]
    moment = {"command": "load.add", "points": "r", "force": [0, 0, 1]}
    assert problems(moment, "plane-strain", {"r"}) == []
    assert problems({**moment, "force": [1, 0, 1]}, "plane-strain", {"r"})
    # face sets of edges in the xy-plane
    assert problems({"command": "faceset.add", "select": {"axis": "z", "value": 0}})
    assert problems({"command": "faceset.add", "select": {"centers": [[3, 1, 1]]}})
    assert (
        problems({"command": "faceset.add", "select": {"centers": [[3, 1, 0]]}}) == []
    )
    assert problems({"command": "pressure.add", "pressure": 1.0}) == []
    assert problems({"command": "mesh.import", "cell_type": "tetra"}) == [
        "mesh 'a' takes tetra cells, but a 2D model has 2D cells."
    ]
    assert problems({"command": "mesh.import", "cell_type": "quad"}, "3d") == [
        "mesh 'a' takes quad cells, which are 2D cells: set the analysis of the "
        "settings to plane strain or axisymmetric."
    ]
    # the errors of a command list, with its index
    doc = document()
    doc["commands"].append(
        {
            "command": "boundary.add",
            "name": "fixed",
            "pointset": "x",
            "constrained": ["z"],
        }
    )
    assert any(
        e.endswith("boundary 'fixed' constrains z, which a 2D model does not have.")
        for e in errors(doc)
    )
