"""Contacts of points with rigid surfaces (#220)."""

import json
import shutil
from pathlib import Path

import numpy as np

from felupe_studio import results
from felupe_studio.codegen import codegen, object_lines
from felupe_studio.commands import errors
from felupe_studio.runner import run

GOLDEN = Path(__file__).parent / "golden"


def document(case="block_contact_plane"):
    text = (GOLDEN / case / "commands.json").read_text(encoding="utf-8")
    return json.loads(text)


def test_script_of_a_contact_with_a_plane():
    doc = document()
    assert errors(doc) == []
    script = codegen(doc)
    # the stiffness for the penalties, before the contacts
    assert "for solid in [solid_body]:\n    solid.assemble.matrix()" in script
    assert (
        "touch = fem.ContactRigidPlane(\n"
        "    field,\n"
        "    points=np.intersect1d(np.flatnonzero(top), solid_points),\n"
        '    centerpoint=single_point(plate, "plate"),\n'
        "    normal=[0.0, 0.0, -1.0],\n"
        "    multiplier=1000,\n"
        "    items=[solid_body],\n"
        ")"
    ) in script
    # the points of the cells of the sections, not the vertices
    assert "solid_points = np.unique(region_body.mesh.cells)" in script
    # an item of the steps, like the constraints
    assert "items=[solid_body, touch]" in script
    assert object_lines(script, doc)["touch"]


def test_script_of_a_contact_with_a_cylinder_and_a_face_set():
    doc = document("block_contact_cylinder")
    commands = doc["commands"]
    at = next(i for i, c in enumerate(commands) if c["command"] == "contact.add")
    commands[at : at + 1] = [
        {
            "command": "faceset.add",
            "name": "lid",
            "section": "body",
            "select": {"axis": "z", "value": 1},
        },
        {
            "command": "contact.add",
            "name": "touch",
            "points": "lid",
            "surface": "roller",
            "friction": 0.5,
            "elastic_slip": 0.002,
        },
    ]
    for cmd in commands:
        if cmd["command"] == "rigid.add":
            cmd["shape"]["inside"] = True
    assert errors(doc) == []
    script = codegen(doc)
    assert (
        "touch = fem.ContactRigidCylinder(\n"
        "    field,\n"
        "    points=np.unique(region_lid.mesh.cells_faces),\n"
        '    centerpoint=single_point(roller, "roller"),\n'
        "    radius=2,\n"
        "    axis=[0.0, 1.0, 0.0],\n"
        "    inside=True,\n"
        "    friction=0.5,\n"
        "    elastic_slip=0.002,\n"
        "    items=[solid_body],\n"
        ")"
    ) in script


def test_steps_take_the_contacts():
    # all contacts by default, or the chosen ones
    doc = document()
    commands = doc["commands"]
    at = next(i for i, c in enumerate(commands) if c["command"] == "contact.add")
    second = {**commands[at], "name": "again"}
    commands.insert(at + 1, second)
    assert "items=[solid_body, touch, again]" in codegen(doc)
    for cmd in commands:
        if cmd["command"] == "step.add":
            cmd["constraints"] = ["again"]
    assert "items=[solid_body, again]" in codegen(doc)


def test_contact_force_at_the_reference_point(tmp_path, monkeypatch):
    # the results of the reference point: its displacement and the force of the
    # contact, like the reaction force of the curve
    shutil.copy(GOLDEN / "block_contact_plane" / "block.vtu", tmp_path)
    monkeypatch.chdir(tmp_path)
    result = run(document())["job_1"]
    meta = json.loads(results.scene("job_1", 6, "displacement")[0])
    (plate,) = meta["points"]
    np.testing.assert_allclose(plate["displacement"], [0, 0, -0.2], atol=1e-12)
    assert plate["force"][2] == np.float64(result["y"][-1][2]) != 0
