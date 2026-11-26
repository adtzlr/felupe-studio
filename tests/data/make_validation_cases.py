"""Write validation_cases.json: command lists and their expected error messages, and
the notes that are no errors (#186, #393).

The cases are shared by the Python validation (felupe_studio.commands) and the
TypeScript validation (app/src/core/validate.ts), so both report the same messages.
Run ``python tests/data/make_validation_cases.py`` after changing a message.
"""

import copy
import json
from pathlib import Path

from felupe_studio.commands import errors, notes, schema
from felupe_studio.formulations import formulations

HERE = Path(__file__).parent


def find(document, name):
    return next(c for c in document["commands"] if c["name"] == name)


def remove(document, name):
    document["commands"].remove(find(document, name))


def derived(name, value, **fields):
    """A derived parameter (#333, ADR 0021): a parameter whose value is an
    expression of other parameters."""
    return {"command": "parameter.add", "name": name, "value": value, **fields}


def parameters(document, **changes):
    """The parameters length, stroke and cells (an integer) first, and changes of
    the fields of commands (#242): a name with a dict of fields."""
    document["commands"][:0] = [
        {"command": "parameter.add", "name": "length", "value": 3},
        {"command": "parameter.add", "name": "stroke", "value": 0.5},
        {"command": "parameter.add", "name": "cells", "value": 5, "integer": True},
    ]
    for name, fields in changes.items():
        find(document, name).update(fields)


def tool(document, tool="Cube", tags=False, **parameters):
    """The specimen made by a mesh tool (ADR 0019) instead of a file, its cell sets
    all of its cells (or of tags, which a made mesh has not)."""
    defaults = {
        "Point": {"a": 0},
        "Line": {"a": 0, "b": 3, "n": 4},
        "Rectangle": {"a": [0, 0], "b": [3, 1], "n": [4, 2]},
        "Cube": {"a": [0, 0, 0], "b": [3, 1, 1], "n": [4, 2, 2]},
        "Circle": {"radius": 1, "centerpoint": [0, 0], "n": 3, "sections": [0, 90]},
        "Triangle": {"a": [0, 0], "b": [3, 0], "c": [0, 1], "n": 3},
    }
    mesh = find(document, "specimen")
    mesh.clear()
    mesh.update(
        command="mesh.generate",
        name="specimen",
        tool=tool,
        parameters={**defaults[tool], **parameters},
    )
    if not tags:
        for name in ("hard", "soft"):
            cellset = find(document, name)
            del cellset["value"]
            cellset["command"] = "cellset.from_file"


def operation(document, kind, inputs, before=(), tags=False, **parameters):
    """The specimen made by an operation of the mesh tools (ADR 0019) of meshes made
    before it, its cell sets all of its cells (or of the tags of its inputs, #438)."""
    tool(document, tags=tags)
    index = document["commands"].index(find(document, "specimen"))
    document["commands"][index:index] = list(before)
    specimen = find(document, "specimen")
    specimen.update(tool=kind, inputs=inputs, parameters=parameters)


def made(name, tool, inputs=None, **parameters):
    """A mesh made by a tool, an input of an operation."""
    command = {"command": "mesh.generate", "name": name, "tool": tool}
    if inputs:
        command["inputs"] = inputs
    return {**command, "parameters": parameters}


RECTANGLE = made("face", "Rectangle", a=[0, 0], b=[3, 1], n=[4, 2])
CUBE = made("block", "Cube", a=[0, 0, 0], b=[3, 1, 1], n=[4, 2, 2])
# a profile of two rectangles with a common edge, stacked into one mesh (#394)
PROFILE = [
    RECTANGLE,
    made("face_2", "Rectangle", a=[3, 0], b=[6, 1], n=[4, 2]),
    made("profile", "stack", ["face", "face_2"], decimals=10),
]
# a mesh of a file and of a script, inputs of the tools like made meshes (#438)
PART = {"command": "mesh.import", "name": "part", "file": "part.vtu"}
SCRIPT_PART = {"command": "mesh.script", "name": "part", "file": "part.py"}
TAGGED = {**PART, "tag": "material"}
LINES = [
    made("bottom", "Line", a=0, b=3, n=4),
    made("bottom_2d", "embed", ["bottom"], value=0),
    made("top", "Line", a=0, b=3, n=4),
    made("top_2d", "embed", ["top"], value=1),
]


def planar(document):
    """A plane strain model whose boundaries have no z."""
    document["commands"].insert(
        0, {"command": "model.settings", "name": "settings", "analysis": "plane-strain"}
    )
    find(document, "fixed")["constrained"] = ["x", "y"]


def ramp(end="stroke", num="cells"):
    return {"num": num, "items": [{"target": "move", "start": 0, "end": end}]}


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
    # an own color of a mesh (#336): no rule checks it
    "mesh with an own color": lambda d: find(d, "specimen").update(color="#7f8c8d"),
    "made mesh with an own color": lambda d: (
        tool(d),
        find(d, "specimen").update(color="#2B2D42"),
    ),
    # an own color of a section and of a cell set (#376): no rule checks it
    "section and cell set with an own color": lambda d: (
        find(d, "section_soft").update(color="#2b2d42"),
        find(d, "hard").update(color="#7F8C8D"),
    ),
    "cell set of a made mesh with an own color": lambda d: (
        tool(d),
        find(d, "soft").update(color="#d95926"),
    ),
    "NeoHooke without bulk": lambda d: (
        find(d, "section_soft").update(formulation="u"),
        find(d, "section_soft").pop("bulk"),
    ),
    # a material without a volumetric part, e.g. air as a third medium (#241)
    "NeoHooke without bulk, isochoric part only": lambda d: (
        find(d, "section_soft").update(formulation="u-isochoric"),
        find(d, "section_soft").pop("bulk"),
    ),
    "NeoHooke with bulk, isochoric part only": lambda d: (
        find(d, "umat_soft")["parameters"].update(bulk=5000),
        find(d, "section_soft").update(formulation="u-isochoric"),
        find(d, "section_soft").pop("bulk"),
    ),
    # the points of the cells of a section, e.g. of a rigid part (#241)
    "point set of a section": lambda d: find(d, "right").update(
        select={"section": "section_hard"}
    ),
    "point set of an unknown section": lambda d: find(d, "right").update(
        select={"section": "hard"}
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
    # u-p-J adds the volumetric part of the section to a material without one (#417)
    "NeoHooke with bulk and u-p-J": lambda d: (
        find(d, "umat_soft")["parameters"].update(bulk=5000),
    ),
    "MooneyRivlin with bulk and u-p-J": lambda d: find(d, "umat_soft").update(
        model="MooneyRivlin", parameters={"C10": 0.4, "C01": 0.1, "bulk": 5000}
    ),
    "compressible material with u-p-J": lambda d: find(d, "umat_soft").update(
        model="NeoHookeCompressible", parameters={"mu": 1.0, "lmbda": 5000.0}
    ),
    # a strain-based material needs the displacement formulation (#191)
    "strain-based material with u-p-J": lambda d: find(d, "umat_soft").update(
        model="LinearElasticPlasticIsotropicHardening",
        framework="total-lagrange",
        parameters={"E": 210000.0, "nu": 0.3, "sigma_y": 250.0, "K": 1000.0},
    ),
    # the strain exponent of the Seth-Hill framework (FElupe 12.1)
    "Seth-Hill framework with a strain exponent": lambda d: (
        find(d, "umat_soft").update(
            model="LinearElastic",
            framework="seth-hill",
            strain_exponent=0,
            parameters={"E": 210000.0, "nu": 0.3},
        ),
        find(d, "section_soft").update(formulation="u"),
        find(d, "section_soft").pop("bulk"),
    ),
    "strain-based material with u": lambda d: (
        find(d, "umat_soft").update(
            model="LinearElastic", parameters={"E": 210000.0, "nu": 0.3}
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
        model="Ogden", parameters={"mu": [1.0, 0.2], "alpha": [2.0]}
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
        # a face set of edges and a pressure
        d["commands"].insert(
            11,
            {
                "command": "faceset.add",
                "name": "end",
                "section": "section_soft",
                "select": {"axis": "x", "value": 3},
            },
        ),
        d["commands"].insert(
            12,
            {"command": "pressure.add", "name": "pull", "faces": "end", "pressure": -1},
        ),
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
        d["commands"].insert(
            17,
            {
                "command": "faceset.add",
                "name": "bottom",
                "section": "section_soft",
                "select": {"axis": "z", "value": 0},
            },
        ),
        d["commands"].insert(
            18,
            {
                "command": "faceset.add",
                "name": "picked",
                "section": "section_soft",
                "select": {"centers": [[3, 0.5, 0.5]]},
            },
        ),
    ),
    "2d model with a rotation point": lambda d: (
        d["commands"].insert(
            0,
            {
                "command": "model.settings",
                "name": "settings",
                "analysis": "plane-strain",
            },
        ),
        d["commands"].__setitem__(10, {**d["commands"][10], "constrained": ["x", "y"]}),
        d["commands"].insert(
            10, {"command": "point.add", "name": "pin", "coordinates": [4, 0.5, 0]}
        ),
        d["commands"].insert(
            11, {"command": "point.add", "name": "pivot", "coordinates": [4, 0.6, 0]}
        ),
        d["commands"].insert(
            13,
            {
                "command": "boundary.add",
                "name": "hold",
                "pointset": "pin",
                "constrained": ["x", "y"],
            },
        ),
        d["commands"].insert(
            14,
            {
                "command": "boundary.add",
                "name": "turn",
                "pointset": "pivot",
                "constrained": ["z"],
            },
        ),
        d["commands"].insert(
            15,
            {
                "command": "mpc.add",
                "name": "glue",
                "points": "right",
                "center": "pin",
                "constrained": ["x", "y"],
                "rotation": "pivot",
            },
        ),
    ),
    "2d model with control points out of the plane": lambda d: (
        d["commands"].insert(
            0,
            {
                "command": "model.settings",
                "name": "settings",
                "analysis": "axisymmetric",
            },
        ),
        d["commands"].__setitem__(10, {**d["commands"][10], "constrained": ["x", "y"]}),
        d["commands"].insert(
            10, {"command": "point.add", "name": "pin", "coordinates": [4, 0.5, 1]}
        ),
        d["commands"].insert(
            11, {"command": "point.add", "name": "pivot", "coordinates": [4, 0.6, 0]}
        ),
        d["commands"].insert(
            13,
            {
                "command": "boundary.add",
                "name": "turn",
                "pointset": "pivot",
                "constrained": ["x", "z"],
            },
        ),
        d["commands"].insert(
            14,
            {
                "command": "mpc.add",
                "name": "glue",
                "points": "right",
                "center": "pin",
                "constrained": ["x", "y", "z"],
                "rotation": "pivot",
            },
        ),
        d["commands"].insert(
            15,
            {
                "command": "load.add",
                "name": "twist",
                "points": "pivot",
                "force": [1, 0, 0],
            },
        ),
    ),
    # rigid surfaces (#219): reference points with a plane or a cylinder
    "rigid surfaces": lambda d: (
        d["commands"].insert(
            9,
            {
                "command": "rigid.add",
                "name": "plate",
                "coordinates": [4, 0.5, 0.5],
                "shape": {"normal": [-1, 0, 0]},
            },
        ),
        d["commands"].insert(
            10,
            {
                "command": "rigid.add",
                "name": "roller",
                "coordinates": [1.5, 2, 0.5],
                "shape": {"radius": 0.5, "axis": [0, 0, 1], "inside": False},
            },
        ),
        d["commands"].insert(
            11,
            {
                "command": "boundary.add",
                "name": "push",
                "pointset": "plate",
                "constrained": ["x", "y", "z"],
            },
        ),
        d["commands"].insert(
            12,
            {
                "command": "boundary.add",
                "name": "hold",
                "pointset": "roller",
                "constrained": ["x", "y", "z"],
            },
        ),
    ),
    # a boundary of a point set that selects a reference point or a control point,
    # e.g. on the plane of a bonded face (#222): x == 0 is fixed, x == 3 moves in x
    "reference points on planes of point sets": lambda d: (
        d["commands"].insert(
            9,
            {
                "command": "rigid.add",
                "name": "base",
                "coordinates": [0, 2, 2],
                "shape": {"normal": [1, 0, 0]},
            },
        ),
        d["commands"].insert(
            10,
            {
                "command": "rigid.add",
                "name": "stop",
                "coordinates": [3, 2, 2],
                "shape": {"normal": [-1, 0, 0]},
            },
        ),
        d["commands"].insert(
            11, {"command": "point.add", "name": "pin", "coordinates": [3, 0.55, 0.55]}
        ),
        d["commands"].insert(
            12,
            {
                "command": "boundary.add",
                "name": "half",
                "pointset": "pin",
                "constrained": ["y", "z"],
            },
        ),
    ),
    "rigid surface problems": lambda d: (
        d["commands"].insert(
            9, {"command": "point.add", "name": "pin", "coordinates": [4, 0.5, 0.5]}
        ),
        d["commands"].insert(
            10,
            {
                "command": "rigid.add",
                "name": "plate",
                "coordinates": [4, 0.5, 0.5],
                "shape": {"normal": [0, 0, 0]},
            },
        ),
        d["commands"].insert(
            11,
            {
                "command": "rigid.add",
                "name": "roller",
                "coordinates": [1.5, 2, 0.5],
                "shape": {"radius": 0.5, "axis": [0, 0, 0]},
            },
        ),
        d["commands"].insert(
            12,
            {
                "command": "boundary.add",
                "name": "hold",
                "pointset": "roller",
                "constrained": ["x", "z"],
            },
        ),
        d["commands"].insert(
            13,
            {
                "command": "boundary.add",
                "name": "pin_fixed",
                "pointset": "pin",
                "constrained": ["x", "y", "z"],
            },
        ),
    ),
    # contacts with rigid surfaces (#220)
    "contacts": lambda d: (
        d["commands"].insert(
            9,
            {
                "command": "rigid.add",
                "name": "plate",
                "coordinates": [4, 0.5, 0.5],
                "shape": {"normal": [-1, 0, 0]},
            },
        ),
        d["commands"].insert(
            10,
            {
                "command": "boundary.add",
                "name": "push",
                "pointset": "plate",
                "constrained": ["x", "y", "z"],
            },
        ),
        d["commands"].insert(
            11,
            {
                "command": "faceset.add",
                "name": "end",
                "section": "section_soft",
                "select": {"axis": "x", "value": 3},
            },
        ),
        d["commands"].insert(
            12,
            {
                "command": "contact.add",
                "name": "touch",
                "points": "end",
                "surface": "plate",
                "friction": 0.3,
                "elastic_slip": 0.01,
            },
        ),
        d["commands"].insert(
            13,
            {
                "command": "contact.add",
                "name": "edge",
                "points": "right",
                "surface": "plate",
                "multiplier": 10,
            },
        ),
    ),
    "contact problems": lambda d: (
        d["commands"].insert(
            9, {"command": "point.add", "name": "pin", "coordinates": [5, 0.5, 0.5]}
        ),
        d["commands"].insert(
            10,
            {
                "command": "boundary.add",
                "name": "pin_fixed",
                "pointset": "pin",
                "constrained": ["x", "y", "z"],
            },
        ),
        d["commands"].insert(
            11,
            {
                "command": "rigid.add",
                "name": "plate",
                "coordinates": [4, 0.5, 0.5],
                "shape": {"normal": [-1, 0, 0]},
            },
        ),
        d["commands"].insert(
            12,
            {
                "command": "boundary.add",
                "name": "push",
                "pointset": "plate",
                "constrained": ["x", "y", "z"],
            },
        ),
        d["commands"].insert(
            13,
            {
                "command": "contact.add",
                "name": "wrong_surface",
                "points": "right",
                "surface": "left",
            },
        ),
        d["commands"].insert(
            14,
            {
                "command": "contact.add",
                "name": "wrong_points",
                "points": "pin",
                "surface": "plate",
            },
        ),
        d["commands"].insert(
            15,
            {
                "command": "contact.add",
                "name": "unknown",
                "points": "right",
                "surface": "wall",
            },
        ),
    ),
    "2d model with a contact": lambda d: (
        d["commands"].insert(
            0,
            {
                "command": "model.settings",
                "name": "settings",
                "analysis": "plane-strain",
            },
        ),
        d["commands"].__setitem__(10, {**d["commands"][10], "constrained": ["x", "y"]}),
        d["commands"].insert(
            10,
            {
                "command": "rigid.add",
                "name": "plate",
                "coordinates": [4, 0.5, 0],
                "shape": {"normal": [-1, 0, 0]},
            },
        ),
        d["commands"].insert(
            11,
            {
                "command": "boundary.add",
                "name": "push",
                "pointset": "plate",
                "constrained": ["x", "y"],
            },
        ),
        d["commands"].insert(
            12,
            {
                "command": "contact.add",
                "name": "touch",
                "points": "right",
                "surface": "plate",
            },
        ),
    ),
    "2d model with rigid surfaces": lambda d: (
        d["commands"].insert(
            0,
            {
                "command": "model.settings",
                "name": "settings",
                "analysis": "plane-strain",
            },
        ),
        d["commands"].__setitem__(10, {**d["commands"][10], "constrained": ["x", "y"]}),
        d["commands"].insert(
            10,
            {
                "command": "rigid.add",
                "name": "plate",
                "coordinates": [4, 0.5, 1],
                "shape": {"normal": [-1, 0, 0]},
            },
        ),
        d["commands"].insert(
            11,
            {
                "command": "rigid.add",
                "name": "wall",
                "coordinates": [4, 0.5, 0],
                "shape": {"normal": [-1, 0, 1]},
            },
        ),
        d["commands"].insert(
            12,
            {
                "command": "rigid.add",
                "name": "roller",
                "coordinates": [1.5, 2, 0],
                "shape": {"radius": 0.5, "axis": [1, 0, 0]},
            },
        ),
        d["commands"].insert(
            13,
            {
                "command": "rigid.add",
                "name": "wheel",
                "coordinates": [1.5, 3, 0],
                "shape": {"radius": 0.5, "axis": [0, 0, 1]},
            },
        ),
        *(
            d["commands"].insert(
                14 + i,
                {
                    "command": "boundary.add",
                    "name": f"hold_{name}",
                    "pointset": name,
                    "constrained": ["x", "y"],
                },
            )
            for i, name in enumerate(["plate", "wall", "roller", "wheel"])
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
    # the 2D cells of a mesh of a file in a 3D model are a construction mesh, without
    # cell sets (#438)
    "a cell set of 2d cells in a 3d model": lambda d: d["commands"].__setitem__(
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
    # user-defined materials of files (ADR 0025), with parameters like a mesh script
    "material script": lambda d: (
        parameters(d),
        material_script(d, parameters=["length"], volumetric=False),
    ),
    "material script with a parameter that is none": lambda d: material_script(
        d, parameters=["length", "hard"], volumetric=False
    ),
    # the arguments of a strain energy function of a file (#424): values or
    # expressions, not those that fem.Hyperelastic gives or takes, nor those of the
    # Mullins effect
    "strain energy function": lambda d: (
        parameters(d),
        function_script(d, arguments={"mu": "length / 100", "k": 0.1}),
    ),
    "strain energy function with given arguments": lambda d: function_script(
        d, arguments={"C": 1, "nstatevars": 2, "lambda": 1.0, "μ": 1.0}
    ),
    "strain energy function with the arguments of the Mullins effect": lambda d: (
        function_script(
            d,
            arguments={"beta": 1.0, "material": 2.0},
            mullins={"r": 3, "m": 1, "beta": 0.1},
            nstatevars=2,
        )
    ),
    "strain energy function with an unknown parameter": lambda d: function_script(
        d, arguments={"mu": "shear / 2"}
    ),
    "parameter with a name of the script": lambda d: d["commands"].insert(
        0, {"command": "parameter.add", "name": "field", "value": 1}
    ),
    "several errors": lambda d: (
        find(d, "hard").update(mesh="nomesh"),
        find(d, "job_1").update(name="hard"),
    ),
    # a value per constrained component of a boundary (#225)
    "values per component": lambda d: (
        find(d, "move").update(constrained=["x", "z"], value=[0.1, -0.2]),
        find(d, "step_1")["ramp"]["items"][0].update(start=[0, 0.1], end=[0.5, -0.1]),
    ),
    "boundary with too many values": lambda d: find(d, "fixed").update(value=[0, 0]),
    "boundary with too few values": lambda d: find(d, "move").update(
        constrained=["x", "y", "z"], value=[0.1, -0.2]
    ),
    "ramp with too many values": lambda d: find(d, "step_1")["ramp"]["items"][0].update(
        end=[0.5, -0.1]
    ),
    "expressions of parameters": lambda d: parameters(
        d,
        right={"select": {"axis": "x", "value": "length"}},
        step_1={"ramp": ramp(end="min(stroke, length / 4)", num="2 * cells")},
        section_soft={"bulk": "1000 * cells"},
    ),
    "expression with an unknown parameter": lambda d: parameters(
        d, step_1={"ramp": ramp(end="2 * strok")}
    ),
    "expression that is not valid": lambda d: parameters(
        d, right={"select": {"axis": "x", "value": "length *"}}
    ),
    "expression with an unknown function": lambda d: parameters(
        d, step_1={"ramp": ramp(end="sinh(stroke)")}
    ),
    "expression with too few arguments": lambda d: parameters(
        d, step_1={"ramp": ramp(end="max(stroke)")}
    ),
    "expression without a finite value": lambda d: parameters(
        d, step_1={"ramp": ramp(end="stroke / (cells - 5)")}
    ),
    "expression of an integer that is not an integer": lambda d: parameters(
        d, step_1={"ramp": ramp(num="cells / 2")}
    ),
    "expression out of the bounds": lambda d: parameters(
        d, section_soft={"bulk": "1 - cells"}
    ),
    "expressions with two problems": lambda d: parameters(
        d,
        right={"select": {"axis": "x", "value": "width"}},
        step_1={"ramp": ramp(num="cells - 5")},
    ),
    "expression problems before references": lambda d: parameters(
        d, hard={"mesh": "nomesh"}, step_1={"ramp": ramp(end="stroke * 1e308 * 10")}
    ),
    # derived parameters (#333, ADR 0021): evaluated in the order of their
    # dependencies, wherever they stand, and used like the others
    "derived parameters": lambda d: (
        parameters(
            d,
            step_1={"ramp": ramp(end="travel / 2", num="substeps")},
            right={"select": {"axis": "x", "value": "length"}},
        ),
        d["commands"].insert(
            0, derived("travel", "2 * stroke + half", quantity="length")
        ),
        d["commands"].append(derived("half", "length / 2")),
        d["commands"].append(derived("substeps", "2 * cells", integer=True)),
    ),
    "derived parameter in a cycle": lambda d: (
        parameters(d, step_1={"ramp": ramp(end="a")}),
        d["commands"].extend(
            [derived("a", "b + 1"), derived("b", "2 * c"), derived("c", "a")]
        ),
    ),
    "derived parameter of itself": lambda d: (
        parameters(d),
        d["commands"].append(derived("a", "2 * a")),
    ),
    "derived parameter with an unknown name": lambda d: (
        parameters(d),
        d["commands"].append(derived("travel", "2 * strok")),
    ),
    "derived parameter that is not valid": lambda d: (
        parameters(d),
        d["commands"].append(derived("travel", "2 *")),
    ),
    "derived integer parameter that is not an integer": lambda d: (
        parameters(d, step_1={"ramp": ramp(num="half")}),
        d["commands"].append(derived("half", "cells / 2", integer=True)),
    ),
    "a derived parameter of a derived parameter with a problem": lambda d: (
        parameters(d, step_1={"ramp": ramp(end="double")}),
        d["commands"].extend(
            [derived("travel", "2 * strok"), derived("double", "2 * travel")]
        ),
    ),
    "expressions and a reference problem": lambda d: parameters(
        d, hard={"mesh": "nomesh"}, step_1={"ramp": ramp()}
    ),
    "ramp of a load case with values": lambda d: (
        d["commands"].insert(
            -2,
            {"command": "loadcase.add", "name": "tension", "type": "uniaxial"},
        ),
        find(d, "step_1")["ramp"]["items"].append(
            {"target": "tension", "end": [0.1, 0.2]}
        ),
    ),
    # the mesh tools (ADR 0019): a model mesh, construction meshes, their values
    "a cube made by a tool": lambda d: tool(d),
    "a cell set of a line mesh": lambda d: tool(d, "Line"),
    "a cell set of a point": lambda d: tool(d, "Point"),
    "a cell set of a rectangle in a 3D model": lambda d: tool(d, "Rectangle"),
    "a rectangle in a 2D model": lambda d: (tool(d, "Rectangle"), planar(d)),
    "a cell set of a cube in a 2D model": lambda d: (tool(d), planar(d)),
    "tags of a made mesh": lambda d: tool(d, tags=True),
    "a cube with b not larger than a": lambda d: tool(d, b=[3, 0, -1]),
    "a line with b not larger than a": lambda d: tool(d, "Line", b=0),
    # a circle and a triangle (#394): quads with 2D points
    "a circle in a 2D model": lambda d: (tool(d, "Circle"), planar(d)),
    "a triangle in a 2D model": lambda d: (tool(d, "Triangle"), planar(d)),
    "a cell set of a circle in a 3D model": lambda d: tool(d, "Circle"),
    "a circle of overlapping quarters": lambda d: (
        tool(d, "Circle", sections=[0, 90, 135]),
        planar(d),
    ),
    "a triangle with clockwise corners": lambda d: (
        tool(d, "Triangle", b=[0, 1], c=[3, 0]),
        planar(d),
    ),
    "a triangle with corners on a line": lambda d: (
        tool(d, "Triangle", c=[6, 0]),
        planar(d),
    ),
    "a circle with expressions": lambda d: (
        tool(d, "Circle", radius="length", n="cells", sections=[0, "90 + stroke"]),
        parameters(d),
        planar(d),
    ),
    "a cube with expressions": lambda d: (
        tool(d, b=["length", 1, 1], n=["cells", 2, 2]),
        parameters(d),
    ),
    "a block expanded from a rectangle": lambda d: operation(
        d, "expand", ["face"], [RECTANGLE], n=2, z=1
    ),
    "expand of a cube": lambda d: operation(d, "expand", ["block"], [CUBE], n=2, z=1),
    # every mesh of the model is an input of the tools (#438)
    "an operation of an imported mesh": lambda d: operation(
        d, "translate", ["part"], [PART], move=1, axis="x"
    ),
    "a stack of an imported half and its mirror": lambda d: operation(
        d,
        "stack",
        ["part", "other"],
        [PART, made("other", "mirror", ["part"], axis="x", value=0)],
        decimals=10,
    ),
    "a mesh of a script moved": lambda d: operation(
        d, "translate", ["part"], [SCRIPT_PART], move=1, axis="x"
    ),
    "a mesh of a script mirrored in a 2D model": lambda d: (
        operation(d, "mirror", ["part"], [SCRIPT_PART], axis="y", value=0),
        planar(d),
    ),
    "expand of an imported mesh": lambda d: operation(
        d, "expand", ["part"], [PART], n=2, z=1
    ),
    # a construction mesh of a file: its 2D cells in a 3D model (#438)
    "a profile of a file revolved": lambda d: operation(
        d, "revolve", ["part"], [{**PART, "cell_type": "quad"}], n=3, phi=90, axis="x"
    ),
    "a profile of a script expanded": lambda d: operation(
        d, "expand", ["part"], [{**SCRIPT_PART, "cell_type": "quad"}], n=2, z=1
    ),
    # the cell tags of the meshes that a tool takes (#438)
    "the tags of a stack of an imported half and its mirror": lambda d: operation(
        d,
        "stack",
        ["part", "other"],
        [TAGGED, made("other", "mirror", ["part"], axis="x", value=0)],
        tags=True,
        decimals=10,
    ),
    "the tags of a profile of a file revolved": lambda d: operation(
        d,
        "revolve",
        ["part"],
        [{**TAGGED, "cell_type": "quad"}],
        tags=True,
        n=3,
        phi=90,
        axis="x",
    ),
    "the tags of a mesh of a script moved": lambda d: operation(
        d,
        "translate",
        ["part"],
        [{**SCRIPT_PART, "tag": "material"}],
        tags=True,
        move=1,
        axis="x",
    ),
    "the tags of a mirror of a mesh without a tag": lambda d: operation(
        d, "mirror", ["part"], [PART], tags=True, axis="x", value=0
    ),
    "the tags of a stack of an imported mesh and a cube": lambda d: operation(
        d, "stack", ["part", "block"], [TAGGED, CUBE], tags=True, decimals=10
    ),
    "the tags of a stack of two meshes without a tag": lambda d: operation(
        d,
        "stack",
        ["part", "other"],
        [PART, made("other", "mirror", ["part"], axis="x", value=0)],
        tags=True,
        decimals=10,
    ),
    "a stack of an imported mesh of tetrahedrons and a cube": lambda d: operation(
        d,
        "stack",
        ["part", "block"],
        [{**PART, "cell_type": "tetra"}, CUBE],
        decimals=10,
    ),
    "a stack of an imported mesh and a rectangle": lambda d: operation(
        d, "stack", ["part", "face"], [PART, RECTANGLE], decimals=10
    ),
    "revolve of an embedded rectangle": lambda d: operation(
        d,
        "revolve",
        ["plane"],
        [RECTANGLE, made("plane", "embed", ["face"], value=1)],
        n=3,
        phi=90,
        axis="x",
    ),
    "a rectangle moved along z": lambda d: operation(
        d, "translate", ["face"], [RECTANGLE], move=1, axis="z"
    ),
    "a rectangle rotated about x": lambda d: operation(
        d, "rotate", ["face"], [RECTANGLE], angle_deg=30, axis="x"
    ),
    "a cube rotated about a center of two coordinates": lambda d: operation(
        d, "rotate", ["block"], [CUBE], angle_deg=30, axis="z", center=[1, 1]
    ),
    "a cube mirrored at a plane": lambda d: operation(
        d, "mirror", ["block"], [CUBE], axis="y", value=0.5
    ),
    "a face filled between two lines in a 2D model": lambda d: (
        operation(d, "fill_between", ["bottom_2d", "top_2d"], LINES, n=3),
        planar(d),
    ),
    "a face filled between lines of other points": lambda d: (
        operation(d, "fill_between", ["bottom", "top_2d"], LINES, n=3),
        planar(d),
    ),
    "runouts of a rectangle": lambda d: (
        operation(
            d,
            "add_runouts",
            ["face"],
            [RECTANGLE],
            values=[0.2],
            axis="y",
            centerpoint=[1.5, 0.5],
            normalize=True,
        ),
        planar(d),
    ),
    "runouts with values of the wrong number": lambda d: (
        operation(d, "add_runouts", ["face"], [RECTANGLE], values=[0.1, 0.1], axis="y"),
        planar(d),
    ),
    # several meshes stacked into one (#394)
    "a profile of rectangles stacked in a 2D model": lambda d: (
        operation(d, "stack", ["face", "face_2"], PROFILE[:2], decimals=10),
        planar(d),
    ),
    "a profile of rectangles stacked and revolved": lambda d: operation(
        d, "revolve", ["profile"], PROFILE, n=3, phi=90, axis="x"
    ),
    "a stack of a rectangle and a cube": lambda d: operation(
        d, "stack", ["face", "block"], [RECTANGLE, CUBE], decimals=10
    ),
    "an operation of a later mesh": lambda d: (
        operation(d, "translate", ["block"], move=1, axis="x"),
        d["commands"].insert(d["commands"].index(find(d, "specimen")) + 1, CUBE),
    ),
    "a cube with a number of points that is not an integer": lambda d: (
        tool(d, n=["stroke", 2, 2]),
        parameters(d),
    ),
}


def unload(document, steps):
    """A second step that unloads the bar, and the steps of the job (#331)."""
    index = document["commands"].index(find(document, "job_1"))
    items = [{"target": "move", "start": 0.5, "end": 0}]
    document["commands"].insert(
        index,
        {"command": "step.add", "name": "unload", "ramp": {"num": 5, "items": items}},
    )
    find(document, "job_1")["steps"] = steps


def mullins(document, **fields):
    """The Mullins effect of Ogden and Roxburgh of the soft material (#346)."""
    softening = {"r": 3, "m": 0.5, "beta": 0.1, **fields}
    find(document, "umat_soft")["mullins"] = softening


CHANGES |= {
    # the Mullins effect (#346): its parameters may be expressions, r > 1
    "the mullins effect": lambda d: mullins(d),
    "the mullins effect of expressions": lambda d: (
        parameters(d),
        mullins(d, r="cells - 2", m="stroke"),
    ),
    "the mullins effect without softening": lambda d: (
        parameters(d),
        mullins(d, r="cells / 5"),
    ),
    # a job may repeat a step (#331), e.g. load, unload, load
    "a repeated step": lambda d: unload(d, ["step_1", "unload", "step_1"]),
    "a repeated unknown step": lambda d: unload(d, ["step_1", "reload", "reload"]),
    "a repeated cell set as a step": lambda d: unload(d, ["step_1", "hard", "hard"]),
}


def release(document, steps, name="release", **fields):
    """A step with only the boundary fixed, before the job, and the steps of the job
    (#393): the boundary move is off in it."""
    index = document["commands"].index(find(document, "job_1"))
    step = {"command": "step.add", "name": name, "boundaries": ["fixed"], **fields}
    document["commands"].insert(index, step)
    find(document, "job_1")["steps"] = steps


CHANGES |= {
    # steps that switch boundaries on and off (#393): a curve that is off in a step
    # is a note, a ramp of a boundary that is off a problem
    "a step that releases a boundary": lambda d: release(d, ["step_1", "release"]),
    "a step that switches a boundary on again": lambda d: (
        release(d, ["step_1", "release", "step_1"]),
        find(d, "step_1").update(switched_on="job"),
    ),
    "a curve that is off in two steps": lambda d: (
        release(d, ["step_1", "release"]),
        release(d, ["step_1", "release", "hold", "release"], name="hold"),
    ),
    "a step that ramps a boundary that is off": lambda d: find(d, "step_1").update(
        boundaries=["fixed"]
    ),
    "a step with an unknown boundary": lambda d: find(d, "step_1").update(
        boundaries=["fixed", "move", "clamp"]
    ),
    "a step with a point set as a boundary": lambda d: find(d, "step_1").update(
        boundaries=["fixed", "move", "left"]
    ),
    "a step with a load case and a symmetry plane": lambda d: (
        d["commands"].insert(
            11, {"command": "symmetry.add", "name": "half", "axes": ["z"], "z": 0.5}
        ),
        d["commands"].insert(
            -2, {"command": "loadcase.add", "name": "tension", "type": "uniaxial"}
        ),
        find(d, "step_1").update(boundaries=["tension", "half"]),
        find(d, "step_1")["ramp"]["items"][0].update(target="tension"),
    ),
}


def cartesian(document, index=11, **fields):
    """A Cartesian constraint of the point set right (#421): its points slide in the
    plane normal to z, unless the fields change it."""
    command = {
        "command": "cartesian.add",
        "name": "slide",
        "points": "right",
        "e1": [0, 0, 1],
        "e2": [1, 0, 0],
        "constrained": ["1"],
        **fields,
    }
    document["commands"].insert(index, command)


def glue(document):
    """A multi-point constraint of the point set right to left."""
    document["commands"].insert(
        11,
        {
            "command": "mpc.add",
            "name": "glue",
            "points": "right",
            "center": "left",
            "constrained": ["x", "y", "z"],
        },
    )


# the Cartesian constraints (#421): ramped by the steps and the curve of a job, their
# base vectors and their values
CHANGES |= {
    "Cartesian constraint ramped and recorded": lambda d: (
        cartesian(d, multiplier=1e4, value=0.1),
        find(d, "step_1")["ramp"]["items"].append({"target": "slide", "end": 0.2}),
        find(d, "job_1").update(curve="slide"),
    ),
    "Cartesian constraint ramped per direction": lambda d: (
        cartesian(d, constrained=["3", "1"], value=[0.1, 0.2]),
        find(d, "step_1")["ramp"]["items"].append(
            {"target": "slide", "start": [0, 0], "end": [0.1, "stroke"]}
        ),
        parameters(d),
    ),
    "Cartesian constraint without e2": lambda d: (
        cartesian(d, e1=[0, 0, 1]),
        find(d, "slide").pop("e2"),
    ),
    "Cartesian constraint with a base vector of zero length": lambda d: cartesian(
        d, e1=[0, 0, 0], e2=[0, 0, 0]
    ),
    "Cartesian constraint with base vectors not orthogonal": lambda d: cartesian(
        d, e1=[1, 0, 1], e2=[1, 1, 0]
    ),
    "Cartesian constraint with a value per direction": lambda d: cartesian(
        d, value=[0.1, 0.2]
    ),
    "Cartesian constraint ramped with values per direction": lambda d: (
        cartesian(d, constrained=["1", "2"]),
        find(d, "step_1")["ramp"]["items"].append(
            {"target": "slide", "end": [0.1, 0.2, 0.3]}
        ),
    ),
    "Cartesian constraint off in a step that ramps it": lambda d: (
        cartesian(d),
        glue(d),
        find(d, "step_1").update(constraints=["glue"]),
        find(d, "step_1")["ramp"]["items"].append({"target": "slide", "end": 0.1}),
    ),
    "Cartesian constraint of a control point": lambda d: (
        d["commands"].insert(
            9, {"command": "point.add", "name": "pin", "coordinates": [4, 0, 0]}
        ),
        cartesian(d, 12, points="pin", constrained=["1", "2", "3"]),
    ),
    "Cartesian constraint along a rotated direction": lambda d: cartesian(
        d, e1=[1, 0, 1], e2=[0, 1, 0]
    ),
    "ramp of a multi-point constraint": lambda d: (
        glue(d),
        find(d, "step_1")["ramp"]["items"].append({"target": "glue", "end": 0.1}),
    ),
    "curve of a multi-point constraint": lambda d: (
        glue(d),
        find(d, "job_1").update(curve="glue"),
    ),
    "Cartesian constraint in a 2D model": lambda d: (
        tool(d, "Rectangle"),
        planar(d),
        cartesian(d, e1=[1, 0, 0], constrained=["2"], value=-0.1),
        find(d, "slide").pop("e2"),
        find(d, "job_1").update(curve="slide"),
    ),
    "Cartesian constraint with e1 in z in a 2D model": lambda d: (
        tool(d, "Rectangle"),
        planar(d),
        cartesian(d, e1=[1, 0, 1]),
        find(d, "slide").pop("e2"),
    ),
    "Cartesian constraint with e2 in a 2D model": lambda d: (
        tool(d, "Rectangle"),
        planar(d),
        cartesian(d, e1=[1, 0, 0], e2=[0, 1, 0]),
    ),
    "Cartesian constraint of direction 3 in a 2D model": lambda d: (
        tool(d, "Rectangle"),
        planar(d),
        cartesian(d, e1=[1, 0, 0], constrained=["3"]),
        find(d, "slide").pop("e2"),
    ),
}


def cylindrical(document, index=11, **fields):
    """A cylindrical constraint of the point set right (#422): its points turned
    about the axis x through the middle of the specimen, unless the fields change
    it."""
    command = {
        "command": "cylindrical.add",
        "name": "turn",
        "points": "right",
        "center": [0, 0.5, 0.5],
        "axis": [1, 0, 0],
        "constrained": ["theta"],
        **fields,
    }
    document["commands"].insert(index, command)


def axisymmetric(document):
    """An axisymmetric model of the rectangle made by a tool."""
    tool(document, "Rectangle")
    planar(document)
    find(document, "settings")["analysis"] = "axisymmetric"


# the cylindrical constraints (#422): like the Cartesian constraints, ramped by the
# steps and the curve of a job, with their axis and their values
CHANGES |= {
    "cylindrical constraint ramped and recorded": lambda d: (
        cylindrical(d, multiplier=1e4),
        find(d, "step_1")["ramp"]["items"].append({"target": "turn", "end": 0.2}),
        find(d, "job_1").update(curve="turn"),
    ),
    "cylindrical constraint ramped per direction": lambda d: (
        cylindrical(d, constrained=["z", "r"], value=[0.1, 0.2]),
        find(d, "step_1")["ramp"]["items"].append(
            {"target": "turn", "start": [0, 0], "end": [0.1, "stroke"]}
        ),
        parameters(d),
    ),
    "cylindrical constraint about z through the origin": lambda d: (
        cylindrical(d, constrained=["r"]),
        find(d, "turn").pop("center"),
        find(d, "turn").pop("axis"),
    ),
    "cylindrical constraint with an axis of zero length": lambda d: cylindrical(
        d, axis=[0, 0, 0]
    ),
    "cylindrical constraint with a value per direction": lambda d: cylindrical(
        d, value=[0.1, 0.2]
    ),
    "cylindrical constraint ramped with values per direction": lambda d: (
        cylindrical(d, constrained=["r", "theta"]),
        find(d, "step_1")["ramp"]["items"].append(
            {"target": "turn", "end": [0.1, 0.2, 0.3]}
        ),
    ),
    "cylindrical constraint off in a step that ramps it": lambda d: (
        cylindrical(d),
        glue(d),
        find(d, "step_1").update(constraints=["glue"]),
        find(d, "step_1")["ramp"]["items"].append({"target": "turn", "end": 0.1}),
    ),
    "cylindrical constraint of a control point": lambda d: (
        d["commands"].insert(
            9, {"command": "point.add", "name": "pin", "coordinates": [4, 0, 0]}
        ),
        cylindrical(d, 12, points="pin", constrained=["r", "theta", "z"]),
    ),
    "cylindrical constraint in a 2D model": lambda d: (
        tool(d, "Rectangle"),
        planar(d),
        cylindrical(d, center=[0, -1, 0], constrained=["r"], value=-0.1),
        find(d, "turn").pop("axis"),
        find(d, "job_1").update(curve="turn"),
    ),
    "cylindrical constraint about z in a 2D model": lambda d: (
        tool(d, "Rectangle"),
        planar(d),
        cylindrical(d, center=[0, -1, 0], axis=[0, 0, 2]),
    ),
    "cylindrical constraint with a center in z in a 2D model": lambda d: (
        tool(d, "Rectangle"),
        planar(d),
        cylindrical(d, center=[0, -1, 1]),
        find(d, "turn").pop("axis"),
    ),
    "cylindrical constraint with an axis not z in a 2D model": lambda d: (
        tool(d, "Rectangle"),
        planar(d),
        cylindrical(d, center=[0, -1, 0]),
    ),
    "cylindrical constraint of z in a 2D model": lambda d: (
        tool(d, "Rectangle"),
        planar(d),
        cylindrical(d, center=[0, -1, 0], constrained=["z"]),
        find(d, "turn").pop("axis"),
    ),
    "cylindrical constraint in an axisymmetric model": lambda d: (
        axisymmetric(d),
        cylindrical(d, center=[0, 0, 0], constrained=["r"]),
        find(d, "turn").pop("axis"),
    ),
}

# every formulation of the registry with every kind of material (ADR 0024): the rule
# that the material fits the formulation, the same in both languages
MATERIAL_KINDS = {
    "an incompressible material": ("NeoHooke", {"mu": 1}),
    "a material with a bulk modulus": ("NeoHooke", {"mu": 1, "bulk": 5000}),
    "a compressible material": ("NeoHookeCompressible", {"mu": 1, "lmbda": 5000}),
    "a strain-based material": ("LinearElastic", {"E": 210000, "nu": 0.3}),
}


# the user-defined materials of files (ADR 0025): with a volumetric part of their own
# (the default), and without one
SCRIPT_KINDS = {
    "a material of a file": {},
    "a material of a file without a volumetric part": {"volumetric": False},
    # a strain energy function of a file (#424): with a bulk modulus, or isochoric
    "a strain energy function of a file": {
        "kind": "hyperelastic",
        "arguments": {"mu": 1.0},
    },
    "a strain energy function of a file with a bulk modulus": {
        "kind": "hyperelastic",
        "arguments": {"mu": 1.0},
        "bulk": 5000,
    },
}


def material_script(document, **fields):
    """The material umat_soft of a file (ADR 0025), not a model of the registry."""
    soft = find(document, "umat_soft")
    soft.clear()
    soft.update(
        command="material.script",
        name="umat_soft",
        kind="constitutive",
        file="soft.py",
    )
    soft.update(fields)


def function_script(document, **fields):
    """The material umat_soft of a strain energy function of a file (#424)."""
    material_script(document, kind="hyperelastic", **fields)


def formulation(document, name, model, parameters):
    """The section soft of a formulation, with the bulk modulus if the formulation
    has one, and its material of a model."""
    find(document, "umat_soft").update(model=model, parameters=parameters)
    formulation_of_soft(document, name)


def script_formulation(document, name, fields):
    """The section soft of a formulation, and its material of a file."""
    material_script(document, **fields)
    formulation_of_soft(document, name)


def formulation_of_soft(document, name):
    """The section soft of a formulation, with the bulk modulus if the formulation
    has one."""
    section = find(document, "section_soft")
    section.pop("bulk", None)
    section["formulation"] = name
    if "bulk" in SECTIONS[name]["required"]:
        section["bulk"] = 5000


SECTIONS = {
    node["properties"]["formulation"]["const"]: node
    for node in (
        schema()["$defs"][ref["$ref"].split("/")[-1]]
        for ref in schema()["$defs"]["SectionAdd"]["oneOf"]
    )
}

CHANGES |= {
    f"formulation {name} with {kind}": (
        lambda d, name=name, material=material: formulation(d, name, *material)
    )
    for name in formulations()
    for kind, material in MATERIAL_KINDS.items()
}
CHANGES |= {
    f"formulation {name} with {kind}": (
        lambda d, name=name, fields=fields: script_formulation(d, name, fields)
    )
    for name in formulations()
    for kind, fields in SCRIPT_KINDS.items()
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
