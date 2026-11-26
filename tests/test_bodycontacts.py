"""Contacts between bodies (felupe-contact, #462, ADR 0026): the script of
``bodycontact.add``, the steps, the rules, the checks of the cells, the warnings of
felupe-contact and the forces against models without a contact."""

import contextlib
import io
import json
import shutil
import subprocess
from pathlib import Path

import felupe as fem
import meshio
import numpy as np
import pytest

from felupe_studio import checks, runner
from felupe_studio._helpers import mixed_field, mixed_region, nearly_incompressible
from felupe_studio.codegen import codegen
from felupe_studio.commands import errors

GOLDEN = Path(__file__).parent / "golden"

# the displacements of the curves after the gap of 0.02 between the bodies is closed
MOVES = np.array([0, -0.02, -0.06, -0.10, -0.14, -0.18, -0.22, -0.26, -0.30])


def document(case):
    return json.loads((GOLDEN / case / "commands.json").read_text(encoding="utf-8"))


def command(doc, name):
    return next(c for c in doc["commands"] if c["name"] == name)


def curve(doc, axis=0):
    """The force of the curve of the job of a command list, along an axis."""
    return np.array(runner.run(doc)["job_1"]["y"])[:, axis]


def test_script_of_a_contact_between_two_sections():
    doc = document("blocks_contact_bodies")
    assert errors(doc) == []
    script = codegen(doc)
    assert "\nfrom felupe_contact import SolidBodyContact\n" in script
    assert (
        "contact = SolidBodyContact(solid_rubber_block, solid_plate, "
        "penalty_scale=100)" in script
    )
    # an item of the steps, like the constraints
    assert "items=[solid_plate, solid_rubber_block, contact]" in script


def test_scripts_without_a_contact_between_bodies_import_no_felupe_contact():
    for case in ("block_contact_plane", "bar_two_materials", "tube_sleeve_torsion"):
        assert "felupe_contact" not in codegen(document(case))


def test_script_of_the_point_sets_and_of_self_contact():
    plate = codegen(document("plate_contact_bodies_plane_strain"))
    assert (
        "contact = SolidBodyContact(\n"
        "    solid_pad, solid_plate, mask=pad_face, mask_primary=plate_face, "
        "penalty_scale=100\n"
        ")"
    ) in plate
    slit = codegen(document("slit_self_contact_plane_strain"))
    # one section: its surface is the primary one too
    assert (
        "slit = SolidBodyContact(solid_body, max_distance=0.3, self_contact=True)"
        in (slit)
    )


def test_script_of_all_arguments_passes_ruff(tmp_path):
    doc = document("blocks_contact_bodies")
    command(doc, "contact").update(
        penalty=5000,
        smoothing=0.001,
        two_pass=True,
        max_distance=0.2,
        candidates=10,
        tolerance=0.2,
        facing=0.0,
        self_contact=False,
        geometric_stiffness=False,
    )
    del command(doc, "contact")["penalty_scale"]
    assert errors(doc) == []
    script = codegen(doc)
    # in the order of the signature of SolidBodyContact
    assert (
        "    penalty=5000,\n    smoothing=0.001,\n    two_pass=True,\n"
        "    max_distance=0.2,\n    candidates=10,\n    tolerance=0.2,\n"
        "    facing=0.0,\n    self_contact=False,\n    geometric_stiffness=False,\n"
    ) in script
    ruff = shutil.which("ruff")
    if ruff is None:
        pytest.skip("ruff is not installed")
    path = tmp_path / "script.py"
    path.write_text(script, encoding="utf-8")
    for check in (
        [ruff, "check", "--isolated", "--select", "E,F,W,I", str(path)],
        [ruff, "format", "--isolated", "--check", str(path)],
    ):
        assert subprocess.run(check, capture_output=True).returncode == 0


def held(field, solid, axis, bottom, top):
    """The curve of a rubber body held along an axis at a bottom (frictionless) and
    moved at its top, without a contact, by the moves after the gap."""
    dim = field[0].dim
    clamp = tuple(int(i == axis) for i in range(dim))
    move = tuple(int(i != axis) for i in range(dim))
    x = field[0].region.mesh.points[:, axis]
    boundaries = {
        "bottom": fem.Boundary(field[0], mask=np.isclose(x, bottom), skip=move),
        "clamped": fem.Boundary(field[0], mask=np.isclose(x, top), skip=clamp),
        "move": fem.Boundary(field[0], mask=np.isclose(x, top), skip=move),
    }
    step = fem.Step(
        items=[solid], ramp={boundaries["move"]: MOVES}, boundaries=boundaries
    )
    job = fem.CharacteristicCurve(steps=[step], boundary=boundaries["move"])
    job.evaluate(tol=1e-10, verbose=0)
    return np.array(job.y)[:, axis]


def test_rubber_block_pressed_on_a_steel_plate_like_held():
    # the force of the rubber block held at the plate (frictionless), within the
    # penetration of the penalty: 4.7e-3 with penalty_scale=100
    force = curve(document("blocks_contact_bodies"))
    mesh = fem.Cube(a=(1, 0, 0), b=(2, 1, 1), n=6)
    field = fem.FieldContainer([fem.Field(fem.RegionHexahedron(mesh), dim=3)])
    solid = fem.SolidBody(fem.NeoHooke(mu=1, bulk=50), field)
    reference = held(field, solid, axis=0, bottom=1, top=2)
    assert np.allclose(force, reference, rtol=1e-2, atol=1e-2 * abs(reference[-1]))


def test_rubber_pad_pressed_on_a_plate_in_plane_strain_like_held():
    # the faces of the point sets only, of a section condensed per cell: 4.6e-3
    force = curve(document("plate_contact_bodies_plane_strain"))
    mesh = fem.Rectangle(a=(1.02, 0.4), b=(2.02, 1.6), n=(6, 7))
    field = mixed_field(mixed_region(mesh), planestrain=True)
    solid = nearly_incompressible(fem.NeoHooke(mu=1), field, bulk=50)
    reference = held(field, solid, axis=0, bottom=1.02, top=2.02)
    assert np.allclose(force, reference, rtol=1e-2, atol=1e-2 * abs(reference[-1]))


def test_rubber_cylinder_pressed_on_a_disc_like_held():
    # axisymmetric, mixed fields: 1.6e-2 with penalty_scale=100, since the estimate of
    # the penalty takes the circumference of the faces (the area of a point)
    force = curve(document("cylinder_contact_bodies_axisymmetric"))
    mesh = fem.Rectangle(a=(0.52, 0), b=(1.52, 1), n=(6, 6))
    field = fem.FieldsMixed(fem.RegionQuad(mesh), n=3, axisymmetric=True)
    umat = fem.NearlyIncompressible(fem.NeoHooke(mu=1), bulk=50)
    solid = fem.SolidBody(umat, field)
    reference = held(field, solid, axis=0, bottom=0.52, top=1.52)
    assert np.allclose(force, reference, rtol=2e-2, atol=2e-2 * abs(reference[-1]))


def closing(doc):
    """The x of the points of both arms of the slit on its side, after the job."""
    runner.run(doc)
    field = runner.LAST["field"][0]
    X = field.region.mesh.points
    x = X + field.values
    arms = X[:, 1] > 0.5 + 1e-8
    left = arms & (X[:, 0] <= 0.8 + 1e-8)
    right = arms & (X[:, 0] >= 1.2 - 1e-8)
    return x[left, 0].max(), x[right, 0].min()


def test_self_contact_closes_the_slit():
    # the arms of one body touch each other in the middle (x = 1) with self_contact
    doc = document("slit_self_contact_plane_strain")
    left, right = closing(doc)
    assert 1.0 - 1e-2 < left < 1.0 + 1e-2 and 1.0 - 1e-2 < right < 1.0 + 1e-2
    assert runner.LAST["slit"].results.npoints_in_contact > 0
    # without the contact, they pass through each other
    doc["commands"] = [c for c in doc["commands"] if c["name"] != "slit"]
    left, right = closing(doc)
    assert left > 1.05 and right < 0.95


def test_steps_leave_out_the_contacts_of_their_sections():
    doc = document("blocks_contact_bodies")
    step = command(doc, "press")
    step["sections"] = ["rubber_block"]
    # the plate is held in every step; the rubber block alone
    script = codegen(doc)
    assert "items=[solid_rubber_block]," in script
    # a step that names the contact needs its sections
    step["constraints"] = ["contact"]
    assert errors(doc) == [
        "commands/14: step 'press' has the contact 'contact' between bodies, but not "
        "its section 'plate'."
    ]


def test_rules_of_the_contact_between_bodies():
    doc = document("blocks_contact_bodies")
    doc["commands"].insert(
        8, {"command": "point.add", "name": "control", "coordinates": [3, 0.5, 0.5]}
    )
    contact = command(doc, "contact")
    contact["points"] = "control"
    command(doc, "rubber_block")["formulation"] = "u-isochoric"
    del command(doc, "rubber")["parameters"]["bulk"]
    problems = errors(doc)
    assert (
        "commands/14: contact 'contact' takes the control point 'control': a contact "
        "between bodies needs points of its sections."
    ) in problems
    assert (
        "commands/14: contact 'contact' takes the section 'rubber_block' of the third "
        "medium, which fills the gap between bodies instead of a contact."
    ) in problems


def test_the_warnings_of_felupe_contact_are_events_of_the_run():
    # one body without self_contact: no contact will be detected
    doc = document("blocks_contact_bodies")
    contact = command(doc, "contact")
    contact["section"] = "plate"
    del contact["primary"]
    events = []
    runner.run(doc, events.append)
    warnings = [e["message"] for e in events if e["event"] == "warning"]
    assert len(warnings) == 1 and "no contact will be detected" in warnings[0]


def test_check_names_the_cells_without_a_contact_surface(tmp_path):
    # felupe-contact has no boundary regions of tetrahedrons
    cube = fem.Cube(a=(1, 0, 0), b=(2, 1, 1), n=3).triangulate()
    meshio.Mesh(cube.points, [("tetra", cube.cells)]).write(tmp_path / "block.vtu")
    doc = document("blocks_contact_bodies")
    doc["commands"][1] = {
        "command": "mesh.import",
        "name": "block",
        "file": "block.vtu",
    }
    report = checks.check(doc, tmp_path)
    assert not report["ok"]
    assert report["contacts"] == [
        {"contact": "contact", "section": "rubber_block", "cell_type": "tetra"}
    ]
    assert (
        "Contact 'contact' between bodies: the tetra cells of 'rubber_block' have no "
        "faces for a contact in felupe-contact. Use hexahedrons or quads, linear or "
        "quadratic."
    ) in report["messages"]


# a soft block 0 <= x, y, z <= 1 and a block above it with a gap, or for
# blocks=0 the upper block as one degenerate cell (#418)
SCRIPT = """import felupe as fem
import numpy as np

blocks = globals().get("blocks", 1)
soft = fem.Cube(n=3)
upper = fem.Cube(a=(0, 0, 1.02), b=(1, 1, 1.5), n=(3, 3, 2))
if blocks == 0:
    upper = fem.Mesh(
        points=np.full((1, 3), 0.5), cells=np.zeros((1, 8), dtype=int),
        cell_type="hexahedron",
    )
mesh = {"soft": soft, "upper": upper}
"""


def blocks(number):
    """A model of meshes of a script with a contact of its two blocks (#429)."""
    commands = [
        {
            "command": "parameter.add",
            "name": "blocks",
            "value": number,
            "integer": True,
        },
        {
            "command": "mesh.script",
            "name": "soft_mesh",
            "file": "parts.py",
            "item": "soft",
        },
        {
            "command": "mesh.script",
            "name": "upper_mesh",
            "file": "parts.py",
            "item": "upper",
        },
        {"command": "cellset.from_file", "name": "soft_cells", "mesh": "soft_mesh"},
        {"command": "cellset.from_file", "name": "upper_cells", "mesh": "upper_mesh"},
        {
            "command": "material.add",
            "name": "foam",
            "model": "NeoHookeCompressible",
            "parameters": {"mu": 1.0, "lmbda": 2.0},
        },
        {
            "command": "section.add",
            "name": "soft",
            "cellset": "soft_cells",
            "material": "foam",
            "formulation": "u",
        },
        {
            "command": "section.add",
            "name": "upper",
            "cellset": "upper_cells",
            "material": "foam",
            "formulation": "u",
        },
        {
            "command": "pointset.add",
            "name": "bottom",
            "select": {"axis": "z", "value": 0},
        },
        {
            "command": "pointset.add",
            "name": "right",
            "select": {"axis": "x", "value": 1},
        },
        {
            "command": "boundary.add",
            "name": "fixed",
            "pointset": "bottom",
            "constrained": ["x", "y", "z"],
        },
        {
            "command": "boundary.add",
            "name": "move",
            "pointset": "right",
            "constrained": ["x"],
        },
        {
            "command": "bodycontact.add",
            "name": "touch",
            "section": "upper",
            "primary": "soft",
        },
        {
            "command": "step.add",
            "name": "pull",
            "ramp": {"num": 2, "items": [{"target": "move", "start": 0, "end": 0.1}]},
        },
        {"command": "job.add", "name": "job", "steps": ["pull"], "curve": "move"},
    ]
    return {"schema_version": 3, "commands": commands}


@pytest.mark.filterwarnings("ignore:invalid value encountered:RuntimeWarning")
@pytest.mark.filterwarnings("ignore:divide by zero encountered:RuntimeWarning")
@pytest.mark.filterwarnings("ignore:Negative volumes for cells:UserWarning")
def test_a_contact_of_a_section_without_volume_is_off(tmp_path, monkeypatch):
    (tmp_path / "parts.py").write_text(SCRIPT, encoding="utf-8")
    monkeypatch.chdir(tmp_path)
    doc = blocks(0)
    assert errors(doc) == []
    script = codegen(doc, evaluate=False)
    assert (
        "touch = (\n    SolidBodyContact(solid_upper, solid_soft)\n"
        "    if has_volume(solid_upper) and has_volume(solid_soft)\n    else None\n)"
    ) in script or (
        "touch = SolidBodyContact(solid_upper, solid_soft) if has_volume(solid_upper) "
        "and has_volume(solid_soft) else None"
    ) in script
    assert "*present(touch)" in script
    namespace = {}
    with contextlib.redirect_stdout(io.StringIO()):
        exec(script, namespace)  # noqa: S102
    assert namespace["touch"] is None
    assert namespace["pull"].items == [namespace["solid_soft"]]
    # with the upper block, the contact is an item of the step
    doc = blocks(1)
    namespace = {}
    with contextlib.redirect_stdout(io.StringIO()):
        exec(codegen(doc, evaluate=False), namespace)  # noqa: S102
    assert namespace["touch"] in namespace["pull"].items
