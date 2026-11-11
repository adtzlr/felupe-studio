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
import os
import re
from pathlib import Path

import felupe as fem
import meshio
import numpy as np

from felupe_studio.codegen import codegen
from felupe_studio.commands import SCHEMA_VERSION
from felupe_studio.project import dumps

HERE = Path(__file__).parents[1] / "public" / "samples"
INDEX = Path(__file__).parents[1] / "src" / "core" / "samples.json"
PALETTE = Path(__file__).parents[1] / "src" / "viewer" / "palette.ts"

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
    (folder / "thumbnail.svg").write_text(thumbnail(folder), encoding="utf-8")


# the corner points of the faces of the solid cells, numbered like meshio
FACES = {
    "hexahedron": [
        [0, 3, 2, 1],
        [4, 5, 6, 7],
        [0, 1, 5, 4],
        [1, 2, 6, 5],
        [2, 3, 7, 6],
        [3, 0, 4, 7],
    ],
    "tetra": [[0, 2, 1], [0, 1, 3], [1, 2, 3], [0, 3, 2]],
}
# quadratic cells and the MINI element (tetra5): the faces of their corner points
FACES["hexahedron20"] = FACES["hexahedron27"] = FACES["hexahedron"]
FACES["tetra5"] = FACES["tetra10"] = FACES["tetra"]


def _view(azimuth=-55, elevation=20.264):
    """The camera basis (right, up, back) of the default view of the viewer."""
    az, el = np.radians(azimuth), np.radians(elevation)
    back = np.array([np.cos(el) * np.cos(az), np.cos(el) * np.sin(az), np.sin(el)])
    right = np.cross([0, 0, 1], back)
    right /= np.linalg.norm(right)
    return right, np.cross(back, right), back


def thumbnail(folder, width=160, height=100, margin=6):
    """An SVG picture of a sample (#127): the outer faces of its sections in the
    default view of the viewer and in their colors, with the edges of the cells.

    The model is built by the generated script without evaluating the jobs, so the
    picture shows exactly the sections of the app (cell sets, merged points)."""
    document = loads_project(folder)
    colors = re.findall(r'"(#[0-9a-f]{6})", //', PALETTE.read_text(encoding="utf-8"))
    namespace = {}
    cwd = os.getcwd()
    os.chdir(folder)
    try:
        exec(codegen(document, evaluate=False), namespace)
    finally:
        os.chdir(cwd)
    sections = [c for c in document["commands"] if c["command"] == "section.add"]
    faces = {}  # sorted corner points -> (corner points, cell center, color)
    for i, section in enumerate(sections):
        mesh = namespace[f"solid_{section['name']}"].field[0].region.mesh
        for cell in mesh.cells:
            center = mesh.points[cell].mean(axis=0)
            for face in FACES[mesh.cell_type]:
                corners = cell[face]
                key = tuple(sorted(corners))
                if key in faces:
                    del faces[key]  # inner face, shared by two cells
                else:
                    faces[key] = (corners, center, colors[i % len(colors)], mesh)
    right, up, back = _view()
    light = back + 0.5 * up - 0.3 * right
    light /= np.linalg.norm(light)
    polygons = []
    for corners, center, color, mesh in faces.values():
        x = mesh.points[corners]
        normal = np.cross(x[1] - x[0], x[2] - x[0])
        normal /= np.linalg.norm(normal)
        if normal @ (x.mean(axis=0) - center) < 0:
            normal = -normal
        if normal @ back <= 1e-9:
            continue  # facing away from the camera
        shade = 0.5 + 0.5 * max(0.0, normal @ light)
        rgb = [int(color[k : k + 2], 16) for k in (1, 3, 5)]
        fill = "#" + "".join(f"{round(c * shade):02x}" for c in rgb)
        polygons.append((float(x.mean(axis=0) @ back), x @ right, -(x @ up), fill))
    polygons.sort(key=lambda p: p[0])
    xy = np.vstack([np.column_stack([p[1], p[2]]) for p in polygons])
    lower, upper = xy.min(axis=0), xy.max(axis=0)
    scale = min(
        (width - 2 * margin) / (upper - lower)[0],
        (height - 2 * margin) / (upper - lower)[1],
    )
    offset = (np.array([width, height]) - scale * (upper - lower)) / 2
    lines = [
        f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {width} {height}">',
        '<g stroke="#000" stroke-opacity="0.55" stroke-width="0.4" '
        'stroke-linejoin="round">',
    ]
    for _, px, py, fill in polygons:
        points = scale * (np.column_stack([px, py]) - lower) + offset
        text = " ".join(f"{u:.1f},{v:.1f}" for u, v in points)
        lines.append(f'<polygon points="{text}" fill="{fill}"/>')
    lines += ["</g>", "</svg>", ""]
    return "\n".join(lines)


def loads_project(folder):
    """The command list of a sample."""
    return json.loads((folder / "model.felupe.json").read_text(encoding="utf-8"))


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
