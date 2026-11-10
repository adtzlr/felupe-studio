"""Write validation_cases.json: command lists and their expected error messages.

The cases are shared by the Python validation (felupe_studio.commands) and the
TypeScript validation (app/src/core/validate.ts), so both report the same messages.
Run ``python tests/data/make_validation_cases.py`` after changing a message.
"""

import copy
import json
from pathlib import Path

from felupe_studio.commands import errors

HERE = Path(__file__).parent


def find(document, name):
    return next(c for c in document["commands"] if c["name"] == name)


def remove(document, name):
    document["commands"].remove(find(document, name))


CHANGES = {
    "valid": lambda d: None,
    "unknown mesh": lambda d: find(d, "hard").update(mesh="nomesh"),
    "wrong kind": lambda d: find(d, "section_hard").update(cellset="umat_hard"),
    "unknown point set": lambda d: find(d, "fixed").update(pointset="right2"),
    "step with a cell set": lambda d: find(d, "step_1").update(sections=["hard"]),
    "ramp of a point set": lambda d: find(d, "step_1")["ramp"]["items"][0].update(
        target="left"
    ),
    "unknown curve": lambda d: find(d, "job_1").update(curve="fixed2"),
    "ramp of two items": lambda d: find(d, "step_1")["ramp"]["items"].append(
        {"target": "fixed", "end": 0}
    ),
    "ramp of an unknown item": lambda d: find(d, "step_1")["ramp"]["items"].extend(
        [{"target": "fixed", "end": 0}, {"target": "left", "end": 0}]
    ),
    "ramp of an item twice": lambda d: find(d, "step_1")["ramp"]["items"].append(
        {"target": "move", "end": 1}
    ),
    "control point pinned": lambda d: (
        d["commands"].insert(
            9, {"command": "point.add", "name": "pin", "coordinates": [4, 0, 0]}
        ),
        d["commands"].insert(
            11,
            {
                "command": "boundary.add",
                "name": "pinned",
                "pointset": "pin",
                "constrained": ["x", "y", "z"],
            },
        ),
    ),
    "control point without stiffness": lambda d: (
        d["commands"].insert(
            9, {"command": "point.add", "name": "pin", "coordinates": [4, 0, 0]}
        ),
        d["commands"].insert(
            11,
            {
                "command": "boundary.add",
                "name": "half",
                "pointset": "pin",
                "constrained": ["x", "y"],
            },
        ),
    ),
    "constraint of a control point": lambda d: (
        d["commands"].insert(
            9, {"command": "point.add", "name": "pin", "coordinates": [4, 0, 0]}
        ),
        d["commands"].insert(
            12,
            {
                "command": "mpc.add",
                "name": "glue",
                "points": "right",
                "center": "pin",
                "constrained": ["x", "y"],
            },
        ),
    ),
    "constraint with a rotation point": lambda d: (
        d["commands"].insert(
            9, {"command": "point.add", "name": "pin", "coordinates": [4, 0, 0]}
        ),
        d["commands"].insert(
            10, {"command": "point.add", "name": "turn", "coordinates": [4, 0, 0]}
        ),
        d["commands"].insert(
            13,
            {
                "command": "mpc.add",
                "name": "glue",
                "points": "right",
                "center": "pin",
                "constrained": ["x"],
                "multiplier": 100,
                "rotation": "turn",
            },
        ),
    ),
    "constraint of a cell set": lambda d: d["commands"].insert(
        11,
        {
            "command": "mpc.add",
            "name": "glue",
            "points": "hard",
            "center": "right",
            "constrained": ["x", "y", "z"],
        },
    ),
    "step with a constraint": lambda d: (
        d["commands"].insert(
            11,
            {
                "command": "mpc.add",
                "name": "glue",
                "points": "right",
                "center": "left",
                "constrained": ["x", "y", "z"],
            },
        ),
        find(d, "step_1").update(constraints=["glue", "fixed"]),
    ),
    "duplicate name": lambda d: find(d, "soft").update(name="hard"),
    "mesh without tag": lambda d: find(d, "specimen").pop("tag"),
    "mesh with cell type": lambda d: find(d, "specimen").update(cell_type="tetra10"),
    "NeoHooke without bulk": lambda d: (
        find(d, "section_soft").update(formulation="u"),
        find(d, "section_soft").pop("bulk"),
    ),
    "NeoHooke with bulk": lambda d: (
        find(d, "umat_soft")["parameters"].update(bulk=5000),
        find(d, "section_soft").update(formulation="u"),
        find(d, "section_soft").pop("bulk"),
    ),
    "MooneyRivlin without bulk": lambda d: (
        find(d, "umat_soft").update(
            model="MooneyRivlin", parameters={"C10": 0.4, "C01": 0.1}
        ),
        find(d, "section_soft").update(formulation="u"),
        find(d, "section_soft").pop("bulk"),
    ),
    "load case ramped and recorded": lambda d: (
        d["commands"].insert(
            -2,
            {"command": "loadcase.add", "name": "tension", "type": "uniaxial"},
        ),
        find(d, "step_1")["ramp"]["items"][0].update(target="tension"),
        find(d, "job_1").update(curve="tension"),
    ),
    "load case with the same axes": lambda d: d["commands"].insert(
        -2,
        {"command": "loadcase.add", "name": "shear", "type": "shear", "normal": "x"},
    ),
    "load case without support": lambda d: d["commands"].insert(
        -2,
        {
            "command": "loadcase.add",
            "name": "pull",
            "type": "planar",
            "symmetry": False,
        },
    ),
    "keyword": lambda d: find(d, "job_1").update(name="lambda"),
    "reserved name": lambda d: find(d, "job_1").update(name="field"),
    "reserved prefix": lambda d: find(d, "job_1").update(name="solid_a"),
    "used before defined": lambda d: d["commands"].insert(
        0, d["commands"].pop(d["commands"].index(find(d, "job_1")))
    ),
    "removed material": lambda d: remove(d, "umat_hard"),
    "two merges": lambda d: d["commands"].__setitem__(
        slice(1, 1),
        [
            {"command": "mesh.merge", "name": "merge", "decimals": 6},
            {"command": "mesh.merge", "name": "merge_2", "decimals": 8},
        ],
    ),
    "several errors": lambda d: (
        find(d, "hard").update(mesh="nomesh"),
        find(d, "job_1").update(name="hard"),
    ),
}


def cases():
    base = json.loads((HERE / "two_sections.json").read_text(encoding="utf-8"))
    result = []
    for name, change in CHANGES.items():
        document = copy.deepcopy(base)
        change(document)
        result.append({"name": name, "document": document, "errors": errors(document)})
    return result


if __name__ == "__main__":
    text = json.dumps(cases(), indent=2) + "\n"
    (HERE / "validation_cases.json").write_text(text, encoding="utf-8")
