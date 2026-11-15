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
        "id": "shear-mount",
        "title": "Mount in shear",
        "description": "A hyperelastic layer bonded between two steel plates, sheared "
        "by the top plate by its thickness.",
        "topics": ["Mooney-Rivlin", "three sections", "shear load case"],
    },
    {
        "id": "glued-plate",
        "title": "Hyperelastic block with a rigid plate",
        "description": "A hyperelastic block on a fixed base, its top face glued to a "
        "rigid plate that is moved sideways and tilted at the same time.",
        "topics": [
            "control points",
            "multi-point constraint",
            "rotation point",
            "ramps with their own values",
        ],
    },
    {
        "id": "sandwich-spring",
        "title": "Sandwich spring with parameters",
        "description": "Hyperelastic discs between steel sheets, sheared by the top "
        "sheet. A Python script makes the mesh from the radius, the number and the "
        "height of the layers, the thickness of the sheets and the fineness.",
        "topics": ["parameters", "mesh script", "point sets at bounds", "shear"],
    },
    {
        "id": "sandwich-spring-axisymmetric",
        "title": "Axisymmetric sandwich spring",
        "description": "The hyperelastic discs between steel sheets as an axisymmetric "
        "model: the section in the xy-plane, x is the axis. The first sheet is "
        "pressed along the axis against the fixed last one; the force is the total "
        "over the circumference.",
        "topics": ["axisymmetric", "2D mesh script", "parameters", "compression"],
    },
    {
        "id": "plate-with-hole",
        "title": "Plate with a hole in plane strain",
        "description": "A quarter of a hyperelastic plate with a hole and two symmetry "
        "planes, pulled at its end; the stresses concentrate at the hole. A script "
        "makes the mesh from the radius of the hole, the width and the fineness.",
        "topics": ["plane strain", "2D mesh script", "symmetry", "u-p-J"],
    },
    {
        "id": "bushing",
        "title": "Bushing with steel sleeves (FElupe ex05)",
        "description": "A hyperelastic bushing between two steel sleeves, the inner "
        "sleeve moved radially, twisted and tilted by a rigid connection. A script "
        "makes the mesh from the lengths of the sleeves, the runout and the fineness.",
        "topics": [
            "parameters",
            "mesh script",
            "point sets on cylinders",
            "rotation point",
        ],
    },
    {
        "id": "hyperelastic-spring",
        "title": "Hyperelastic spring with end stops (FElupe ex06)",
        "description": "A half of a hyperelastic spring bonded to two plates, "
        "compressed and then sheared by the lower plate. The plates are end stops, "
        "rigid planes in contact with the points on the outer surface with friction: "
        "the bulging spring touches the upper one and gets stiffer.",
        "topics": [
            "contacts",
            "rigid surfaces",
            "friction",
            "point set on the surface",
        ],
    },
]


def write(folder, commands, meshes):
    """Write the project file and the mesh files (name: meshio.Mesh, or the text of a
    script that makes meshes, #182) of a sample."""
    folder = HERE / folder
    folder.mkdir(parents=True, exist_ok=True)
    next(s for s in SAMPLES if s["id"] == folder.name)["files"] = sorted(meshes)
    for name, mesh in meshes.items():
        if isinstance(mesh, str):
            (folder / name).write_text(mesh, encoding="utf-8")
            continue
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
# the 2D cells of 2D models (#175) are faces in the xy-plane
FACES["quad"] = FACES["quad8"] = FACES["quad9"] = [[0, 1, 2, 3]]
FACES["triangle"] = FACES["triangle4"] = FACES["triangle6"] = [[0, 1, 2]]


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
    planar = False
    for i, section in enumerate(sections):
        mesh = namespace[f"solid_{section['name']}"].field[0].region.mesh
        # the cells of a 2D model in the plane z = 0, seen from z (#175)
        if mesh.dim == 2:
            planar = True
            mesh = fem.Mesh(
                np.pad(mesh.points, ((0, 0), (0, 1))), mesh.cells, mesh.cell_type
            )
        for cell in mesh.cells:
            center = mesh.points[cell].mean(axis=0)
            for face in FACES[mesh.cell_type]:
                corners = cell[face]
                key = tuple(sorted(corners))
                if key in faces:
                    del faces[key]  # inner face, shared by two cells
                else:
                    faces[key] = (corners, center, colors[i % len(colors)], mesh)
    right, up, back = np.eye(3) if planar else _view()
    light = back + 0.5 * up - 0.3 * right
    light /= np.linalg.norm(light)
    polygons = []
    for corners, center, color, mesh in faces.values():
        x = mesh.points[corners]
        normal = np.cross(x[1] - x[0], x[2] - x[0])
        if not np.linalg.norm(normal):
            # by the diagonals of a quad with a collapsed edge (e.g. at an axis)
            normal = np.cross(x[2] - x[0], x[-1] - x[1])
        if not np.linalg.norm(normal):
            continue  # a face without area
        normal /= np.linalg.norm(normal)
        if planar:
            normal = back
        elif normal @ (x.mean(axis=0) - center) < 0:
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


def shear_mount():
    """A hyperelastic block bonded between two steel plates, sheared by the top
    plate."""
    plate, soft, side, n = 5.0, 20.0, 40.0, 8
    layers = [(0, plate, 1, 1), (plate, plate + soft, 4, 2)]
    layers.append((plate + soft, 2 * plate + soft, 1, 3))
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
        {
            "command": "model.settings",
            "name": "settings",
            "units": {"length": "mm", "force": "N"},
        },
        {"command": "mesh.import", "name": "mount", "file": "mount.vtu", "tag": "part"},
        {
            "command": "cellset.from_tag",
            "name": "bottom_plate",
            "mesh": "mount",
            "value": 1,
        },
        {
            "command": "cellset.from_tag",
            "name": "soft_layer",
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
            "name": "hyperelastic",
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
            "cellset": "soft_layer",
            "material": "hyperelastic",
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
    write("shear-mount", commands, {"mount.vtu": cells})


def glued_plate():
    """A hyperelastic block whose top face follows a rigid plate (#102): a multi-point
    constraint to a control point above the face, with a rotation point. The plate
    is moved in x by 8 mm and tilted about y by 0.1 rad in the same step."""
    mesh = fem.Cube(b=(40, 40, 20), n=(9, 9, 5))
    cells = meshio.Mesh(mesh.points, [("hexahedron", mesh.cells)])
    commands = [
        {
            "command": "model.settings",
            "name": "settings",
            "units": {"length": "mm", "force": "N"},
        },
        {"command": "mesh.import", "name": "block", "file": "block.vtu"},
        {"command": "cellset.from_file", "name": "all_cells", "mesh": "block"},
        {
            "command": "material.add",
            "name": "hyperelastic",
            "model": "MooneyRivlin",
            "parameters": {"C10": 0.4, "C01": 0.1},
        },
        {
            "command": "section.add",
            "name": "soft_block",
            "cellset": "all_cells",
            "material": "hyperelastic",
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


# the script of the mesh of the sandwich spring (#184), run with the parameters
SANDWICH_SPRING = '''"""A sandwich spring: hyperelastic discs between steel sheets.

FElupe Studio runs this script with the parameters of the model as variables:
radius, layers, height, sheet, cells and cells_height. It makes a dict of two meshes
on the same points, the soft and the metal one, from the bottom: a sheet, then a
soft layer and a sheet per layer.
"""

import felupe as fem
import numpy as np

# the parameters of the model, or these values if the script runs alone
radius = globals().get("radius", 50)
layers = globals().get("layers", 3)
height = globals().get("height", 8)
sheet = globals().get("sheet", 2)
cells = globals().get("cells", 4)
cells_height = globals().get("cells_height", 2)

disc = fem.Circle(radius=radius, n=cells)

# the thickness and the number of cells through it of every layer, from the bottom:
# one cell through a sheet
thickness = [sheet] + [height, sheet] * layers
divisions = [1] + [cells_height, 1] * layers
bottom = np.concatenate([[0], np.cumsum(thickness)[:-1]])
parts = [
    disc.expand(n=n + 1, z=t).translate(z, axis=2)
    for t, n, z in zip(thickness, divisions, bottom, strict=True)
]

# all layers on the same points, merged at the faces between them
stack = fem.MeshContainer(parts, merge=True, decimals=8)
mesh = {
    "soft": fem.MeshContainer(stack.meshes[1::2]).stack(),
    "metal": fem.MeshContainer(stack.meshes[0::2]).stack(),
}
'''


def sandwich_spring():
    """Hyperelastic discs between steel sheets (#184), made by a script with parameters
    (#180, #182): the base sheet fixed, the top sheet sheared by 12 mm. The bottom
    and the top are point sets at the bounds of the meshes (#181), so they follow
    the number and the height of the layers."""

    def parameter(name, value, description, **options):
        return {
            "command": "parameter.add",
            "name": name,
            "value": value,
            **options,
            "description": description,
        }

    commands = [
        {
            "command": "model.settings",
            "name": "settings",
            "units": {"length": "mm", "force": "N"},
        },
        parameter(
            "radius",
            50,
            "Radius of the discs",
            quantity="length",
            min=20,
            max=100,
            step=5,
        ),
        parameter("layers", 3, "Number of soft layers", integer=True, min=1, max=6),
        parameter(
            "height",
            8,
            "Height of a soft layer",
            quantity="length",
            min=2,
            max=20,
            step=1,
        ),
        parameter(
            "sheet",
            2,
            "Thickness of a steel sheet",
            quantity="length",
            min=1,
            max=5,
            step=0.5,
        ),
        parameter(
            "cells",
            4,
            "Fineness of the discs (n of fem.Circle)",
            integer=True,
            min=2,
            max=8,
        ),
        parameter(
            "cells_height",
            2,
            "Number of cells through a soft layer",
            integer=True,
            min=1,
            max=8,
        ),
        {
            "command": "mesh.script",
            "name": "soft_mesh",
            "file": "sandwich_spring.py",
            "item": "soft",
        },
        {
            "command": "mesh.script",
            "name": "metal_mesh",
            "file": "sandwich_spring.py",
            "item": "metal",
        },
        {"command": "cellset.from_file", "name": "soft_cells", "mesh": "soft_mesh"},
        {"command": "cellset.from_file", "name": "metal_cells", "mesh": "metal_mesh"},
        {
            "command": "material.add",
            "name": "hyperelastic",
            "model": "NeoHooke",
            "parameters": {"mu": 0.5},
        },
        {
            "command": "material.add",
            "name": "steel",
            "model": "LinearElasticLargeStrain",
            "parameters": {"E": 210000, "nu": 0.3},
        },
        {
            "command": "section.add",
            "name": "soft_layers",
            "cellset": "soft_cells",
            "material": "hyperelastic",
            "formulation": "u-p-J",
            "bulk": 1000,
        },
        {
            "command": "section.add",
            "name": "steel_sheets",
            "cellset": "metal_cells",
            "material": "steel",
            "formulation": "u",
        },
        {
            "command": "pointset.add",
            "name": "base",
            "select": {"bound": "min", "axis": "z"},
        },
        {
            "command": "pointset.add",
            "name": "top",
            "select": {"bound": "max", "axis": "z"},
        },
        {
            "command": "boundary.add",
            "name": "fixed",
            "pointset": "base",
            "constrained": ["x", "y", "z"],
        },
        {
            "command": "boundary.add",
            "name": "shear",
            "pointset": "top",
            "constrained": ["x"],
        },
        # the top sheet is guided in y and z, by two boundaries, so that a ramp of
        # guide_z may compress the spring as well
        {
            "command": "boundary.add",
            "name": "guide_y",
            "pointset": "top",
            "constrained": ["y"],
        },
        {
            "command": "boundary.add",
            "name": "guide_z",
            "pointset": "top",
            "constrained": ["z"],
        },
        {
            "command": "step.add",
            "name": "shearing",
            "ramp": {"num": 8, "items": [{"target": "shear", "end": 12}]},
        },
        {"command": "job.add", "name": "job", "steps": ["shearing"], "curve": "shear"},
    ]
    write("sandwich-spring", commands, {"sandwich_spring.py": SANDWICH_SPRING})


# the script of the mesh of the axisymmetric sandwich spring (#175)
SANDWICH_SPRING_2D = '''"""A sandwich spring as an axisymmetric model.

The section of hyperelastic discs between steel sheets in the xy-plane: x is the axis of
rotation, y the radius. FElupe Studio runs this script with the parameters of the
model as variables: radius, layers, height, sheet, cells and cells_height. It makes
a dict of two meshes on the same points, the soft and the metal one, along the
axis: a sheet, then a soft layer and a sheet per layer.
"""

import felupe as fem
import numpy as np

# the parameters of the model, or these values if the script runs alone
radius = globals().get("radius", 50)
layers = globals().get("layers", 3)
height = globals().get("height", 8)
sheet = globals().get("sheet", 2)
cells = globals().get("cells", 10)
cells_height = globals().get("cells_height", 4)

# the thickness and the number of cells through it of every layer, along the axis:
# one cell through a sheet
thickness = [sheet] + [height, sheet] * layers
divisions = [1] + [cells_height, 1] * layers
start = np.concatenate([[0], np.cumsum(thickness)[:-1]])
parts = [
    fem.Rectangle(a=(x, 0), b=(x + t, radius), n=(n + 1, cells + 1))
    for t, n, x in zip(thickness, divisions, start, strict=True)
]

# all layers on the same points, merged at the edges between them
stack = fem.MeshContainer(parts, merge=True, decimals=8)
mesh = {
    "soft": fem.MeshContainer(stack.meshes[1::2]).stack(),
    "metal": fem.MeshContainer(stack.meshes[0::2]).stack(),
}
'''


def parameter(name, value, description, **options):
    """A parameter of a sample (#180)."""
    return {
        "command": "parameter.add",
        "name": name,
        "value": value,
        **options,
        "description": description,
    }


def sandwich_spring_axisymmetric():
    """The sandwich spring of #184 as an axisymmetric model (#175): the section of
    the hyperelastic discs and the steel sheets in the xy-plane, made by a script with
    the same parameters. The first sheet (x == min) is pressed by 4 mm along the axis
    against the fixed last sheet (x == max); the axis is a symmetry plane y = 0."""
    commands = [
        {
            "command": "model.settings",
            "name": "settings",
            "analysis": "axisymmetric",
            "units": {"length": "mm", "force": "N"},
        },
        parameter(
            "radius",
            50,
            "Radius of the discs",
            quantity="length",
            min=20,
            max=100,
            step=5,
        ),
        parameter("layers", 3, "Number of soft layers", integer=True, min=1, max=6),
        parameter(
            "height",
            8,
            "Height of a soft layer",
            quantity="length",
            min=2,
            max=20,
            step=1,
        ),
        parameter(
            "sheet",
            2,
            "Thickness of a steel sheet",
            quantity="length",
            min=1,
            max=5,
            step=0.5,
        ),
        parameter(
            "cells",
            10,
            "Number of cells along the radius",
            integer=True,
            min=4,
            max=30,
        ),
        parameter(
            "cells_height",
            4,
            "Number of cells through a soft layer",
            integer=True,
            min=1,
            max=12,
        ),
        {
            "command": "mesh.script",
            "name": "soft_mesh",
            "file": "sandwich_spring_2d.py",
            "item": "soft",
        },
        {
            "command": "mesh.script",
            "name": "metal_mesh",
            "file": "sandwich_spring_2d.py",
            "item": "metal",
        },
        {"command": "cellset.from_file", "name": "soft_cells", "mesh": "soft_mesh"},
        {"command": "cellset.from_file", "name": "metal_cells", "mesh": "metal_mesh"},
        {
            "command": "material.add",
            "name": "hyperelastic",
            "model": "NeoHooke",
            "parameters": {"mu": 0.5},
        },
        {
            "command": "material.add",
            "name": "steel",
            "model": "LinearElasticLargeStrain",
            "parameters": {"E": 210000, "nu": 0.3},
        },
        {
            "command": "section.add",
            "name": "soft_layers",
            "cellset": "soft_cells",
            "material": "hyperelastic",
            "formulation": "u-p-J",
            "bulk": 1000,
        },
        {
            "command": "section.add",
            "name": "steel_sheets",
            "cellset": "metal_cells",
            "material": "steel",
            "formulation": "u",
        },
        {
            "command": "pointset.add",
            "name": "first",
            "select": {"bound": "min", "axis": "x"},
        },
        {
            "command": "pointset.add",
            "name": "last",
            "select": {"bound": "max", "axis": "x"},
        },
        {"command": "symmetry.add", "name": "axis", "axes": ["y"]},
        {
            "command": "boundary.add",
            "name": "fixed",
            "pointset": "last",
            "constrained": ["x", "y"],
        },
        {
            "command": "boundary.add",
            "name": "press",
            "pointset": "first",
            "constrained": ["x"],
        },
        {
            "command": "boundary.add",
            "name": "guide",
            "pointset": "first",
            "constrained": ["y"],
        },
        {
            "command": "step.add",
            "name": "pressing",
            "ramp": {"num": 8, "items": [{"target": "press", "end": 4}]},
        },
        {"command": "job.add", "name": "job", "steps": ["pressing"], "curve": "press"},
    ]
    write(
        "sandwich-spring-axisymmetric",
        commands,
        {"sandwich_spring_2d.py": SANDWICH_SPRING_2D},
    )


# the script of the mesh of the plate with a hole (#175)
PLATE_WITH_HOLE = '''"""A quarter of a plate with a hole, in the xy-plane.

FElupe Studio runs this script with the parameters of the model as variables: the
radius of the hole, the half width of the square plate and the fineness. The
quarter is made of two patches between the arc of the hole and the edges x = width
and y = width, which meet at 45 degrees.
"""

import felupe as fem
import numpy as np

# the parameters of the model, or these values if the script runs alone
radius = globals().get("radius", 10)
width = globals().get("width", 40)
cells = globals().get("cells", 8)


def patch(start, end, edge):
    """The cells between the arc of the hole and an edge of the plate."""
    phi = np.linspace(start, end, cells + 1)
    arc = fem.mesh.Line(n=cells + 1)
    arc.update(points=radius * np.column_stack([np.cos(phi), np.sin(phi)]))
    outer = fem.mesh.Line(n=cells + 1)
    outer.update(points=edge(phi))
    return fem.mesh.fill_between(arc, outer, n=cells + 1).flip()


right = patch(
    0,
    np.pi / 4,
    lambda phi: np.column_stack([np.full_like(phi, width), width * np.tan(phi)]),
)
top = patch(
    np.pi / 4,
    np.pi / 2,
    lambda phi: np.column_stack(
        [width * np.cos(phi) / np.sin(phi), np.full_like(phi, width)]
    ),
)
mesh = fem.MeshContainer([right, top], merge=True, decimals=8).stack()
'''


def plate_with_hole():
    """A quarter of a hyperelastic plate with a hole in plane strain (#175), made by a
    script with parameters: symmetry planes x = 0 and y = 0, the end x == max pulled by
    8 mm. The force is per unit thickness."""
    commands = [
        {
            "command": "model.settings",
            "name": "settings",
            "analysis": "plane-strain",
            "units": {"length": "mm", "force": "N"},
        },
        parameter(
            "radius",
            10,
            "Radius of the hole",
            quantity="length",
            min=2,
            max=30,
            step=1,
        ),
        parameter(
            "width",
            40,
            "Half width of the plate",
            quantity="length",
            min=35,
            max=100,
            step=5,
        ),
        parameter(
            "cells", 8, "Number of cells along an edge", integer=True, min=3, max=20
        ),
        {
            "command": "mesh.script",
            "name": "plate_mesh",
            "file": "plate_with_hole.py",
        },
        {"command": "cellset.from_file", "name": "plate_cells", "mesh": "plate_mesh"},
        {
            "command": "material.add",
            "name": "hyperelastic",
            "model": "NeoHooke",
            "parameters": {"mu": 0.5},
        },
        {
            "command": "section.add",
            "name": "plate",
            "cellset": "plate_cells",
            "material": "hyperelastic",
            "formulation": "u-p-J",
            "bulk": 1000,
        },
        {"command": "symmetry.add", "name": "quarter", "axes": ["x", "y"]},
        {
            "command": "pointset.add",
            "name": "end",
            "select": {"bound": "max", "axis": "x"},
        },
        {
            "command": "boundary.add",
            "name": "pull",
            "pointset": "end",
            "constrained": ["x"],
        },
        {
            "command": "step.add",
            "name": "pulling",
            "ramp": {"num": 8, "items": [{"target": "pull", "end": 8}]},
        },
        {"command": "job.add", "name": "job", "steps": ["pulling"], "curve": "pull"},
    ]
    write("plate-with-hole", commands, {"plate_with_hole.py": PLATE_WITH_HOLE})


# the script of the mesh of the bushing (#185), like the example ex05 of FElupe
BUSHING = '''"""A bushing with steel sleeves, like the example ex05 of FElupe.

FElupe Studio runs this script with the parameters of the model as variables:
the lengths of the sleeves, their thickness, the runout of the soft body and the
fineness of the mesh. The inner sleeve is inside at the radius 25, the outer sleeve
outside at the radius 65 (the point sets of the model). It makes a dict of the
soft and the metal meshes, revolved about the x axis.
"""

import felupe as fem
import numpy as np

# the parameters of the model, or these values if the script runs alone
inner_length = globals().get("inner_length", 100)
outer_length = globals().get("outer_length", 60)
sleeve = globals().get("sleeve", 5)
runout = globals().get("runout", 0.2)
cells_axial = globals().get("cells_axial", 5)
cells_radial = globals().get("cells_radial", 7)
cells_around = globals().get("cells_around", 18)

# the inside of the inner sleeve and the outside of the outer sleeve
INNER, OUTER = 25, 65
inside, outside = INNER + sleeve, OUTER - sleeve

# the section of the soft body between two lines in the xy plane, with runouts
bottom = fem.mesh.Line(a=-inner_length / 2, b=inner_length / 2, n=cells_axial + 1)
top = fem.mesh.Line(a=-outer_length / 2, b=outer_length / 2, n=cells_axial + 1)
bottom.update(points=np.pad(bottom.points, ((0, 0), (0, 1)), constant_values=inside))
top.update(points=np.pad(top.points, ((0, 0), (0, 1)), constant_values=outside))
section = fem.mesh.fill_between(bottom, top, n=cells_radial + 1)
section = section.add_runouts(
    axis=1, centerpoint=[0, (inside + outside) / 2], values=[runout], normalize=True
)

# revolved about the x axis, with the sleeves
around = {"n": cells_around + 1, "phi": 360}
body = section.revolve(**around)
metal = fem.MeshContainer(
    [
        fem.Rectangle(
            a=(-inner_length / 2, INNER),
            b=(inner_length / 2, inside),
            n=(cells_axial + 1, 3),
        ).revolve(**around),
        fem.Rectangle(
            a=(-outer_length / 2, outside),
            b=(outer_length / 2, OUTER),
            n=(cells_axial + 1, 3),
        ).revolve(**around),
    ],
    merge=True,
).stack()
mesh = {"soft": body, "metal": metal}
'''


def bushing():
    """A bushing with steel sleeves like the example ex05 of FElupe (#185), made by a
    script with parameters (#182). The outside of the outer sleeve (r = 65) is
    fixed; the inside of the inner sleeve (r = 25), point sets on cylinders (#181),
    is connected to a control point at the axis with a rotation point: moved by
    8 mm in z, twisted by 30° about x and tilted by -5° about y. The multiplier of
    the constraint is large compared with the steel: the moment of the torsion is
    within 0.1 % of ex05, which prescribes the rotated positions."""

    def parameter(name, value, description, **options):
        return {
            "command": "parameter.add",
            "name": name,
            "value": value,
            **options,
            "description": description,
        }

    length = {"quantity": "length"}
    commands = [
        {
            "command": "model.settings",
            "name": "settings",
            "units": {"length": "mm", "force": "N"},
        },
        parameter(
            "inner_length",
            100,
            "Length of the inner sleeve",
            **length,
            min=60,
            max=140,
            step=10,
        ),
        parameter(
            "outer_length",
            60,
            "Length of the outer sleeve",
            **length,
            min=30,
            max=100,
            step=10,
        ),
        parameter(
            "sleeve", 5, "Thickness of the sleeves", **length, min=2, max=10, step=1
        ),
        parameter(
            "runout",
            0.2,
            "Runout of the free faces of the soft body",
            min=0,
            max=0.4,
            step=0.05,
        ),
        parameter(
            "cells_axial", 5, "Cells along the axis", integer=True, min=2, max=20
        ),
        parameter(
            "cells_radial",
            7,
            "Cells through the soft body",
            integer=True,
            min=2,
            max=20,
        ),
        parameter(
            "cells_around", 18, "Cells around the axis", integer=True, min=8, max=72
        ),
        {
            "command": "mesh.script",
            "name": "soft_mesh",
            "file": "bushing.py",
            "item": "soft",
        },
        {
            "command": "mesh.script",
            "name": "metal_mesh",
            "file": "bushing.py",
            "item": "metal",
        },
        {"command": "cellset.from_file", "name": "soft_cells", "mesh": "soft_mesh"},
        {"command": "cellset.from_file", "name": "metal_cells", "mesh": "metal_mesh"},
        {
            "command": "material.add",
            "name": "hyperelastic",
            "model": "NeoHooke",
            "parameters": {"mu": 1},
        },
        {
            "command": "material.add",
            "name": "steel",
            "model": "LinearElasticLargeStrain",
            "parameters": {"E": 210000, "nu": 0.3},
        },
        {
            "command": "section.add",
            "name": "soft_body",
            "cellset": "soft_cells",
            "material": "hyperelastic",
            "formulation": "u-p-J",
            "bulk": 5000,
        },
        {
            "command": "section.add",
            "name": "sleeves",
            "cellset": "metal_cells",
            "material": "steel",
            "formulation": "u",
        },
        {
            "command": "pointset.add",
            "name": "inner",
            "select": {"radius": 25, "axis": "x"},
        },
        {
            "command": "pointset.add",
            "name": "outer",
            "select": {"radius": 65, "axis": "x"},
        },
        # the center of the inner sleeve at the axis, and its rotation point beside
        {"command": "point.add", "name": "center", "coordinates": [0, 0, 0]},
        {"command": "point.add", "name": "turn", "coordinates": [0, 0, 10]},
        {
            "command": "mpc.add",
            "name": "connect",
            "points": "inner",
            "center": "center",
            "constrained": ["x", "y", "z"],
            "multiplier": 100000,
            "rotation": "turn",
        },
        {
            "command": "boundary.add",
            "name": "fixed",
            "pointset": "outer",
            "constrained": ["x", "y", "z"],
        },
        {
            "command": "boundary.add",
            "name": "radial",
            "pointset": "center",
            "constrained": ["z"],
        },
        {
            "command": "boundary.add",
            "name": "hold",
            "pointset": "center",
            "constrained": ["x", "y"],
        },
        {
            "command": "boundary.add",
            "name": "torsion",
            "pointset": "turn",
            "constrained": ["x"],
        },
        {
            "command": "boundary.add",
            "name": "cardanic",
            "pointset": "turn",
            "constrained": ["y"],
        },
        {
            "command": "boundary.add",
            "name": "lock",
            "pointset": "turn",
            "constrained": ["z"],
        },
        {
            "command": "step.add",
            "name": "loading",
            "ramp": {
                "num": 6,
                "items": [
                    {"target": "radial", "end": 8},
                    {"target": "torsion", "end": 0.5236},
                    {"target": "cardanic", "end": -0.0873},
                ],
            },
        },
        {"command": "job.add", "name": "job", "steps": ["loading"], "curve": "torsion"},
    ]
    write("bushing", commands, {"bushing.py": BUSHING})


def hyperelastic_spring():
    """A hyperelastic spring with end stops like the example ex06 of FElupe (#222):
    a half of the spring (a symmetry plane y = 0) bonded to two steel plates, the top
    one fixed, the bottom one moved by 40 mm in z and then by 40 mm in x. The plates
    are end stops: rigid planes with friction, whose contacts take the points on the
    outer surface. The bulging spring touches the upper plate.

    The reference point of the lower plane is on the plane z = 0 of the point set
    *bottom*, so the boundaries of the bottom face move the plane too, and the curve
    is the force of the whole lower plate (bonded face and end stop), like the
    boundary ``move-z`` of ex06. The upper plane is 0.1 mm above the top face (its
    reference point would be the node at the center of the top face) and fixed.

    The mesh ``spring.vtu`` is the mesh of ex06 (``ex06_rubber-metal-spring_mesh.vtk``)
    with flipped cells (their volumes were negative), ``mesh.flip()`` of FElupe."""
    folder = HERE / "hyperelastic-spring"
    mesh = meshio.read(folder / "spring.vtu")
    commands = [
        {
            "command": "model.settings",
            "name": "settings",
            "units": {"length": "mm", "force": "N"},
        },
        {"command": "mesh.import", "name": "spring", "file": "spring.vtu"},
        {"command": "cellset.from_file", "name": "all_cells", "mesh": "spring"},
        {
            "command": "material.add",
            "name": "hyperelastic",
            "model": "NeoHookeCompressible",
            "parameters": {"mu": 1, "lmbda": 5},
        },
        {
            "command": "section.add",
            "name": "soft_spring",
            "cellset": "all_cells",
            "material": "hyperelastic",
            "formulation": "u",
        },
        {"command": "symmetry.add", "name": "symmetry", "axes": ["y"]},
        {
            "command": "pointset.add",
            "name": "top",
            "select": {"axis": "z", "value": 120},
        },
        {
            "command": "pointset.add",
            "name": "bottom",
            "select": {"axis": "z", "value": 0},
        },
        {"command": "pointset.add", "name": "outer", "select": {"surface": True}},
        {
            "command": "rigid.add",
            "name": "upper_plate",
            "coordinates": [0, 0, 120.1],
            "shape": {"normal": [0, 0, -1]},
        },
        {
            "command": "rigid.add",
            "name": "lower_plate",
            "coordinates": [0, 0, 0],
            "shape": {"normal": [0, 0, 1]},
        },
        {
            "command": "boundary.add",
            "name": "fixed",
            "pointset": "top",
            "constrained": ["x", "y", "z"],
        },
        {
            "command": "boundary.add",
            "name": "stop",
            "pointset": "upper_plate",
            "constrained": ["x", "y", "z"],
        },
        {
            "command": "boundary.add",
            "name": "axial",
            "pointset": "bottom",
            "constrained": ["z"],
        },
        {
            "command": "boundary.add",
            "name": "lateral",
            "pointset": "bottom",
            "constrained": ["x"],
        },
        {
            "command": "boundary.add",
            "name": "guide",
            "pointset": "bottom",
            "constrained": ["y"],
        },
        {
            "command": "contact.add",
            "name": "upper_stop",
            "points": "outer",
            "surface": "upper_plate",
            "friction": 0.5,
        },
        {
            "command": "contact.add",
            "name": "lower_stop",
            "points": "outer",
            "surface": "lower_plate",
            "friction": 0.5,
        },
        {
            "command": "step.add",
            "name": "compression",
            "ramp": {"num": 4, "items": [{"target": "axial", "end": 40}]},
        },
        {
            "command": "step.add",
            "name": "shear",
            "ramp": {"num": 4, "items": [{"target": "lateral", "end": 40}]},
        },
        {
            "command": "job.add",
            "name": "job",
            "steps": ["compression", "shear"],
            "curve": "axial",
        },
    ]
    write("hyperelastic-spring", commands, {"spring.vtu": mesh})


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
            "name": "hyperelastic",
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
            "material": "hyperelastic",
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
            "name": "hyperelastic",
            "model": "NeoHooke",
            "parameters": {"mu": 0.5},
        },
        {
            "command": "section.add",
            "name": "specimen",
            "cellset": "all_cells",
            "material": "hyperelastic",
            "formulation": "u-p-J",
            "bulk": 5000,
        },
        {"command": "loadcase.add", "name": "tension", "type": "uniaxial", "axis": "x"},
        {
            "command": "step.add",
            "name": "stretch",
            "ramp": {"num": 10, "items": [{"target": "tension", "end": 1}]},
        },
        # a tight tolerance for the comparison with the analytical curve
        {
            "command": "job.add",
            "name": "job",
            "steps": ["stretch"],
            "curve": "tension",
            "tol": 1e-6,
        },
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
            "name": "hyperelastic",
            "model": "NeoHooke",
            "parameters": {"mu": 1},
        },
        {
            "command": "section.add",
            "name": "hex_part",
            "cellset": "hexahedrons",
            "material": "hyperelastic",
            "formulation": "u-p-J",
            "bulk": 5000,
        },
        {
            "command": "section.add",
            "name": "tet_part",
            "cellset": "tetrahedrons",
            "material": "hyperelastic",
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
    shear_mount()
    two_materials()
    material_test()
    hex_tet()
    glued_plate()
    sandwich_spring()
    sandwich_spring_axisymmetric()
    plate_with_hole()
    bushing()
    hyperelastic_spring()
    INDEX.write_text(json.dumps(SAMPLES, indent=2) + "\n", encoding="utf-8")


if __name__ == "__main__":
    main()
