"""The cylindrical constraints (#422): points held or moved radially, around and along
an axis (``fem.CylindricalConstraint``), in the script, in the steps and as the curve
of a job, recorded in the directions r, theta and z of its points."""

import json
from pathlib import Path
from types import SimpleNamespace

import felupe as fem
import numpy as np
import pytest
from scipy.sparse import csr_matrix

from felupe_studio._helpers import CylindricalCurve, CylindricalCurvePlugin
from felupe_studio.codegen import codegen
from felupe_studio.commands import errors
from felupe_studio.directions import components, first_moved, skip
from felupe_studio.runner import run

GOLDEN = Path(__file__).parent / "golden"


def load(case):
    return json.loads((GOLDEN / case / "commands.json").read_text(encoding="utf-8"))


def find(document, name):
    return next(c for c in document["commands"] if c["name"] == name)


def tube():
    """The tube of the golden case: a rectangle revolved about x, of rubber."""
    mesh = fem.Rectangle(a=(0, 1), b=(3, 2), n=(7, 3)).revolve(n=25, phi=360, axis=0)
    field = fem.FieldContainer([fem.Field(fem.RegionHexahedron(mesh), dim=3)])
    solid = fem.SolidBody(fem.NeoHooke(mu=1.0, bulk=5.0), field)
    return mesh, field, solid


def test_tube_in_a_sleeve_turned_at_its_end_like_felupe():
    # the end x = 0 is fixed, the end x = 3 is turned by an arc length of 0.5 and its
    # outer surface slides in a rigid sleeve (radially only): the example of
    # fem.CylindricalConstraint
    result = run(load("tube_sleeve_torsion"))["job_1"]

    mesh, field, solid = tube()
    radius = np.hypot(mesh.y, mesh.z)
    sleeve = fem.CylindricalConstraint(
        field,
        points=np.flatnonzero(np.isclose(radius, 2)),
        axis=(1, 0, 0),
        skip=(0, 1, 1),
    )
    twist = fem.CylindricalConstraint(
        field, points=np.flatnonzero(np.isclose(mesh.x, 3)), axis=(1, 0, 0)
    )
    boundaries = {"fixed": fem.Boundary(field[0], fx=0)}
    table = np.linspace([0, 0, 0], [0, 0.5, 0], 6)
    step = fem.Step([solid, sleeve, twist], ramp={twist: table}, boundaries=boundaries)
    job = fem.CharacteristicCurve(steps=[step], boundary=twist, items=[solid, sleeve])
    job.evaluate(tol=1.49e-8, verbose=0)

    u, force = np.array(result["x"]), np.array(result["y"])
    # the first point follows the arc length within the gap of the penalty, and the
    # points stay on their radius and their axial position
    np.testing.assert_allclose(u[:, 1], np.linspace(0, 0.5, 6), atol=1e-4)
    np.testing.assert_allclose(u[:, [0, 2]], 0, atol=1e-4)
    # along the axis, the force of FElupe; around it, the moment about the axis
    np.testing.assert_allclose(force[:, 2], np.array(job.y)[:, 0], rtol=1e-6)
    points = twist.points
    forces = (solid.results.force + sleeve.results.force).toarray().reshape(-1, 3)
    x = mesh.points[points] + field[0].values[points]
    e_t = np.cross([1, 0, 0], x * [0, 1, 1])
    e_t /= np.linalg.norm(e_t, axis=1, keepdims=True)
    np.testing.assert_allclose(force[-1, 1], np.sum(forces[points] * e_t), rtol=1e-8)
    moment = fem.tools.moment(field, solid.results.force + sleeve.results.force, twist)
    assert moment[0] > 0 and force[-1, 1] > 0
    # around the axis, the forces of the global components cancel
    assert np.abs(np.array(job.y)[-1, 1:]).max() < 1e-2 * force[-1, 1]


def test_ring_pressed_onto_a_shaft_like_boundaries():
    # a quarter ring in plane strain: its inner points are moved radially by 0.2 by
    # the penalty, like by a boundary with the radial displacement of every point
    result = run(load("ring_press_fit_plane_strain"))["job_1"]

    mesh = fem.mesh.Line(a=1, b=2, n=5).revolve(n=9, phi=90)
    field = fem.FieldContainer([fem.FieldPlaneStrain(fem.RegionQuad(mesh), dim=2)])
    solid = fem.SolidBody(fem.NeoHooke(mu=1.0, bulk=5.0), field)
    inside = np.isclose(np.linalg.norm(mesh.points, axis=1), 1)
    e_r = mesh.points[inside]
    boundaries = fem.dof.symmetry(field[0])
    boundaries["press"] = fem.Boundary(field[0], mask=inside)
    move = [(0.2 * f * e_r).ravel() for f in np.linspace(0, 1, 5)]
    step = fem.Step([solid], ramp={boundaries["press"]: move}, boundaries=boundaries)
    reactions = []
    job = fem.Job(
        [step],
        plugins=[
            lambda context, state: reactions.append(
                np.sum(context.substep.fun.reshape(-1, 2)[inside] * e_r)
            )
        ],
    )
    job.evaluate(tol=1.49e-8, verbose=0)

    u, force = np.array(result["x"]), np.array(result["y"])
    np.testing.assert_allclose(u[:, 0], np.linspace(0, 0.2, 5), atol=1e-5)
    np.testing.assert_allclose(u[:, 1], 0, atol=1e-8)
    # the radial force of the penalty is that of the boundaries
    np.testing.assert_allclose(force[:, 0], reactions, rtol=1e-3, atol=1e-6)
    assert force[-1, 0] > 0.4


def test_script_of_a_constraint():
    script = codegen(load("tube_sleeve_torsion"))
    assert "class CylindricalCurve(fem.CharacteristicCurve):" in script
    assert (
        "sleeve = fem.CylindricalConstraint(\n    field, "
        "points=np.flatnonzero(outside), axis=[1, 0, 0], skip=(0, 1, 1)\n)" in script
    )
    assert "ramp_turn = np.linspace([0, 0, 0], [0, 0.5, 0], 6)" in script
    # the reaction force: the forces of the other items at its points
    assert (
        "job_1 = CylindricalCurve(steps=[turn], boundary=twist, items=[solid_body, "
        "sleeve])" in script
    )
    # in 2D the axis is z, and the center and the directions r and theta
    document = load("ring_press_fit_plane_strain")
    find(document, "shaft").update(center=[0, 0.5, 0], value=0.1)
    script = codegen(document)
    assert (
        "shaft = fem.CylindricalConstraint(\n    field,\n    "
        "points=np.flatnonzero(inside),\n    center=[0, 0.5],\n    "
        "displacement=[0.1, 0],\n    skip=(0, 1),\n    multiplier=10000,\n)" in script
    )


def test_curve_helper_only_with_the_curve_of_a_constraint():
    document = load("tube_sleeve_torsion")
    find(document, "job_1").pop("curve")
    script = codegen(document)
    assert "fem.CylindricalConstraint(" in script
    assert "CylindricalCurve" not in script
    assert "job_1 = fem.Job(steps=[turn])" in script
    assert "CylindricalCurve" not in codegen(load("block_inclined_plane"))


def test_values_and_ramps_of_the_directions():
    document = load("tube_sleeve_torsion")
    twist = find(document, "twist")
    twist.update(constrained=["z", "theta"], value=[0.1, -0.2], multiplier=1e4)
    find(document, "turn")["ramp"]["items"][0].update(start=0.1, end=[0.3, 0])
    assert not errors(document)
    script = codegen(document, evaluate=False)
    # the values of the constrained directions, in the order r, theta, z, and 0 of
    # the free one
    assert "displacement=[0, 0.1, -0.2]," in script
    assert "ramp_turn = np.linspace([0, 0.1, 0.1], [0, 0.3, 0], 6)" in script
    assert "skip=(1, 0, 0)," in script


def test_a_step_without_the_constraint_and_a_ramp_of_it():
    document = load("tube_sleeve_torsion")
    find(document, "turn")["constraints"] = ["sleeve"]
    assert errors(document) == [
        "commands/11: step 'turn' ramps 'twist', which is off in it."
    ]
    del find(document, "turn")["ramp"]
    find(document, "job_1").pop("curve")
    script = codegen(document, evaluate=False)
    assert "turn = fem.Step(\n    items=[solid_body, sleeve],\n" in script


@pytest.mark.parametrize(
    ("command", "value", "expected"),
    [
        ({"constrained": ["theta"]}, 0.5, [0, 0.5, 0]),
        ({"constrained": ["z", "r"]}, [1, 2], [1, 0, 2]),
    ],
)
def test_components(command, value, expected):
    command = {"command": "cylindrical.add", **command}
    assert components(command, value) == expected
    assert skip(command) == tuple(int(v == 0) for v in expected)


def test_first_moved_direction():
    document = load("tube_sleeve_torsion")
    twist = find(document, "twist")
    # the ramp turns it around the axis, the first constrained direction is r
    assert first_moved(document["commands"], twist) == 1
    assert first_moved(document["commands"], find(document, "sleeve")) == 0


def turned(field, constraint, angle):
    """A context of a substep whose points are turned rigidly about the axis z."""
    points = field.region.mesh.points
    c, s = np.cos(angle), np.sin(angle)
    rotated = points @ np.array([[c, s, 0], [-s, c, 0], [0, 0, 1]])
    field[0].values[:] = rotated - points
    return SimpleNamespace(substep=SimpleNamespace(x=field))


def test_curve_of_a_rotation_of_more_than_half_a_turn():
    # the angle of the first point continues over the substeps, beyond 180°
    mesh = fem.Rectangle(a=(1, -0.5), b=(2, 0.5), n=(3, 3)).expand(n=2)
    field = fem.FieldContainer([fem.Field(fem.RegionHexahedron(mesh), dim=3)])
    constraint = fem.CylindricalConstraint(field, points=[mesh.npoints - 1])
    zero = SimpleNamespace(
        results=SimpleNamespace(force=csr_matrix((3 * mesh.npoints, 1)))
    )
    curve = CylindricalCurvePlugin(boundary=constraint, items=[zero])
    angles = np.radians([0, 120, 240, 330, 420])
    for angle in angles:
        curve.after_substep(turned(field, constraint, angle), None)
    radius = constraint.radius[0]
    np.testing.assert_allclose(np.array(curve.x)[:, 1], radius * angles, rtol=1e-12)
    np.testing.assert_allclose(np.array(curve.x)[:, [0, 2]], 0, atol=1e-12)


def test_curve_is_a_characteristic_curve():
    # the runner and the plots of FElupe take it like fem.CharacteristicCurve
    mesh, field, solid = tube()
    twist = fem.CylindricalConstraint(
        field, points=np.flatnonzero(np.isclose(mesh.x, 3)), axis=(1, 0, 0)
    )
    step = fem.Step(
        [solid, twist],
        ramp={twist: np.linspace([0, 0, 0], [0, 0.1, 0], 2)},
        boundaries={"fixed": fem.Boundary(field[0], fx=0)},
    )
    job = CylindricalCurve(steps=[step], boundary=twist, items=[solid])
    assert isinstance(job, fem.CharacteristicCurve)
    job.evaluate(verbose=0)
    assert len(job.x) == len(job.y) == 2
    assert job.x is job.cylindrical.x
