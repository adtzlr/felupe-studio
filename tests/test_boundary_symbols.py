"""The boundaries of the load cases in the viewport of the app follow ``fem.dof``.

``app/src/viewer/boundaries.ts`` draws the boundaries of a load case without Python.
This test writes what FElupe makes of a set of load cases on two boxes (one at the
symmetry planes, one beside them) and compares it with the fixture of the app test
(``app/src/viewer/boundaries.fixture.json``); with ``UPDATE_FIXTURES=1`` it writes the
fixture.
"""

import json
import os
from pathlib import Path

import felupe as fem
import numpy as np

from felupe_studio.loadcases import loadcase_call

FIXTURE = Path(__file__).parents[1] / "app/src/viewer/boundaries.fixture.json"

LOADCASES = [
    {"type": "uniaxial"},
    {"type": "uniaxial", "axis": "y", "clamped": True},
    {"type": "uniaxial", "axis": "z", "clamped": True, "symmetry": False},
    {"type": "biaxial"},
    {"type": "biaxial", "axis": "x", "second": "z", "clamped": True},
    {"type": "biaxial", "clamped": True, "symmetry": False},
    {"type": "planar", "axis": "y", "second": "x"},
    {"type": "shear"},
    {"type": "shear", "axis": "z", "normal": "x", "compression": -0.1},
    {"type": "shear", "axis": "x", "normal": "z", "symmetry": False},
]

MESHES = {
    # a box at the symmetry planes x = 0, y = 0 and z = 0
    "corner": fem.Cube(b=(2, 1, 1), n=(3, 2, 3)),
    # a box beside them
    "shifted": fem.Cube(a=(1, -1, 0.5), b=(2.5, 1, 2), n=(3, 3, 2)),
}


def boundaries(mesh, loadcase):
    """The boundaries that FElupe makes of a load case on a mesh, by key."""
    field = fem.FieldContainer([fem.Field(fem.RegionHexahedron(mesh), dim=3)])
    func, args = loadcase_call({"name": "lc", **loadcase})
    result = eval(f"{func}({', '.join(args)})", {"fem": fem, "field": field})
    return {
        key: {
            "points": sorted(int(p) for p in boundary.points),
            "components": sorted(int(c) for c in np.unique(boundary.dof % 3)),
            "value": float(boundary.value),
        }
        for key, boundary in result.items()
    }


def expected():
    return {
        name: {
            "points": mesh.points.ravel().tolist(),
            "cases": [
                {"loadcase": loadcase, "boundaries": boundaries(mesh, loadcase)}
                for loadcase in LOADCASES
            ],
        }
        for name, mesh in MESHES.items()
    }


def test_fixture_of_the_app_is_up_to_date():
    data = expected()
    if os.environ.get("UPDATE_FIXTURES"):
        FIXTURE.write_text(json.dumps(data, indent=1) + "\n", encoding="utf-8")
    assert json.loads(FIXTURE.read_text(encoding="utf-8")) == data
