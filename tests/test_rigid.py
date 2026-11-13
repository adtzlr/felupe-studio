"""Rigid surfaces (#219): a reference point with a plane or a cylinder."""

import copy
import json
from pathlib import Path

import numpy as np
import pytest

from felupe_studio import results
from felupe_studio.codegen import codegen, object_lines, rigid_comment
from felupe_studio.commands import errors
from felupe_studio.runner import run

GOLDEN = Path(__file__).parent / "golden"


def document():
    """The block of the golden case of the pressure, with a rigid plate above its
    top and a roller beside it, moved by boundaries of their reference points."""
    text = (GOLDEN / "block_pressure" / "commands.json").read_text(encoding="utf-8")
    doc = json.loads(text)
    commands = doc["commands"]
    at = next(i for i, c in enumerate(commands) if c["command"] == "boundary.add")
    commands[at:at] = [
        {
            "command": "rigid.add",
            "name": "plate",
            "coordinates": [0.25, 0.25, 1.5],
            "shape": {"normal": [0, 0, -1]},
        },
        {
            "command": "rigid.add",
            "name": "roller",
            "coordinates": [2, 0.25, 0.25],
            "shape": {"radius": 0.5, "axis": [0, 1, 0], "inside": True},
        },
        {
            "command": "boundary.add",
            "name": "lower",
            "pointset": "plate",
            "constrained": ["z"],
        },
        {
            "command": "boundary.add",
            "name": "guide",
            "pointset": "plate",
            "constrained": ["x", "y"],
        },
        {
            "command": "boundary.add",
            "name": "hold",
            "pointset": "roller",
            "constrained": ["x", "y", "z"],
        },
    ]
    for cmd in commands:
        if cmd["command"] == "step.add":
            cmd["ramp"] = {
                "num": 2,
                "items": [
                    {"target": "pull", "end": 1},
                    {"target": "lower", "end": -0.2},
                ],
            }
    return doc


def test_script_of_rigid_surfaces():
    doc = document()
    assert errors(doc) == []
    script = codegen(doc)
    assert (
        "# control points and reference points of rigid surfaces (#219): a mesh of\n"
        "# vertices, not nodes of the sections\n"
        "# plate: a rigid plane through [0.25, 0.25, 1.5], its normal [0, 0, -1]\n"
        "# roller: a rigid cylinder of radius 0.5 about [2, 0.25, 0.25], its axis "
        "[0, 1, 0], the points inside\n"
        "region_control_points = vertex_region([[0.25, 0.25, 1.5], [2, 0.25, 0.25]])"
    ) in script
    # a point set of one point each, moved by boundaries
    assert "plate = points_at(points, [0.25, 0.25, 1.5])" in script
    assert '"lower": fem.Boundary(field[0], mask=plate, skip=(1, 1, 0))' in script
    # the lines of the script view
    lines = object_lines(script, doc)
    assert lines["plate"] and lines["roller"]


def test_comments_of_2d_models():
    line = {"name": "wall", "coordinates": [3, 0, 0], "shape": {"normal": [-1, 0, 0]}}
    assert (
        rigid_comment(line, dim=2) == "wall: a rigid line through [3, 0], its normal "
        "[-1, 0]"
    )
    tube = {
        "name": "tube",
        "coordinates": [0, 0, 0],
        "shape": {"radius": 2.5, "axis": [0, 0, 1], "inside": True},
    }
    assert rigid_comment(tube, dim=2) == (
        "tube: a rigid circle of radius 2.5 about [0, 0], the points inside"
    )


def test_reference_points_are_control_points(tmp_path, monkeypatch):
    # the reference points move with their boundaries and are in the results of
    # the control points (displacements, forces, CSV)
    for name in ("block.vtu",):
        (tmp_path / name).write_bytes((GOLDEN / "block_pressure" / name).read_bytes())
    monkeypatch.chdir(tmp_path)
    doc = document()
    run(doc)
    meta = json.loads(results.scene("job_1", 3, "displacement")[0])
    points = {p["name"]: p for p in meta["points"]}
    assert set(points) == {"plate", "roller"}
    np.testing.assert_allclose(points["plate"]["displacement"], [0, 0, -0.2])
    np.testing.assert_allclose(points["roller"]["displacement"], [0, 0, 0])
    assert points["plate"]["position"] == [0.25, 0.25, 1.5]
    csv = results.export("job_1", "csv").decode().splitlines()
    assert csv[0].startswith("substep,plate.u_x,plate.u_y,plate.u_z")
    assert "roller.F_z" in csv[0]


@pytest.mark.parametrize(
    "change, message",
    [
        (
            {"shape": {"normal": [0, 0, 0]}},
            "rigid surface 'plate' has a normal of zero length.",
        ),
        (
            {"shape": {"radius": 1, "axis": [0, 0, 0]}},
            "rigid surface 'plate' has an axis of zero length.",
        ),
        (
            {"coordinates": [2, 0.25, 0.25]},
            "rigid surface 'plate' is at the coordinates of rigid surface 'roller'",
        ),
    ],
)
def test_problems_of_rigid_surfaces(change, message):
    doc = document()
    commands = doc["commands"]
    plate = next(c for c in commands if c["name"] == "plate")
    plate.update(change)
    # the roller first, so the plate is at its coordinates
    commands.remove(plate)
    commands.insert(
        commands.index(next(c for c in commands if c["name"] == "roller")) + 1, plate
    )
    assert any(message in e for e in errors(doc))


def test_rigid_surfaces_need_boundaries():
    doc = document()
    commands = [c for c in doc["commands"] if c["name"] not in ("hold", "guide")]
    problems = errors({**doc, "commands": copy.deepcopy(commands)})
    assert any(
        p.endswith(
            "rigid surface 'plate' has no stiffness in x and y: its reference point "
            "needs a boundary of these components."
        )
        for p in problems
    )
    assert any(
        "rigid surface 'roller' has no stiffness in x, y and z" in p for p in problems
    )
