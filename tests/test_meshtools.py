"""The mesh tools (ADR 0019, #193): the registry in the schema, the dimensions of the
made meshes, their lines in the script and the meshes they make."""

import json
from pathlib import Path

import felupe as fem
import meshio
import numpy as np
import pytest

from felupe_studio import checks, codegen, meshes, meshtools
from felupe_studio.commands import errors
from felupe_studio.expressions import resolve

GOLDEN = Path(__file__).parent / "golden"


def made(tool, name="mesh", **parameters):
    command = {"command": "mesh.generate", "name": name, "tool": tool}
    return {**command, "parameters": parameters}


def test_the_registry_of_the_tools():
    assert list(meshtools.tools()) == [
        *("Point", "Line", "Rectangle", "Cube", "Circle", "Triangle"),
        *("expand", "revolve", "embed", "translate", "rotate", "mirror"),
        *("fill_between", "add_runouts", "stack"),
    ]
    for name, definition in meshtools.tools().items():
        rule = definition["x-dimension"]
        if "inputs" in rule:
            # an operation: a method of its input, or a function of its inputs
            assert definition["x-group"] == "Operations"
            assert set(rule) == {"inputs", "cell_type", "points"}
        else:
            assert definition["x-label"] == name
            assert definition["x-felupe"].startswith("fem.")
            assert set(rule) == {"points", "cells", "cell_type"}


CIRCLE = made("Circle", radius=2, centerpoint=[1, 1], n=3, sections=[0, 90])
TRIANGLE = made("Triangle", a=[0, 0], b=[2, 0], c=[0.5, 1], n=4)


@pytest.mark.parametrize(
    ("command", "dimension"),
    [
        (made("Point", a=0.5), (1, 0, "vertex")),
        (made("Line", a=0, b=2, n=5), (1, 1, "line")),
        (made("Rectangle", a=[0, 0], b=[2, 1], n=[3, 2]), (2, 2, "quad")),
        (made("Cube", a=[0, 0, 0], b=[2, 1, 1], n=[3, 2, 2]), (3, 3, "hexahedron")),
        (CIRCLE, (2, 2, "quad")),
        (TRIANGLE, (2, 2, "quad")),
    ],
)
def test_the_dimensions_are_those_of_felupe(command, dimension):
    # known from the commands, and the same as of the mesh that FElupe makes
    known = meshtools.dimensions([command])["mesh"]
    assert (known["points"], known["cells"], known["cell_type"]) == dimension
    mesh = meshtools.generate([command])["mesh"]
    assert isinstance(mesh, fem.Mesh)
    assert mesh.points.shape[1] == known["points"]
    assert mesh.cell_type == known["cell_type"]


def test_the_lines_of_the_script():
    assert meshtools.call(made("Line", a=0, b=2.5, n=6)) == (
        "fem.mesh.Line",
        ["a=0", "b=2.5", "n=6"],
        "",
    )
    document = {
        "schema_version": 3,
        "commands": [
            {"command": "parameter.add", "name": "width", "value": 2.0},
            made("Rectangle", "face", a=[0, 0], b=["width", 1], n=[3, 2]),
        ],
    }
    script = codegen(document, evaluate=False)
    assert "face = fem.Rectangle(a=[0, 0], b=[width, 1], n=[3, 2])" in script
    # the meshes made with the lines of the script and the values of the parameters
    resolved = resolve(document)[0]["commands"]
    mesh = meshtools.generate(resolved, {"width": 2.0})["face"]
    np.testing.assert_allclose(mesh.points.max(axis=0), [2, 1])


def test_the_values_of_the_tools():
    assert meshtools.problems(made("Cube", a=[0, 0, 0], b=[1, 1, 1])) == []
    assert meshtools.problems(made("Cube", a=[0, 2, 0], b=[1, 1, 0])) == [
        "b must be larger than a in y and z."
    ]
    assert meshtools.problems(made("Line", a=1, b=0)) == ["b must be larger than a."]
    assert meshtools.problems(made("Point", a=1)) == []


@pytest.mark.parametrize(
    ("command", "felupe", "line"),
    [
        (
            CIRCLE,
            fem.Circle(radius=2, centerpoint=[1, 1], n=3, sections=[0, 90]),
            "mesh = fem.Circle(radius=2, centerpoint=[1, 1], n=3, sections=[0, 90])",
        ),
        (
            TRIANGLE,
            fem.mesh.Triangle(a=[0, 0], b=[2, 0], c=[0.5, 1], n=4),
            "mesh = fem.mesh.Triangle(a=[0, 0], b=[2, 0], c=[0.5, 1], n=4)",
        ),
    ],
)
def test_a_circle_and_a_triangle_are_those_of_felupe(command, felupe, line):
    # the line of the script makes the mesh of FElupe called directly (#394)
    document = {"schema_version": 3, "commands": [command]}
    assert errors(document) == []
    assert line in codegen(document, evaluate=False)
    mesh = meshtools.generate([command])["mesh"]
    assert mesh.cell_type == felupe.cell_type == "quad"
    np.testing.assert_allclose(mesh.points, felupe.points)
    np.testing.assert_array_equal(mesh.cells, felupe.cells)
    # counterclockwise quads, without points twice
    assert (fem.RegionQuad(mesh).dV > 0).all()
    assert len(np.unique(mesh.points.round(10), axis=0)) == mesh.npoints


def test_the_values_of_a_circle_and_a_triangle():
    # quarters that do not overlap; corners counterclockwise, not on a line (#394)
    def circle(*sections):
        return meshtools.problems(made("Circle", radius=1, sections=list(sections)))

    assert circle(0) == circle(0, 90, 180, 270) == circle(-90, 0, 90, 180) == []
    assert circle(0, 90, 135) == [
        "sections 90 and 135 overlap: the quarters need 90 degrees between them."
    ]
    assert circle(90, 450) == [
        "sections 90 and 450 overlap: the quarters need 90 degrees between them."
    ]

    def triangle(b, c):
        return meshtools.problems(made("Triangle", a=[0, 0], b=b, c=c, n=2))

    assert triangle([1, 0], [0, 1]) == []
    assert triangle([0, 1], [1, 0]) == ["a, b and c go around clockwise; swap b and c."]
    assert triangle([1, 1], [2, 2]) == ["a, b and c lie on a line."]
    # n = 1 would be one triangle cell in FElupe: at least 2 points, as of the others
    single = {**TRIANGLE, "parameters": {**TRIANGLE["parameters"], "n": 1}}
    assert errors({"schema_version": 3, "commands": [single]}) != []


def test_a_cube_made_by_a_tool_is_checked_like_a_file(tmp_path):
    # the cells of a mesh of the model made by a tool are assigned to its section;
    # a construction mesh is no mesh of the model
    document = json.loads((GOLDEN / "cube_made_by_tools" / "commands.json").read_text())
    document["commands"].insert(2, made("Line", "bottom", a=0, b=1, n=3))
    assert errors(document) == []
    report = checks.check(document, tmp_path)
    assert report["ok"]
    assert report["cells"]["total"] == 8
    assert report["cells"]["unassigned"] == []


def test_a_cylinder_of_a_circle_is_checked_like_a_file(tmp_path):
    # a quarter of a circle expanded along z: a mesh of a 3D model (#394)
    document = json.loads((GOLDEN / "cube_made_by_tools" / "commands.json").read_text())
    quarter = made("Circle", "quarter", radius=1, centerpoint=[0, 0], n=3, sections=[0])
    cylinder = {**made("expand", "cube", n=4, z=2), "inputs": ["quarter"]}
    document["commands"][1:2] = [quarter, cylinder]
    assert errors(document) == []
    report = checks.check(document, tmp_path)
    assert report["ok"]
    assert report["cells"]["total"] == 3 * 4 * 3
    assert report["cells"]["unassigned"] == []


@pytest.mark.parametrize(
    ("tool", "parameters", "surface", "triangles"),
    [
        ("Point", {"a": 1}, "vertex", 0),
        ("Line", {"a": 0, "b": 2, "n": 5}, "line", 0),
        ("Rectangle", {"a": [0, 0], "b": [2, 1], "n": [3, 2]}, "quad", 4),
        ("Cube", {"a": [0, 0, 0], "b": [2, 1, 1], "n": [3, 2, 2]}, "hexahedron", 20),
    ],
)
def test_the_meshes_of_the_worker(tool, parameters, surface, triangles):
    # summarized for the app with their dimension: meshes of 2D and 3D cells like a
    # mesh file, lines and vertices with their lines for the viewer (ADR 0019)
    info, surfaces = meshes.generate([made(tool, **parameters)], "mesh")
    info = json.loads(info)
    assert info["dimension"]["cell_type"] == surface
    assert list(surfaces) == [surface]
    assert len(surfaces[surface]["triangles"]) // 12 == triangles
    lines = len(surfaces[surface]["edges"]) // 8
    if tool == "Line":
        assert lines == 4
    if tool == "Point":
        assert lines == 0 and info["points"] == 1


def test_an_error_of_felupe_is_the_state_of_the_mesh():
    # e.g. a number of points that is not an integer, which the validation reports
    cube = made("Cube", a=[0, 0, 0], b=[1, 1, 1], n=[2.5, 2, 2])
    info, surfaces = meshes.generate([cube], "mesh")
    assert "Error" in json.loads(info)["error"] and surfaces == {}


def test_a_made_mesh_is_exported_like_a_file(tmp_path):
    # the solid cells of a made mesh as a file (ADR 0019, #230); a line has none
    cube = made("Cube", "block", a=[0, 0, 0], b=[2, 1, 1], n=[3, 2, 2])
    data = meshes.export_generated([cube], "block", "vtu")
    (tmp_path / "block.vtu").write_bytes(data)
    mesh = meshio.read(tmp_path / "block.vtu")
    assert mesh.cells[0].type == "hexahedron" and len(mesh.cells[0].data) == 2
    line = made("Line", "edge", a=0, b=1, n=3)
    with pytest.raises(ValueError, match="'edge' has no solid cells"):
        meshes.export_generated([line], "edge", "vtu")


LINE = made("Line", "line", a=0, b=2, n=3)
RECTANGLE = made("Rectangle", "face", a=[0, 0], b=[2, 1], n=[3, 2])
CUBE = made("Cube", "block", a=[0, 0, 0], b=[2, 1, 1], n=[3, 2, 2])


LINES = [
    made("Line", "bottom", a=0, b=2, n=3),
    {**made("embed", "bottom_2d", value=0), "inputs": ["bottom"]},
    made("Line", "top", a=0, b=2, n=3),
    {**made("embed", "top_2d", value=1), "inputs": ["top"]},
]


def cube_face(name, z):
    """A rectangle embedded in 3D at the coordinate z, its name the embedded one."""
    flat = made("Rectangle", f"{name}_flat", a=[0, 0], b=[2, 1], n=[3, 2])
    return [flat, {**made("embed", name, value=z), "inputs": [f"{name}_flat"]}]


def operation(tool, inputs, **parameters):
    return {**made(tool, "made", **parameters), "inputs": inputs}


@pytest.mark.parametrize(
    "chain",
    [
        [made("Point", "point", a=1), operation("expand", ["point"], n=3, z=2)],
        [LINE, operation("expand", ["line"], n=3, z=2)],
        [RECTANGLE, operation("expand", ["face"], n=3, z=2)],
        [
            made("Point", "point", a=1),
            operation("revolve", ["point"], n=3, phi=90, axis="x"),
        ],
        [LINE, operation("revolve", ["line"], n=3, phi=90, axis="x")],
        [RECTANGLE, operation("revolve", ["face"], n=4, phi=90, axis="x")],
        [LINE, operation("embed", ["line"], value=3)],
        [RECTANGLE, operation("embed", ["face"], value=3)],
        [CUBE, operation("translate", ["block"], move=2, axis="z")],
        [
            RECTANGLE,
            operation("rotate", ["face"], angle_deg=30, axis="z", center=[1, 0]),
        ],
        [CUBE, operation("rotate", ["block"], angle_deg=30, axis="x")],
        [CUBE, operation("mirror", ["block"], axis="y", value=0.5)],
        [RECTANGLE, operation("mirror", ["face"], axis="x", value=0)],
        [*LINES, operation("fill_between", ["bottom_2d", "top_2d"], n=4)],
        [
            *cube_face("low", 0),
            *cube_face("high", 1),
            operation("fill_between", ["low", "high"], n=3),
        ],
        [
            RECTANGLE,
            operation(
                "add_runouts",
                ["face"],
                values=[0.2],
                axis="y",
                centerpoint=[1, 0.5],
                normalize=True,
            ),
        ],
        [
            CUBE,
            operation("add_runouts", ["block"], values=[0.1, 0.2], axis="x"),
        ],
        [
            LINE,
            made("Line", "next", a=2, b=3, n=2),
            operation("stack", ["line", "next"], decimals=10),
        ],
        [
            RECTANGLE,
            made("Rectangle", "beside", a=[2, 0], b=[3, 1], n=[2, 2]),
            operation("stack", ["face", "beside"], decimals=6),
        ],
        [
            CUBE,
            made("Cube", "above", a=[0, 0, 1], b=[2, 1, 2], n=[3, 2, 2]),
            operation("stack", ["block", "above"], decimals=10),
        ],
    ],
)
def test_the_dimensions_of_the_operations_are_those_of_felupe(chain):
    # known from the commands, and the same as of the mesh that FElupe makes
    assert errors({"schema_version": 3, "commands": chain}) == []
    known = meshtools.dimensions(chain)["made"]
    mesh = meshtools.generate(chain)["made"]
    assert mesh.points.shape[1] == known["points"]
    assert mesh.cell_type == known["cell_type"]


def test_the_lines_of_the_operations():
    chain = [
        LINE,
        operation("embed", ["line"], value=30.0),
        {**operation("expand", ["made"], n=3, z=10), "name": "face"},
        {**operation("mirror", ["face"], axis="y", value=0.5), "name": "flipped"},
    ]
    script = codegen({"schema_version": 3, "commands": chain}, evaluate=False)
    assert "made = embed(line, value=30.0)" in script
    assert "face = made.expand(n=3, z=10)" in script
    assert "flipped = face.mirror(normal=[0, 1, 0], centerpoint=[0, 0.5, 0])" in script
    assert "def embed(mesh, value=0.0):" in script
    filled = [
        *LINES,
        {**operation("fill_between", ["bottom_2d", "top_2d"], n=4), "name": "face"},
        {
            **operation(
                "add_runouts", ["face"], values=[0.2], axis="y", normalize=True
            ),
            "name": "runouts",
        },
    ]
    script = codegen({"schema_version": 3, "commands": filled}, evaluate=False)
    assert "face = fem.mesh.fill_between(bottom_2d, top_2d, n=4)" in script
    assert "runouts = face.add_runouts(values=[0.2], axis=1, normalize=True)" in script
    # the helper only in scripts with embedded meshes
    assert "def embed" not in codegen({"schema_version": 3, "commands": [LINE]})


def pieces(x=(0, 1, 2)):
    """A profile of three rectangles side by side, off the x-axis (#394)."""
    names = ("left", "middle", "right")
    return [
        made("Rectangle", name, a=[x0, 1], b=[x0 + 1, 2], n=[3, 3])
        for name, x0 in zip(names, x, strict=True)
    ]


PROFILE = {
    **made("stack", "profile", decimals=10),
    "inputs": ["left", "middle", "right"],
}


def test_a_stack_is_that_of_felupe():
    # the line of the script makes the mesh of FElupe called directly (#394)
    document = {"schema_version": 3, "commands": [*pieces(), PROFILE]}
    assert errors(document) == []
    line = (
        "profile = fem.MeshContainer([left, middle, right], merge=True, decimals=10)"
        ".stack()"
    )
    assert line in codegen(document, evaluate=False)
    mesh = meshtools.generate(document["commands"])["profile"]
    rectangles = [fem.Rectangle(a=(x, 1), b=(x + 1, 2), n=3) for x in (0, 1, 2)]
    felupe = fem.MeshContainer(rectangles, merge=True, decimals=10).stack()
    assert mesh.cell_type == felupe.cell_type == "quad"
    np.testing.assert_allclose(mesh.points, felupe.points)
    np.testing.assert_array_equal(mesh.cells, felupe.cells)
    # the points of the common edges once: 7 x 3 points, the cells of all pieces
    assert mesh.npoints == 21 and len(mesh.cells) == 3 * 4
    assert (fem.RegionQuad(mesh).dV > 0).all()


def test_the_inputs_of_a_stack():
    # two or more meshes, each once, of the same cells and points (#394)
    def stack(*inputs, before=()):
        commands = [*pieces(), *before, {**PROFILE, "inputs": list(inputs)}]
        return errors({"schema_version": 3, "commands": commands})

    assert stack("left", "right") == []
    assert stack("left") != []
    assert stack("left", "left") != []
    assert stack("left", "block", before=[CUBE]) == [
        "commands/4: mesh 'profile': stack needs meshes of the same cells and points: "
        "'left' quad cells with 2D points, 'block' hexahedron cells with 3D points."
    ]


def by_coordinates(mesh):
    """The points and the cells of a mesh by their coordinates, without their order:
    each cell as its sorted points."""
    points = mesh.points.round(8)
    cells = sorted(tuple(sorted(map(tuple, points[cell]))) for cell in mesh.cells)
    return sorted(set(map(tuple, points))), cells


def test_a_profile_stacked_and_revolved_is_revolved_piece_by_piece():
    # one revolve of the stacked profile, the same as each piece revolved (#394)
    revolve = {"n": 5, "phi": 90, "axis": "x"}
    body = {**made("revolve", "body", **revolve), "inputs": ["profile"]}
    stacked = meshtools.generate([*pieces(), PROFILE, body])["body"]
    revolved = [
        {**made("revolve", f"{c['name']}_body", **revolve), "inputs": [c["name"]]}
        for c in pieces()
    ]
    made_pieces = meshtools.generate([*pieces(), *revolved])
    one_by_one = fem.mesh.concatenate([made_pieces[c["name"]] for c in revolved])
    assert stacked.cell_type == "hexahedron"
    assert len(stacked.cells) == len(one_by_one.cells) == 3 * 4 * 4
    # the points of the common faces once
    assert stacked.npoints == 7 * 3 * 5 < one_by_one.npoints
    assert by_coordinates(stacked) == by_coordinates(one_by_one)
    assert (fem.RegionHexahedron(stacked).dV > 0).all()


def test_a_body_of_a_stacked_profile_is_checked_like_a_file(tmp_path):
    # the revolved profile is one mesh of the model, its cells in one section (#394)
    document = json.loads((GOLDEN / "cube_made_by_tools" / "commands.json").read_text())
    body = {**made("revolve", "cube", n=5, phi=90, axis="x"), "inputs": ["profile"]}
    document["commands"][1:2] = [*pieces(), PROFILE, body]
    assert errors(document) == []
    report = checks.check(document, tmp_path)
    assert report["ok"]
    assert report["cells"]["total"] == 3 * 4 * 4
    assert report["cells"]["unassigned"] == []


HALF = {"command": "mesh.import", "name": "half", "file": "half.vtu"}
MIRRORED = {
    **made("mirror", "other", axis="x", value=1.5),
    "inputs": ["half"],
}
WHOLE = {**made("stack", "whole", decimals=10), "inputs": ["half", "other"]}


def test_the_dimensions_of_the_meshes_of_files_and_scripts():
    # those of the model, the cell type unknown before the read unless given (#438)
    script = {"command": "mesh.script", "name": "part", "file": "part.py"}
    known = meshtools.dimensions([HALF, script, MIRRORED, WHOLE])
    assert known["half"] == {"points": 3, "cells": 3, "cell_type": None}
    assert known["part"] == known["other"] == known["whole"] == known["half"]
    settings = {"command": "model.settings", "analysis": "plane-strain"}
    assert meshtools.dimensions([settings, HALF])["half"]["points"] == 2
    tetra = {**HALF, "cell_type": "tetra10"}
    assert meshtools.dimensions([tetra, MIRRORED])["other"]["cell_type"] == "tetra10"
    # the read is known, e.g. in the worker
    read = {"half": {"points": 3, "cells": 3, "cell_type": "hexahedron"}}
    assert meshtools.dimensions([HALF, MIRRORED], read)["other"] == read["half"]
    # a rule of the dimension of the cells is one of the commands
    expand = {**made("expand", "body", n=2, z=1), "inputs": ["half"]}
    assert meshtools.input_problems(expand, known) == [
        "expand needs a mesh of vertex, line or quad cells; 'half' has 3D cells."
    ]
    # an unknown cell type of 2D cells is taken as the one that the tool takes
    revolve = {**made("revolve", "body", n=3, phi=90, axis="x"), "inputs": ["half"]}
    flat = meshtools.dimensions([settings, HALF, revolve])
    assert flat["body"] == {"points": 3, "cells": 3, "cell_type": "hexahedron"}


def write_half(folder):
    """The left half of a bar of 6 x 4 x 4 hexahedrons, with a tag of its cells."""
    half = fem.Cube(b=(1.5, 1, 1), n=(7, 5, 5))
    tag = np.arange(half.ncells) % 2
    meshio.Mesh(
        half.points, [("hexahedron", half.cells)], cell_data={"material": [tag]}
    ).write(folder / "half.vtu")
    return half


def test_a_half_of_a_file_is_mirrored_and_stacked_in_the_worker(tmp_path, monkeypatch):
    # the worker takes the kept read of the file, with its scale (#438)
    monkeypatch.chdir(tmp_path)
    write_half(tmp_path)
    meshes.forget()
    meshes.load("half.vtu")
    monkeypatch.setattr(meshio, "read", lambda *args: pytest.fail("read again"))
    source = {"name": "half", "file": "half.vtu", "dim": 3}
    info, surfaces = meshes.generate([MIRRORED, WHOLE], "whole", sources=[source])
    info = json.loads(info)
    assert info["dimension"] == {"points": 3, "cells": 3, "cell_type": "hexahedron"}
    assert info["solids"][0]["cells"] == 2 * 6 * 4 * 4
    # the bar of the golden cases, the points at x = 1.5 once
    assert info["solids"][0]["bounds"] == [[0, 0, 0], [3, 1, 1]]
    assert info["points"] == 13 * 5 * 5
    assert list(surfaces) == ["hexahedron"]
    # another scale is another mesh, of the kept read
    scaled = {**source, "scale": 2}
    info = json.loads(meshes.generate([MIRRORED], "other", sources=[scaled])[0])
    assert info["solids"][0]["bounds"] == [[0, 0, 0], [3, 2, 2]]


def test_a_mesh_of_a_file_is_read_by_the_worker_without_a_kept_read(
    tmp_path, monkeypatch
):
    # e.g. after another file was written (#438); an error is the state of the mesh
    monkeypatch.chdir(tmp_path)
    write_half(tmp_path)
    meshes.forget()
    source = {"name": "half", "file": "half.vtu", "tag": "material", "dim": 3}
    info = json.loads(meshes.generate([MIRRORED], "other", sources=[source])[0])
    assert info["solids"][0]["bounds"] == [[1.5, 0, 0], [3, 1, 1]]
    missing = {**source, "file": "missing.vtu"}
    meshes.forget()
    info = json.loads(meshes.generate([MIRRORED], "other", sources=[missing])[0])
    assert "missing.vtu" in info["error"]


SCRIPT = """import felupe as fem

mesh = {"bar": fem.Cube(b=(length, 1, 1), n=(4, 2, 2))}
"""


def test_a_mesh_of_a_script_is_moved_in_the_worker(tmp_path, monkeypatch):
    # the worker takes the kept run of the script with its parameters (#438)
    monkeypatch.chdir(tmp_path)
    (tmp_path / "bar.py").write_text(SCRIPT, encoding="utf-8")
    meshes.forget()
    meshes.make("bar.py", {"length": 3}, "bar")
    monkeypatch.setattr(meshes, "script_mesh", lambda *args: pytest.fail("run again"))
    moved = {**made("translate", "moved", move=1, axis="y"), "inputs": ["bar"]}
    source = {
        "name": "bar",
        "file": "bar.py",
        "parameters": {"length": 3},
        "item": "bar",
        "dim": 3,
    }
    info = json.loads(meshes.generate([moved], "moved", sources=[source])[0])
    assert info["solids"][0]["bounds"] == [[0, 1, 0], [3, 2, 1]]
    # exported like a made mesh
    data = meshes.export_generated([moved], "moved", "vtu", [source])
    (tmp_path / "moved.vtu").write_bytes(data)
    assert meshio.read(tmp_path / "moved.vtu").points[:, 1].min() == 1


def test_a_mirrored_half_of_a_file_is_checked_like_a_file(tmp_path):
    # the whole is a mesh of the model, its cells in one section (#438)
    write_half(tmp_path)
    document = json.loads((GOLDEN / "cube_made_by_tools" / "commands.json").read_text())
    document["commands"][1:2] = [HALF, MIRRORED, {**WHOLE, "name": "cube"}]
    assert errors(document) == []
    report = checks.check(document, tmp_path)
    assert report["ok"]
    assert report["cells"]["total"] == 2 * 6 * 4 * 4
    assert report["cells"]["unassigned"] == []
