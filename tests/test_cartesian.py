"""The Cartesian constraints (#421): points held or moved in the directions of a
rotated coordinate system (``fem.CartesianConstraint``), in the script, in the steps
and as the curve of a job."""

import copy
import json
from pathlib import Path

import felupe as fem
import numpy as np
import pytest

from felupe_studio.cartesian import base_vectors
from felupe_studio.codegen import codegen
from felupe_studio.commands import errors
from felupe_studio.directions import components
from felupe_studio.runner import curve_row, frames, run

GOLDEN = Path(__file__).parent / "golden"


def load(case):
    return json.loads((GOLDEN / case / "commands.json").read_text(encoding="utf-8"))


def find(document, name):
    return next(c for c in document["commands"] if c["name"] == name)


def test_block_on_an_inclined_plane_like_felupe():
    # a cube rotated by 30° about y rests on an inclined plane: its bottom points
    # are held normal to the plane only and slide on it, while its top is pressed
    # down by a plate (the example of fem.CartesianConstraint)
    result = run(load("block_inclined_plane"))["job_1"]

    mesh = fem.Cube(n=4).rotate(30, axis=1)
    region = fem.RegionHexahedron(mesh)
    displacement = fem.Field(region, dim=3)
    field = fem.FieldContainer([displacement])
    solid = fem.SolidBody(fem.NeoHooke(mu=1.0, bulk=5.0), field)
    rotation = fem.math.rotation_matrix(30, dim=3, axis=1)
    local = mesh.points @ rotation
    support = fem.CartesianConstraint(
        field, points=np.isclose(local[:, 2], 0), rotation=rotation, skip=(1, 1, 0)
    )
    top = np.isclose(local[:, 2], 1)
    boundaries = {
        "plate": fem.Boundary(displacement, mask=top, skip=(0, 0, 1)),
        "move": fem.Boundary(displacement, mask=top, skip=(1, 1, 0)),
    }
    move = fem.math.linsteps([0, -0.3], num=5)
    step = fem.Step(
        [solid, support], ramp={boundaries["move"]: move}, boundaries=boundaries
    )
    job = fem.CharacteristicCurve(steps=[step], boundary=support, items=[solid])
    job.evaluate(tol=1.49e-8, verbose=0)

    # the curve in the directions of the plane: the normal force in 3
    np.testing.assert_allclose(
        result["y"], np.array(job.y) @ rotation, rtol=1e-6, atol=1e-10
    )
    np.testing.assert_allclose(
        result["x"], np.array(job.x) @ rotation, rtol=1e-6, atol=1e-10
    )
    normal = np.array(result["y"])[:, 2]
    assert normal[-1] > 0.2
    # the points slide on the plane: free in 1, held (up to the gap) in 3
    u = displacement.values[support.points] @ rotation
    assert np.abs(u[:, 0]).max() > 1e-2
    assert np.abs(u[:, 2]).max() < 1e-3 * np.abs(u[:, 0]).max() + 1e-4


def test_ramp_of_a_constraint_in_2d():
    # a plate in plane strain, rotated by 30°: its bottom points are moved normal to
    # the inclined line of e1 by a ramp, its top is fixed
    document = load("plate_inclined_plane_strain")
    result = run(document)["job_1"]
    u, force = np.array(result["x"]), np.array(result["y"])
    # the points follow the ramp in 2 within the gap of the penalty
    np.testing.assert_allclose(u[:, 1], np.linspace(0, 0.2, 5), atol=1e-4)
    assert np.all(np.diff(force[:, 1]) > 0)

    mesh = fem.Rectangle(n=4).rotate(30, axis=2)
    region = fem.RegionQuad(mesh)
    field = fem.FieldContainer([fem.FieldPlaneStrain(region, dim=2)])
    solid = fem.SolidBody(fem.NeoHooke(mu=1.0, bulk=5.0), field)
    e1 = [np.cos(np.pi / 6), np.sin(np.pi / 6)]
    rotation = np.array([[e1[0], -e1[1]], [e1[1], e1[0]]])
    local = mesh.points @ rotation
    support = fem.CartesianConstraint(
        field,
        points=np.isclose(local[:, 1], 0),
        rotation=rotation,
        skip=(1, 0),
        multiplier=1e4,
    )
    boundaries = {"fixed": fem.Boundary(field[0], mask=np.isclose(local[:, 1], 1))}
    table = np.linspace([0, 0], [0, 0.2], 5)
    step = fem.Step([solid, support], ramp={support: table}, boundaries=boundaries)
    job = fem.CharacteristicCurve(steps=[step], boundary=support, items=[solid])
    job.evaluate(tol=1.49e-8, verbose=0)
    np.testing.assert_allclose(force, np.array(job.y) @ rotation, rtol=1e-6, atol=1e-12)


def test_script_of_a_constraint():
    script = codegen(load("block_inclined_plane"))
    assert "def base_vectors(e1, e2=None):" in script
    assert "support = fem.CartesianConstraint(\n    field," in script
    assert "    skip=(1, 1, 0),\n" in script
    assert "boundary=support, items=[solid_body]" in script
    # the expressions of the parameters as written (#242)
    assert "(np.cos(angle * np.pi / 180)), 0, (-np.sin(angle * np.pi / 180))" in script
    # in 2D, e1 only (e2 is e1 turned by 90°), and the table of a ramp
    script = codegen(load("plate_inclined_plane_strain"))
    assert "rotation=base_vectors([0.8660254037844387, 0.5])," in script
    assert "ramp_lift = np.linspace([0, 0], [0, 0.2], 5)" in script
    assert "ramp={support: ramp_lift}" in script
    # the helper only with a Cartesian constraint
    assert "base_vectors" not in codegen(load("bar_single_body"))


def test_values_and_ramps_of_the_directions():
    document = load("block_inclined_plane")
    support = find(document, "support")
    support.update(constrained=["3", "1"], value=[0.1, -0.2], multiplier=1e4)
    find(document, "press")["ramp"]["items"].append(
        {"target": "support", "start": 0.1, "end": [0.3, 0]}
    )
    assert not errors(document)
    script = codegen(document)
    # the values of the constrained directions, in the order 1, 2, 3, and 0 of the
    # free one
    assert "displacement=[0.1, 0, -0.2]," in script
    assert "np.linspace([0.1, 0, 0.1], [0.3, 0, 0], 6),  # support" in script
    assert "multiplier=10000.0," in script


def test_a_step_without_the_constraint():
    document = load("block_inclined_plane")
    lift = copy.deepcopy(find(document, "press"))
    lift.update(name="lift", constraints=["glue"])
    document["commands"][-1:-1] = [
        {
            "command": "mpc.add",
            "name": "glue",
            "points": "top",
            "center": "bottom",
            "constrained": ["x"],
        },
        lift,
    ]
    del lift["ramp"]
    script = codegen(document, evaluate=False)
    assert "lift = fem.Step(\n    items=[solid_body, glue]," in script
    # a step that ramps it must have it
    lift["ramp"] = {"num": 1, "items": [{"target": "support", "end": 0.1}]}
    assert errors(document) == [
        "commands/13: step 'lift' ramps 'support', which is off in it."
    ]


def test_base_vectors():
    # normalized, e3 = e1 x e2; in 2D e2 is e1 turned by 90°
    vectors = base_vectors({"e1": [0, 0, 3], "e2": [2, 0, 0]})
    np.testing.assert_allclose(vectors, [[0, 0, 1], [1, 0, 0], [0, 1, 0]])
    np.testing.assert_allclose(
        base_vectors({"e1": [1, 1, 0]}, dim=2),
        np.array([[1, 1], [-1, 1]]) / np.sqrt(2),
    )
    assert base_vectors({"e1": [0, 0, 0]}) is None
    # like the helper of the script
    namespace = {}
    exec(codegen(load("block_inclined_plane"), evaluate=False), namespace)
    np.testing.assert_allclose(
        namespace["base_vectors"]([0, 0, 3], [2, 0, 0]), np.transpose(vectors)
    )
    np.testing.assert_allclose(
        namespace["base_vectors"]([1, 1]),
        np.transpose(base_vectors({"e1": [1, 1, 0]}, dim=2)),
    )


@pytest.mark.parametrize(
    ("value", "expected"),
    [(0.5, [0.5, 0, 0.5]), ([1, 2], [1, 0, 2])],
)
def test_components(value, expected):
    command = {"command": "cartesian.add", "constrained": ["1", "3"]}
    assert components(command, value) == expected


def test_curves_in_the_directions_of_the_constraint():
    commands = load("plate_inclined_plane_strain")["commands"]
    frame = frames(commands)["job_1"]
    np.testing.assert_allclose(frame, [[np.sqrt(3) / 2, 0.5], [-0.5, np.sqrt(3) / 2]])
    # a force along e2 in global components is (0, 1) in the directions 1 and 2
    np.testing.assert_allclose(curve_row(frame[1], frame=frame), [0, 1], atol=1e-15)
