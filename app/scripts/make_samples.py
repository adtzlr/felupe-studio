"""Create the sample models of the app (``File ▸ Samples``, #32).

Every sample is a folder in ``app/public/samples`` with a project file
``model.felupe.json`` and its mesh files; ``app/src/core/samples.json`` lists them for
the app (title, description, topics and files). The samples are committed; this
script documents how they were made and writes them again. Run it from the
repository root with ``python app/scripts/make_samples.py``.
``tests/test_samples.py`` solves every sample with FElupe.

Units: mm, N and MPa.
"""

import json
from pathlib import Path

import felupe as fem
import meshio
import numpy as np

from felupe_studio.commands import SCHEMA_VERSION
from felupe_studio.project import dumps

HERE = Path(__file__).parents[1] / "public" / "samples"
INDEX = Path(__file__).parents[1] / "src" / "core" / "samples.json"

# the samples of the app, in the order of the list
SAMPLES = [
    {
        "id": "two-materials",
        "title": "Bar of two materials",
        "description": "A bar with a stiff and a soft half from a cell tag, pulled at "
        "its clamped end.",
        "topics": ["VTU cell tag", "u and u-p-J", "force-displacement curve"],
    },
    {
        "id": "material-test",
        "title": "Material test: uniaxial tension",
        "description": "An eighth of a cube with symmetry planes, stretched to twice "
        "its length; the curve is the analytical one of the incompressible "
        "Neo-Hooke model.",
        "topics": ["load case", "symmetry", "u-p-J"],
    },
    {
        "id": "hex-tet-gmsh",
        "title": "Hexahedrons and tetrahedrons",
        "description": "A Gmsh file with hexahedrons and tetrahedrons, one mesh per "
        "type of cells, both nearly incompressible.",
        "topics": ["Gmsh", "two cell types", "MINI element"],
    },
    {
        "id": "rubber-mount",
        "title": "Rubber mount in shear",
        "description": "A rubber layer bonded between two steel plates, sheared by "
        "the top plate by its thickness.",
        "topics": ["Mooney-Rivlin", "three sections", "shear load case"],
    },
    {
        "id": "glued-plate",
        "title": "Rubber block with a rigid plate",
        "description": "A rubber block on a fixed base, its top face glued to a rigid "
        "plate that is moved sideways and tilted at the same time.",
        "topics": [
            "control points",
            "multi-point constraint",
            "rotation point",
            "ramps with their own values",
        ],
    },
]


def write(folder, commands, meshes):
    """Write the project file and the mesh files (name: meshio.Mesh) of a sample."""
    folder = HERE / folder
    folder.mkdir(parents=True, exist_ok=True)
    next(s for s in SAMPLES if s["id"] == folder.name)["files"] = sorted(meshes)
    for name, mesh in meshes.items():
        kwargs = {"file_format": "gmsh22"} if name.endswith(".msh") else {}
        mesh.write(folder / name, binary=False, **kwargs)
    document = {"schema_version": SCHEMA_VERSION, "commands": commands}
    (folder / "model.felupe.json").write_text(dumps(document), encoding="utf-8")


def rubber_mount():
    """A rubber block bonded between two steel plates, sheared by the top plate."""
    plate, rubber, side, n = 5.0, 20.0, 40.0, 8
    layers = [(0, plate, 1, 1), (plate, plate + rubber, 4, 2)]
    layers.append((plate + rubber, 2 * plate + rubber, 1, 3))
    meshes, tags = [], []
    for z0, z1, nz, tag in layers:
        mesh = fem.Cube(a=(0, 0, z0), b=(side, side, z1), n=(n + 1, n + 1, nz + 1))
        meshes.append(mesh)
        tags.append(np.full(mesh.ncells, tag))
    mesh = fem.mesh.concatenate(meshes).sweep(decimals=8)
    cells = meshio.Mesh(
        mesh.points,
        [("hexahedron", mesh.cells)],
        cell_data={"part": [np.concatenate(tags)]},
    )
    commands = [
        {"command": "mesh.import", "name": "mount", "file": "mount.vtu", "tag": "part"},
        {
            "command": "cellset.from_tag",
            "name": "bottom_plate",
            "mesh": "mount",
            "value": 1,
        },
        {
            "command": "cellset.from_tag",
            "name": "rubber_layer",
            "mesh": "mount",
            "value": 2,
        },
        {
            "command": "cellset.from_tag",
            "name": "top_plate",
            "mesh": "mount",
            "value": 3,
        },
        {
            "command": "material.add",
            "name": "steel",
            "model": "LinearElasticLargeStrain",
            "parameters": {"E": 210000, "nu": 0.3},
        },
        {
            "command": "material.add",
            "name": "rubber",
            "model": "MooneyRivlin",
            "parameters": {"C10": 0.4, "C01": 0.1},
        },
        {
            "command": "section.add",
            "name": "bottom",
            "cellset": "bottom_plate",
            "material": "steel",
            "formulation": "u",
        },
        {
            "command": "section.add",
            "name": "block",
            "cellset": "rubber_layer",
            "material": "rubber",
            "formulation": "u-p-J",
            "bulk": 2000,
        },
        {
            "command": "section.add",
            "name": "top",
            "cellset": "top_plate",
            "material": "steel",
            "formulation": "u",
        },
        {
            "command": "loadcase.add",
            "name": "shear",
            "type": "shear",
            "axis": "x",
            "normal": "z",
            "symmetry": False,
        },
        {
            "command": "step.add",
            "name": "shearing",
            "ramp": {"num": 10, "items": [{"target": "shear", "end": 20}]},
        },
        {"command": "job.add", "name": "job", "steps": ["shearing"], "curve": "shear"},
    ]
    write("rubber-mount", commands, {"mount.vtu": cells})


def glued_plate():
    """A rubber block whose top face follows a rigid plate (#102): a multi-point
    constraint to a control point above the face, with a rotation point. The plate
    is moved in x by 8 mm and tilted about y by 0.1 rad in the same step."""
    mesh = fem.Cube(b=(40, 40, 20), n=(9, 9, 5))
    cells = meshio.Mesh(mesh.points, [("hexahedron", mesh.cells)])
    commands = [
        {"command": "mesh.import", "name": "block", "file": "block.vtu"},
        {"command": "cellset.from_file", "name": "all_cells", "mesh": "block"},
        {
            "command": "material.add",
            "name": "rubber",
            "model": "MooneyRivlin",
            "parameters": {"C10": 0.4, "C01": 0.1},
        },
        {
            "command": "section.add",
            "name": "rubber_block",
            "cellset": "all_cells",
            "material": "rubber",
            "formulation": "u-p-J",
            "bulk": 2000,
        },
        {
            "command": "pointset.add",
            "name": "base",
            "select": {"axis": "z", "value": 0},
        },
        {
            "command": "pointset.add",
            "name": "top",
            "select": {"axis": "z", "value": 20},
        },
        # the center of the plate above the top face, and its rotation point beside
        # it (points at the same coordinates would be merged)
        {"command": "point.add", "name": "plate", "coordinates": [20, 20, 25]},
        {"command": "point.add", "name": "tilt", "coordinates": [20, 20, 30]},
        {
            "command": "boundary.add",
            "name": "fixed",
            "pointset": "base",
            "constrained": ["x", "y", "z"],
        },
        {
            "command": "boundary.add",
            "name": "shift",
            "pointset": "plate",
            "constrained": ["x"],
        },
        {
            "command": "boundary.add",
            "name": "hold",
            "pointset": "plate",
            "constrained": ["y", "z"],
        },
        {
            "command": "boundary.add",
            "name": "tilt_y",
            "pointset": "tilt",
            "constrained": ["y"],
        },
        {
            "command": "boundary.add",
            "name": "tilt_lock",
            "pointset": "tilt",
            "constrained": ["x", "z"],
        },
        {
            "command": "mpc.add",
            "name": "glue",
            "points": "top",
            "center": "plate",
            "constrained": ["x", "y", "z"],
            "rotation": "tilt",
        },
        {
            "command": "step.add",
            "name": "shift_and_tilt",
            "ramp": {
                "num": 8,
                "items": [
                    {"target": "shift", "end": 8},
                    {"target": "tilt_y", "end": 0.1},
                ],
            },
        },
        {
            "command": "job.add",
            "name": "job",
            "steps": ["shift_and_tilt"],
            "curve": "shift",
        },
    ]
    write("glued-plate", commands, {"block.vtu": cells})


def two_materials():
    """A bar with a stiff and a soft half, from the cell tag "material"."""
    mesh = fem.Cube(b=(30, 10, 10), n=(13, 5, 5))
    centers = mesh.points[mesh.cells].mean(axis=1)
    tag = np.where(centers[:, 0] < 15, 1, 2)
    cells = meshio.Mesh(
        mesh.points, [("hexahedron", mesh.cells)], cell_data={"material": [tag]}
    )
    commands = [
        {"command": "mesh.import", "name": "bar", "file": "bar.vtu", "tag": "material"},
        {"command": "cellset.from_tag", "name": "stiff", "mesh": "bar", "value": 1},
        {"command": "cellset.from_tag", "name": "soft", "mesh": "bar", "value": 2},
        {
            "command": "material.add",
            "name": "plastic",
            "model": "LinearElasticLargeStrain",
            "parameters": {"E": 100, "nu": 0.3},
        },
        {
            "command": "material.add",
            "name": "rubber",
            "model": "NeoHooke",
            "parameters": {"mu": 1},
        },
        {
            "command": "section.add",
            "name": "stiff_half",
            "cellset": "stiff",
            "material": "plastic",
            "formulation": "u",
        },
        {
            "command": "section.add",
            "name": "soft_half",
            "cellset": "soft",
            "material": "rubber",
            "formulation": "u-p-J",
            "bulk": 5000,
        },
        {
            "command": "pointset.add",
            "name": "left",
            "select": {"axis": "x", "value": 0},
        },
        {
            "command": "pointset.add",
            "name": "right",
            "select": {"axis": "x", "value": 30},
        },
        {
            "command": "boundary.add",
            "name": "fixed",
            "pointset": "left",
            "constrained": ["x", "y", "z"],
        },
        {
            "command": "boundary.add",
            "name": "clamp",
            "pointset": "right",
            "constrained": ["y", "z"],
        },
        {
            "command": "boundary.add",
            "name": "pull",
            "pointset": "right",
            "constrained": ["x"],
        },
        {
            "command": "step.add",
            "name": "tension",
            "ramp": {"num": 10, "items": [{"target": "pull", "end": 15}]},
        },
        {"command": "job.add", "name": "job", "steps": ["tension"], "curve": "pull"},
    ]
    write("two-materials", commands, {"bar.vtu": cells})


def material_test():
    """An eighth of a cube in uniaxial tension (load case with symmetry planes)."""
    mesh = fem.Cube(n=4)
    cells = meshio.Mesh(mesh.points, [("hexahedron", mesh.cells)])
    commands = [
        {"command": "mesh.import", "name": "cube", "file": "cube.vtu"},
        {"command": "cellset.from_file", "name": "all_cells", "mesh": "cube"},
        {
            "command": "material.add",
            "name": "rubber",
            "model": "NeoHooke",
            "parameters": {"mu": 0.5},
        },
        {
            "command": "section.add",
            "name": "specimen",
            "cellset": "all_cells",
            "material": "rubber",
            "formulation": "u-p-J",
            "bulk": 5000,
        },
        {"command": "loadcase.add", "name": "tension", "type": "uniaxial", "axis": "x"},
        {
            "command": "step.add",
            "name": "stretch",
            "ramp": {"num": 10, "items": [{"target": "tension", "end": 1}]},
        },
        {"command": "job.add", "name": "job", "steps": ["stretch"], "curve": "tension"},
    ]
    write("material-test", commands, {"cube.vtu": cells})


def hex_tet():
    """A Gmsh file with hexahedrons (x < 15) and tetrahedrons (x > 15)."""
    mesh = fem.Cube(b=(30, 10, 10), n=(13, 5, 5))
    centers = mesh.points[mesh.cells].mean(axis=1)
    left = mesh.cells[centers[:, 0] < 15]
    right = fem.Mesh(
        mesh.points, mesh.cells[centers[:, 0] > 15], "hexahedron"
    ).triangulate()
    blocks = [("hexahedron", left), ("tetra", right.cells)]
    cells = meshio.Mesh(
        mesh.points,
        blocks,
        cell_data={
            "gmsh:physical": [
                np.full(len(c), i + 1) for i, (_, c) in enumerate(blocks)
            ],
            "gmsh:geometrical": [
                np.full(len(c), i + 1) for i, (_, c) in enumerate(blocks)
            ],
        },
    )
    commands = [
        {
            "command": "mesh.import",
            "name": "bar_hexahedron",
            "file": "bar.msh",
            "cell_type": "hexahedron",
        },
        {
            "command": "mesh.import",
            "name": "bar_tetra",
            "file": "bar.msh",
            "cell_type": "tetra",
        },
        {
            "command": "cellset.from_file",
            "name": "hexahedrons",
            "mesh": "bar_hexahedron",
        },
        {"command": "cellset.from_file", "name": "tetrahedrons", "mesh": "bar_tetra"},
        {
            "command": "material.add",
            "name": "rubber",
            "model": "NeoHooke",
            "parameters": {"mu": 1},
        },
        {
            "command": "section.add",
            "name": "hex_part",
            "cellset": "hexahedrons",
            "material": "rubber",
            "formulation": "u-p-J",
            "bulk": 5000,
        },
        {
            "command": "section.add",
            "name": "tet_part",
            "cellset": "tetrahedrons",
            "material": "rubber",
            "formulation": "u-p-J",
            "bulk": 5000,
        },
        {
            "command": "pointset.add",
            "name": "left",
            "select": {"axis": "x", "value": 0},
        },
        {
            "command": "pointset.add",
            "name": "right",
            "select": {"axis": "x", "value": 30},
        },
        {
            "command": "boundary.add",
            "name": "fixed",
            "pointset": "left",
            "constrained": ["x", "y", "z"],
        },
        {
            "command": "boundary.add",
            "name": "pull",
            "pointset": "right",
            "constrained": ["x"],
        },
        {
            "command": "step.add",
            "name": "tension",
            "ramp": {"num": 5, "items": [{"target": "pull", "end": 15}]},
        },
        {"command": "job.add", "name": "job", "steps": ["tension"], "curve": "pull"},
    ]
    write("hex-tet-gmsh", commands, {"bar.msh": cells})


def main():
    rubber_mount()
    two_materials()
    material_test()
    hex_tet()
    glued_plate()
    INDEX.write_text(json.dumps(SAMPLES, indent=2) + "\n", encoding="utf-8")


if __name__ == "__main__":
    main()
