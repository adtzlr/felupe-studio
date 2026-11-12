"""Write validation_cases.json: command lists and their expected error messages, and
the notes that are no errors (#186).

The cases are shared by the Python validation (felupe_studio.commands) and the
TypeScript validation (app/src/core/validate.ts), so both report the same messages.
Run ``python tests/data/make_validation_cases.py`` after changing a message.
"""

import copy
import json
from pathlib import Path

from felupe_studio.commands import errors, notes

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
    "point load ramped and recorded": lambda d: (
        d["commands"].insert(
            11,
            {
                "command": "load.add",
                "name": "pull",
                "points": "right",
                "force": [1, 0, 0],
            },
        ),
        find(d, "step_1")["ramp"]["items"].append({"target": "pull", "end": 1}),
        find(d, "step_1").update(loads=["pull"]),
        find(d, "job_1").update(curve="pull"),
    ),
    "point load of a cell set": lambda d: d["commands"].insert(
        11,
        {"command": "load.add", "name": "pull", "points": "hard", "force": [1, 0, 0]},
    ),
    "step with a load that is a boundary": lambda d: find(d, "step_1").update(
        loads=["fixed"]
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
    "ogden with fewer exponents than moduli": lambda d: find(d, "umat_soft").update(
        model="Ogden", parameters={"mu": [1.0, 0.2], "alpha": [2.0], "bulk": 50.0}
    ),
    "two model settings": lambda d: d["commands"].__setitem__(
        slice(0, 0),
        [
            {
                "command": "model.settings",
                "name": "settings",
                "units": {"length": "mm", "force": "N"},
            },
            {"command": "model.settings", "name": "settings_2"},
        ],
    ),
    "face set of a cell set": lambda d: d["commands"].insert(
        9,
        {
            "command": "faceset.add",
            "name": "end",
            "section": "hard",
            "select": {"axis": "x", "value": 3},
        },
    ),
    "face set of a later section": lambda d: d["commands"].insert(
        5,
        {
            "command": "faceset.add",
            "name": "end",
            "section": "section_soft",
            "select": {"centers": [[3, 0.5, 0.5]]},
        },
    ),
    "pressure on a point set": lambda d: d["commands"].insert(
        9,
        {
            "command": "pressure.add",
            "name": "inflate",
            "faces": "left",
            "pressure": 0.1,
        },
    ),
    # parameters of the model (#180)
    "parameters": lambda d: (
        d["commands"].insert(
            0,
            {
                "command": "parameter.add",
                "name": "radius",
                "value": 50,
                "quantity": "length",
                "min": 10,
                "max": 100,
                "step": 0.5,
                "description": "Radius of the disc",
            },
        ),
        d["commands"].insert(
            1,
            {
                "command": "parameter.add",
                "name": "layers",
                "value": 3,
                "integer": True,
                "min": 1,
                "max": 10,
            },
        ),
    ),
    # symmetry planes (#186): neither ramped nor a curve; notes about repeated planes
    "symmetry planes": lambda d: d["commands"].insert(
        11, {"command": "symmetry.add", "name": "half", "axes": ["y", "z"], "y": 0.5}
    ),
    "symmetry ramped": lambda d: (
        d["commands"].insert(
            11, {"command": "symmetry.add", "name": "half", "axes": ["y"]}
        ),
        find(d, "step_1")["ramp"]["items"].append({"target": "half", "end": 0}),
    ),
    "symmetry as a curve": lambda d: (
        d["commands"].insert(
            11, {"command": "symmetry.add", "name": "half", "axes": ["y"]}
        ),
        find(d, "job_1").update(curve="half"),
    ),
    "symmetry planes of a load case": lambda d: (
        d["commands"].insert(
            11, {"command": "symmetry.add", "name": "half", "axes": ["x", "z"]}
        ),
        d["commands"].insert(
            12, {"command": "loadcase.add", "name": "test", "type": "uniaxial"}
        ),
    ),
    "symmetry planes twice": lambda d: (
        d["commands"].insert(
            11,
            {"command": "symmetry.add", "name": "half", "axes": ["y"], "y": 0.5},
        ),
        d["commands"].insert(
            12,
            {
                "command": "symmetry.add",
                "name": "quarter",
                "axes": ["y", "z"],
                "y": 0.5,
                "z": 12.5,
            },
        ),
        d["commands"].insert(
            13,
            {"command": "loadcase.add", "name": "shear", "type": "shear"},
        ),
    ),
    # 2D models (#175): no z components, 2D cells, not yet all objects
    "2d model": lambda d: (
        d["commands"].insert(
            0,
            {
                "command": "model.settings",
                "name": "settings",
                "analysis": "plane-strain",
            },
        ),
        d["commands"].__setitem__(10, {**d["commands"][10], "constrained": ["x", "y"]}),
    ),
    "2d model with z components": lambda d: (
        d["commands"].insert(
            0,
            {
                "command": "model.settings",
                "name": "settings",
                "analysis": "axisymmetric",
            },
        ),
        d["commands"].__setitem__(10, {**d["commands"][10], "constrained": ["x", "z"]}),
        d["commands"].insert(
            11,
            {
                "command": "pointset.add",
                "name": "ring",
                "select": {"radius": 2, "axis": "x"},
            },
        ),
        d["commands"].insert(
            12,
            {
                "command": "pointset.add",
                "name": "far",
                "select": {"points": [[1, 2, 3]]},
            },
        ),
        d["commands"].insert(
            13,
            {
                "command": "pointset.add",
                "name": "top",
                "select": {"bound": "max", "axis": "z"},
            },
        ),
        d["commands"].insert(
            14,
            {"command": "symmetry.add", "name": "half", "axes": ["y", "z"]},
        ),
        d["commands"].insert(
            15,
            {"command": "loadcase.add", "name": "test", "type": "shear", "normal": "z"},
        ),
        d["commands"].insert(
            16,
            {
                "command": "load.add",
                "name": "pull",
                "points": "far",
                "force": [1, 0, 1],
            },
        ),
    ),
    "2d model without control points yet": lambda d: (
        d["commands"].insert(
            0,
            {
                "command": "model.settings",
                "name": "settings",
                "analysis": "plane-strain",
            },
        ),
        d["commands"].insert(
            10, {"command": "point.add", "name": "pin", "coordinates": [4, 0, 0]}
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
    "2d cells": lambda d: (
        d["commands"].insert(
            0,
            {
                "command": "model.settings",
                "name": "settings",
                "analysis": "plane-strain",
            },
        ),
        d["commands"].__setitem__(1, {**d["commands"][1], "cell_type": "hexahedron"}),
    ),
    "2d cells in a 3d model": lambda d: d["commands"].__setitem__(
        0, {**d["commands"][0], "cell_type": "quad"}
    ),
    "parameter out of its range": lambda d: d["commands"].insert(
        0,
        {"command": "parameter.add", "name": "radius", "value": 120, "max": 100},
    ),
    "parameter below its range": lambda d: d["commands"].insert(
        0,
        {"command": "parameter.add", "name": "radius", "value": 5, "min": 10},
    ),
    "parameter with an empty range": lambda d: d["commands"].insert(
        0,
        {
            "command": "parameter.add",
            "name": "radius",
            "value": 10,
            "min": 10,
            "max": 10,
        },
    ),
    "integer parameter with fractions": lambda d: d["commands"].insert(
        0,
        {
            "command": "parameter.add",
            "name": "layers",
            "value": 2.5,
            "integer": True,
            "min": 1,
            "max": 10,
            "step": 0.5,
        },
    ),
    # meshes made by scripts with parameters (#182)
    "mesh script": lambda d: d["commands"][0:0].__iadd__(
        [
            {"command": "parameter.add", "name": "radius", "value": 50},
            {
                "command": "mesh.script",
                "name": "made",
                "file": "spring.py",
                "parameters": ["radius"],
                "item": "rubber",
            },
        ]
    ),
    "mesh script with a parameter that is none": lambda d: d["commands"].insert(
        0,
        {
            "command": "mesh.script",
            "name": "made",
            "file": "spring.py",
            "parameters": ["radius", "umat_soft"],
        },
    ),
    "parameter with a name of the script": lambda d: d["commands"].insert(
        0, {"command": "parameter.add", "name": "field", "value": 1}
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
        result.append(
            {
                "name": name,
                "document": document,
                "errors": errors(document),
                "notes": notes(document["commands"]),
            }
        )
    return result


if __name__ == "__main__":
    text = json.dumps(cases(), indent=2) + "\n"
    (HERE / "validation_cases.json").write_text(text, encoding="utf-8")
