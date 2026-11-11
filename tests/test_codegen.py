import copy
import json
import runpy
import shutil
import subprocess
from pathlib import Path

import felupe as fem
import meshio
import numpy as np
import pytest

from felupe_studio.codegen import codegen, object_lines
from felupe_studio.commands import ValidationError

DATA = Path(__file__).parent / "data"


@pytest.fixture
def two_sections():
    return json.loads((DATA / "two_sections.json").read_text(encoding="utf-8"))


def bar(n=(13, 5, 5)):
    """Bar 3 x 1 x 1 with hexahedrons, tag 1 for x < 1.5 and tag 2 otherwise."""
    mesh = fem.Cube(b=(3, 1, 1), n=n)
    tag = np.where(mesh.points[mesh.cells].mean(axis=1)[:, 0] < 1.5, 1, 2)
    return mesh, tag


def write(filename, mesh, tag=None, cell_type=None):
    cell_data = {} if tag is None else {"material": [tag]}
    meshio.Mesh(
        mesh.points, [(cell_type or mesh.cell_type, mesh.cells)], cell_data=cell_data
    ).write(filename)


def run(document, directory, monkeypatch):
    """Generate the script, write it to the directory and run it there."""
    script = Path(directory) / "script.py"
    script.write_text(codegen(document), encoding="utf-8")
    monkeypatch.chdir(directory)
    return runpy.run_path(str(script))


def force(namespace, job="job_1"):
    return np.array(namespace[job].y)[:, 0]


def uniaxial(name="job_1"):
    """Commands for a uniaxial test of a bar: left end fixed, right end moved in x."""
    return [
        {
            "command": "pointset.add",
            "name": "left",
            "select": {"axis": "x", "value": 0},
        },
        {
            "command": "pointset.add",
            "name": "right",
            "select": {"axis": "x", "value": 3},
        },
        {
            "command": "boundary.add",
            "name": "fixed",
            "pointset": "left",
            "constrained": ["x", "y", "z"],
        },
        {
            "command": "boundary.add",
            "name": "move",
            "pointset": "right",
            "constrained": ["x"],
        },
        {
            "command": "step.add",
            "name": "step_1",
            "ramp": {"num": 5, "items": [{"target": "move", "end": 0.5}]},
        },
        {"command": "job.add", "name": name, "steps": ["step_1"], "curve": "move"},
    ]


def material(name="umat"):
    return {
        "command": "material.add",
        "name": name,
        "model": "NeoHookeCompressible",
        "parameters": {"mu": 1.0, "lmbda": 2.0},
    }


def section(name, cellset, umat="umat"):
    return {
        "command": "section.add",
        "name": name,
        "cellset": cellset,
        "material": umat,
        "formulation": "u",
    }


def test_script_passes_ruff(two_sections, tmp_path):
    script = tmp_path / "script.py"
    script.write_text(codegen(two_sections), encoding="utf-8")
    ruff = shutil.which("ruff")
    if ruff is None:
        pytest.skip("ruff is not installed")
    check = [ruff, "check", "--isolated", "--select", "E,F,W,I", str(script)]
    assert subprocess.run(check, capture_output=True).returncode == 0
    fmt = [ruff, "format", "--isolated", "--check", str(script)]
    assert subprocess.run(fmt, capture_output=True).returncode == 0


def test_two_sections_matches_reference(two_sections, tmp_path, monkeypatch):
    # reference: the hand-written FElupe script checked with FElupe 12.0.0
    mesh, tag = bar()
    write(tmp_path / "specimen.vtu", mesh, tag)
    namespace = run(two_sections, tmp_path, monkeypatch)
    assert np.isclose(force(namespace)[-1], 0.66322, rtol=1e-5)
    assert len(namespace["field"].fields) == 3  # u, and p, J of the soft section


def single_body(tmp_path, monkeypatch):
    mesh, _ = bar()
    write(tmp_path / "bar.vtu", mesh)
    document = {
        "schema_version": 3,
        "commands": [
            {"command": "mesh.import", "name": "specimen", "file": "bar.vtu"},
            {"command": "cellset.from_file", "name": "all_cells", "mesh": "specimen"},
            material(),
            section("body", "all_cells"),
            *uniaxial(),
        ],
    }
    return force(run(document, tmp_path, monkeypatch))


def test_single_body_matches_felupe(tmp_path, monkeypatch):
    mesh, _ = bar()
    field = fem.FieldContainer([fem.Field(fem.RegionHexahedron(mesh), dim=3)])
    x = mesh.points[:, 0]
    boundaries = {
        "fixed": fem.Boundary(field[0], mask=np.isclose(x, 0)),
        "move": fem.Boundary(field[0], mask=np.isclose(x, 3), skip=(0, 1, 1)),
    }
    solid = fem.SolidBody(fem.NeoHookeCompressible(mu=1.0, lmbda=2.0), field)
    move = fem.math.linsteps([0, 0.5], num=5)
    step = fem.Step([solid], ramp={boundaries["move"]: move}, boundaries=boundaries)
    job = fem.CharacteristicCurve(steps=[step], boundary=boundaries["move"])
    job.evaluate(verbose=0)

    assert np.allclose(single_body(tmp_path, monkeypatch), np.array(job.y)[:, 0])


def test_sections_from_tags_and_files_match_single_body(tmp_path, monkeypatch):
    reference = single_body(tmp_path, monkeypatch)

    # one file with tags, two sections with the same material
    mesh, tag = bar()
    write(tmp_path / "tagged.vtu", mesh, tag)
    tagged = {
        "schema_version": 3,
        "commands": [
            {
                "command": "mesh.import",
                "name": "m",
                "file": "tagged.vtu",
                "tag": "material",
            },
            {"command": "cellset.from_tag", "name": "a", "mesh": "m", "value": 1},
            {"command": "cellset.from_tag", "name": "b", "mesh": "m", "value": 2},
            material(),
            section("sa", "a"),
            section("sb", "b"),
            *uniaxial(),
        ],
    }
    assert np.allclose(force(run(tagged, tmp_path, monkeypatch)), reference)

    # two files with separate points arrays
    write(tmp_path / "left.vtu", fem.Cube(b=(1.5, 1, 1), n=(7, 5, 5)))
    write(tmp_path / "right.vtu", fem.Cube(a=(1.5, 0, 0), b=(3, 1, 1), n=(7, 5, 5)))
    files = {
        "schema_version": 3,
        "commands": [
            {"command": "mesh.import", "name": "ml", "file": "left.vtu"},
            {"command": "mesh.import", "name": "mr", "file": "right.vtu"},
            {"command": "cellset.from_file", "name": "a", "mesh": "ml"},
            {"command": "cellset.from_file", "name": "b", "mesh": "mr"},
            material(),
            section("sa", "a"),
            section("sb", "b"),
            *uniaxial(),
        ],
    }
    namespace = run(files, tmp_path, monkeypatch)
    assert len(namespace["points"]) == mesh.npoints  # duplicate points merged
    assert np.allclose(force(namespace), reference)


def test_lower_dimensional_and_split_cell_blocks(tmp_path, monkeypatch):
    # tetrahedrons, split into two blocks like Gmsh entities, plus a triangle block
    mesh, _ = bar(n=(7, 3, 3))
    tetra = mesh.triangulate()
    centers = tetra.points[tetra.cells].mean(axis=1)[:, 0]
    a, b = tetra.cells[centers < 1.5], tetra.cells[centers >= 1.5]
    faces = np.array([[0, 1, 2]])
    meshio.Mesh(
        tetra.points,
        [("tetra", a), ("triangle", faces), ("tetra", b)],
        cell_data={"material": [np.ones(len(a)), [9], 2 * np.ones(len(b))]},
    ).write(tmp_path / "tetra.vtu")

    document = {
        "schema_version": 3,
        "commands": [
            {
                "command": "mesh.import",
                "name": "m",
                "file": "tetra.vtu",
                "tag": "material",
            },
            {"command": "cellset.from_tag", "name": "a", "mesh": "m", "value": 1},
            {"command": "cellset.from_tag", "name": "b", "mesh": "m", "value": 2},
            material(),
            section("sa", "a"),
            section("sb", "b"),
            *uniaxial(),
        ],
    }
    namespace = run(document, tmp_path, monkeypatch)
    assert namespace["m"].cell_type == "tetra"
    assert len(namespace["a"].cells) == len(a)
    assert len(namespace["b"].cells) == len(b)
    assert force(namespace)[-1] > 0


def test_point_ids_and_job_without_curve(two_sections, tmp_path, monkeypatch):
    mesh, tag = bar()
    write(tmp_path / "specimen.vtu", mesh, tag)
    reference = run(two_sections, tmp_path, monkeypatch)
    ids = np.flatnonzero(reference["left"]).tolist()

    document = copy.deepcopy(two_sections)
    for cmd in document["commands"]:
        if cmd["name"] == "left":
            cmd["select"] = {"ids": ids}
        if cmd["name"] == "job_1":
            cmd.pop("curve")
    namespace = run(document, tmp_path, monkeypatch)

    assert np.array_equal(namespace["left"], reference["left"])
    assert isinstance(namespace["job_1"], fem.Job)
    assert not isinstance(namespace["job_1"], fem.CharacteristicCurve)


def test_cutback(two_sections, tmp_path, monkeypatch):
    mesh, tag = bar()
    write(tmp_path / "specimen.vtu", mesh, tag)
    assert "CutbackPlugin" not in codegen(two_sections)
    job = next(c for c in two_sections["commands"] if c["command"] == "job.add")
    job["cutback"] = {}
    assert "plugins=[fem.CutbackPlugin()]" in codegen(two_sections)
    # the settings of the cutback and of the Newton-Raphson method (#133)
    job["cutback"] = {"factor": 0.25, "max_cutbacks": 4, "growth": 1.5}
    job["maxiter"] = 30
    script = codegen(two_sections)
    assert (
        "plugins=[fem.CutbackPlugin(factor=0.25, max_cutbacks=4, growth=1.5)]" in script
    )
    assert "job_1.evaluate(x0=field, maxiter=30)\n" in script
    namespace = run(two_sections, tmp_path, monkeypatch)
    [cutback] = [
        p
        for p in namespace["job_1"].dispatcher.plugins
        if isinstance(p, fem.CutbackPlugin)
    ]
    assert (cutback.factor, cutback.max_cutbacks, cutback.growth) == (0.25, 4, 1.5)


def test_merge_decimals(two_sections):
    assert "fem.field.merge([field_section_hard, field_section_soft])" in codegen(
        two_sections
    )
    two_sections["commands"].insert(
        1, {"command": "mesh.merge", "name": "merge", "decimals": 6}
    )
    script = codegen(two_sections)
    assert "[field_section_hard, field_section_soft], decimals=6" in script


@pytest.mark.parametrize(
    "length, force, stress",
    [("mm", "N", "MPa"), ("mm", "kN", "GPa"), ("m", "N", "Pa"), ("m", "kN", "kPa")],
)
def test_units_comment(two_sections, length, force, stress):
    # the units of the model settings are a comment, nothing is converted (#132)
    script = codegen(two_sections)
    two_sections["commands"].insert(
        0,
        {
            "command": "model.settings",
            "name": "settings",
            "units": {"length": length, "force": force},
        },
    )
    with_units = codegen(two_sections)
    comment = (
        f"# units: {length} (lengths), {force} (forces) and {stress} (stresses); "
        "FElupe does not convert them\n"
    )
    assert with_units.replace("\n" + comment, "") == script
    # settings without units add nothing
    del two_sections["commands"][0]["units"]
    assert codegen(two_sections) == script


def test_evaluate_false(two_sections):
    script = codegen(two_sections, evaluate=False)
    assert ".evaluate(" not in script
    assert "job_1 = fem.CharacteristicCurve(" in script


def rename(document, length):
    """Extend every name of the command list to the given length."""
    names = {c["name"]: c["name"].ljust(length, "x") for c in document["commands"]}
    refs = ("mesh", "cellset", "material", "pointset", "target", "curve")

    def replace(obj):
        if isinstance(obj, dict):
            return {
                k: names.get(v, v) if k in ("name", *refs) else replace(v)
                for k, v in obj.items()
            }
        if isinstance(obj, list):
            return [names.get(v, v) if isinstance(v, str) else replace(v) for v in obj]
        return obj

    return replace(document)


def test_longest_names_are_wrapped(two_sections, tmp_path, monkeypatch):
    document = rename(two_sections, 24)
    script = codegen(document)
    assert max(len(line) for line in script.splitlines()) <= 88

    # a ramp of more boundaries is exploded like ruff format would do it
    ramped = copy.deepcopy(document)
    step = next(c for c in ramped["commands"] if c["command"] == "step.add")
    items = step["ramp"]["items"]
    fixed = next(
        c["name"]
        for c in ramped["commands"]
        if c["command"] == "boundary.add" and c["name"] != items[0]["target"]
    )
    items.append({**items[0], "target": fixed})
    long = codegen(ramped)
    assert "    ramp={\n" in long
    assert max(len(line) for line in long.splitlines()) <= 88

    # and with their own values
    items[1]["end"] = 0.25
    own = codegen(ramped)
    assert max(len(line) for line in own.splitlines()) <= 88

    ruff = shutil.which("ruff")
    if ruff:
        for text in (script, long, own):
            path = tmp_path / "script.py"
            path.write_text(text, encoding="utf-8")
            fmt = [ruff, "format", "--isolated", "--check", str(path)]
            assert subprocess.run(fmt, capture_output=True).returncode == 0

    mesh, tag = bar()
    write(tmp_path / "specimen.vtu", mesh, tag)
    namespace = run(document, tmp_path, monkeypatch)
    assert np.isclose(
        force(namespace, job="job_1".ljust(24, "x"))[-1], 0.66322, rtol=1e-5
    )


def test_invalid_documents(two_sections):
    with pytest.raises(ValidationError):
        codegen({"schema_version": 3, "commands": [{"command": "mesh.import"}]})

    without_sections = {
        "schema_version": 3,
        "commands": [
            {
                "command": "pointset.add",
                "name": "p",
                "select": {"axis": "x", "value": 0},
            }
        ],
    }
    with pytest.raises(ValidationError, match="at least one section"):
        codegen(without_sections)


def test_mooney_rivlin_like_neo_hooke(tmp_path, monkeypatch):
    # with C01 = 0, Mooney-Rivlin (tensortrax) is Neo-Hooke with mu = 2 C10
    mesh, _ = bar(n=(4, 2, 2))
    write(tmp_path / "bar.vtu", mesh)
    curves = {}
    for model, parameters in [
        ("NeoHooke", {"mu": 1.0}),
        ("MooneyRivlin", {"C10": 0.5, "C01": 0.0}),
    ]:
        document = {
            "schema_version": 3,
            "commands": [
                {"command": "mesh.import", "name": "m", "file": "bar.vtu"},
                {"command": "cellset.from_file", "name": "all", "mesh": "m"},
                {
                    "command": "material.add",
                    "name": "umat",
                    "model": model,
                    "parameters": {**parameters, "bulk": 50.0},
                },
                section("body_u", "all"),
                *uniaxial(),
            ],
        }
        curves[model, "u"] = force(run(document, tmp_path, monkeypatch))
        # incompressible without bulk, in the u-p-J formulation
        material = document["commands"][2]
        material["parameters"].pop("bulk")
        document["commands"][3].update(formulation="u-p-J", bulk=5000.0)
        curves[model, "upJ"] = force(run(document, tmp_path, monkeypatch))
    for kind in ("u", "upJ"):
        np.testing.assert_allclose(
            curves["MooneyRivlin", kind], curves["NeoHooke", kind], rtol=1e-10
        )
        assert curves["NeoHooke", kind][-1] > 0


def solid_meshes():
    """The bar 3 x 1 x 1 with every supported type of solid cells."""
    hexahedron = fem.Cube(b=(3, 1, 1), n=(4, 2, 2))
    tetra = hexahedron.triangulate()
    return {
        "hexahedron": hexahedron,
        "hexahedron20": fem.mesh.convert(hexahedron, order=2),
        "hexahedron27": fem.mesh.convert(
            hexahedron, order=2, calc_midfaces=True, calc_midvolumes=True
        ),
        "tetra": tetra,
        "tetra10": fem.mesh.add_midpoints_edges(tetra, cell_type_new="tetra10"),
    }


@pytest.mark.parametrize("cell_type", list(solid_meshes()))
@pytest.mark.parametrize("formulation", ["u", "u-p-J"])
def test_every_cell_type_and_formulation(cell_type, formulation, tmp_path, monkeypatch):
    mesh = solid_meshes()[cell_type]
    assert mesh.cell_type == cell_type
    write(tmp_path / "bar.vtu", mesh)
    umat = {"command": "material.add", "name": "umat", "model": "NeoHooke"}
    body = section("body", "all")
    if formulation == "u":
        umat["parameters"] = {"mu": 1.0, "bulk": 5.0}
    else:
        umat["parameters"] = {"mu": 1.0}
        body.update(formulation="u-p-J", bulk=5.0)
    document = {
        "schema_version": 3,
        "commands": [
            {"command": "mesh.import", "name": "m", "file": "bar.vtu"},
            {"command": "cellset.from_file", "name": "all", "mesh": "m"},
            umat,
            body,
            *uniaxial(),
        ],
    }
    namespace = run(document, tmp_path, monkeypatch)
    curve = force(namespace)
    # the forces of all elements and formulations agree within about 10 %
    assert 0.38 < curve[-1] < 0.47, curve
    if (cell_type, formulation) == ("tetra", "u-p-J"):
        # MINI element: a bubble point in every cell
        assert namespace["region_body"].mesh.cell_type == "tetra5"


@pytest.mark.parametrize("cell_type", ["hexahedron", "tetra", "tetra10"])
@pytest.mark.parametrize("formulations", [("u", "u-p-J"), ("u-p-J", "u-p-J")])
def test_mixed_sections_of_one_mesh(cell_type, formulations, tmp_path, monkeypatch):
    """Two sections of one mesh file with u-p-J: the dual fields of tetrahedra are
    fields of the points, so a section must not hold the points of the other one."""
    hexahedra = fem.Cube(b=(3, 1, 1), n=(7, 3, 3))
    meshes = {
        "hexahedron": hexahedra,
        "tetra": hexahedra.triangulate(),
        "tetra10": fem.mesh.add_midpoints_edges(
            hexahedra.triangulate(), cell_type_new="tetra10"
        ),
    }
    mesh = meshes[cell_type]
    tag = np.where(mesh.points[mesh.cells].mean(axis=1)[:, 0] < 1.5, 1, 2)
    meshio.Mesh(
        mesh.points, [(cell_type, mesh.cells)], cell_data={"material": [tag]}
    ).write(tmp_path / "bar.vtu")
    commands = [
        {"command": "mesh.import", "name": "bar", "file": "bar.vtu", "tag": "material"},
        {"command": "cellset.from_tag", "name": "a", "mesh": "bar", "value": 1},
        {"command": "cellset.from_tag", "name": "b", "mesh": "bar", "value": 2},
        {
            "command": "material.add",
            "name": "compressible",
            "model": "NeoHookeCompressible",
            "parameters": {"mu": 1, "lmbda": 20},
        },
        {
            "command": "material.add",
            "name": "rubber",
            "model": "NeoHooke",
            "parameters": {"mu": 1},
        },
    ]
    for name, cellset, formulation in zip(
        ["left", "right"], "ab", formulations, strict=True
    ):
        section = {
            "command": "section.add",
            "name": name,
            "cellset": cellset,
            "material": "compressible" if formulation == "u" else "rubber",
            "formulation": formulation,
        }
        if formulation == "u-p-J":
            section["bulk"] = 5000
        commands.append(section)
    commands += [
        {"command": "pointset.add", "name": "l", "select": {"axis": "x", "value": 0}},
        {"command": "pointset.add", "name": "r", "select": {"axis": "x", "value": 3}},
        {
            "command": "boundary.add",
            "name": "fixed",
            "pointset": "l",
            "constrained": ["x", "y", "z"],
        },
        {
            "command": "boundary.add",
            "name": "move",
            "pointset": "r",
            "constrained": ["x"],
        },
        {
            "command": "step.add",
            "name": "step_1",
            "ramp": {"num": 3, "items": [{"target": "move", "end": 0.3}]},
        },
        {"command": "job.add", "name": "job_1", "steps": ["step_1"], "curve": "move"},
    ]
    namespace = run({"schema_version": 3, "commands": commands}, tmp_path, monkeypatch)
    force = namespace["job_1"].y[-1][0]
    # the force of the linear hexahedra with the same formulations (the quadratic
    # tetrahedra are softer and closer to the quadratic hexahedra, about 0.283)
    reference = {("u", "u-p-J"): 0.3066, ("u-p-J", "u-p-J"): 0.2853}[formulations]
    assert force == pytest.approx(reference, rel=0.1)


def test_tolerance(two_sections, tmp_path, monkeypatch):
    mesh, tag = bar()
    write(tmp_path / "specimen.vtu", mesh, tag)
    assert "job_1.evaluate(x0=field)\n" in codegen(two_sections)
    for cmd in two_sections["commands"]:
        if cmd["command"] == "job.add":
            cmd["tol"] = 0.05
    assert "job_1.evaluate(x0=field, tol=0.05)\n" in codegen(two_sections)
    run(two_sections, tmp_path, monkeypatch)


def test_ramp_of_items_with_their_own_values(two_sections, tmp_path, monkeypatch):
    mesh, tag = bar()
    write(tmp_path / "specimen.vtu", mesh, tag)
    step = next(c for c in two_sections["commands"] if c["command"] == "step.add")
    step["ramp"]["items"].append({"target": "fixed", "start": 0, "end": 0})
    script = codegen(two_sections)
    assert "ramp_step_1 = [\n" in script
    assert "    fem.math.linsteps([0, 0.5], num=5),  # move\n" in script
    assert 'boundaries["fixed"]: ramp_step_1[1]}' in script
    namespace = run(two_sections, tmp_path, monkeypatch)
    ramp = namespace["step_1"].ramp
    boundaries = namespace["boundaries"]
    np.testing.assert_allclose(ramp[boundaries["move"]], np.linspace(0, 0.5, 6))
    np.testing.assert_allclose(ramp[boundaries["fixed"]], 0)
    assert force(namespace)[-1] > 0


def test_point_set_by_coordinates(two_sections, tmp_path, monkeypatch):
    mesh, tag = bar()
    write(tmp_path / "specimen.vtu", mesh, tag)
    corners = {
        "command": "pointset.add",
        "name": "corners",
        "select": {"points": [[0, 0, 0], [3, 1, 1.0]]},
    }
    two_sections["commands"].insert(9, corners)
    script = codegen(two_sections)
    assert "corners = points_at(points, [[0, 0, 0], [3, 1, 1.0]])\n" in script
    namespace = run(two_sections, tmp_path, monkeypatch)
    points = namespace["points"][namespace["corners"]]
    np.testing.assert_allclose(points, [[0, 0, 0], [3, 1, 1]])

    # many points are wrapped like ruff format does it, with a tolerance
    corners["select"] = {
        "points": [[0, y / 4, z / 4] for y in range(5) for z in range(5)],
        "atol": 1e-6,
    }
    long = codegen(two_sections)
    assert max(len(line) for line in long.splitlines()) <= 88
    assert "    atol=1e-06,\n" in long
    namespace = run(two_sections, tmp_path, monkeypatch)
    assert namespace["corners"].sum() == 25
    ruff = shutil.which("ruff")
    if ruff:
        path = tmp_path / "script.py"
        path.write_text(long, encoding="utf-8")
        fmt = [ruff, "format", "--isolated", "--check", str(path)]
        assert subprocess.run(fmt, capture_output=True).returncode == 0

    # a coordinate without a point is an error of the script
    corners["select"] = {"points": [[0, 0, 0], [0.1, 0, 0]]}
    with pytest.raises(ValueError, match=r"no point at \[\[0.1, 0.0, 0.0\]\]"):
        run(two_sections, tmp_path, monkeypatch)


def test_control_point(two_sections, tmp_path, monkeypatch):
    mesh, tag = bar()
    write(tmp_path / "specimen.vtu", mesh, tag)
    commands = two_sections["commands"]
    commands.insert(
        9, {"command": "point.add", "name": "control", "coordinates": [4, 0.5, 0.5]}
    )
    pin = {
        "command": "boundary.add",
        "name": "pin",
        "pointset": "control",
        "constrained": ["x", "y", "z"],
    }
    commands.insert(12, pin)
    script = codegen(two_sections)
    assert "region_control_points = vertex_region([[4, 0.5, 0.5]])\n" in script
    assert "field_section_soft, field_control_points]" in script
    assert "control = points_at(points, [4, 0.5, 0.5])\n" in script
    namespace = run(two_sections, tmp_path, monkeypatch)
    points = namespace["points"]
    np.testing.assert_allclose(points[namespace["control"]], [[4, 0.5, 0.5]])
    # the control point is the last point of the merged field, without stiffness
    assert np.flatnonzero(namespace["control"]).tolist() == [len(points) - 1]
    assert force(namespace)[-1] > 0

    # without a boundary of all components, it has no stiffness
    pin["constrained"] = ["x", "y"]
    with pytest.raises(ValidationError, match="'control' has no stiffness"):
        codegen(two_sections)


def test_multi_point_constraint(two_sections, tmp_path, monkeypatch):
    mesh, tag = bar()
    write(tmp_path / "specimen.vtu", mesh, tag)
    commands = two_sections["commands"]
    # the right end face follows a control point that is moved in x
    controls = [
        {"command": "point.add", "name": "plate", "coordinates": [3.5, 0.5, 0.5]},
        {"command": "point.add", "name": "turn", "coordinates": [4, 0.5, 0.5]},
    ]
    commands[9:9] = controls
    move = next(c for c in commands if c["name"] == "move")
    move.update(pointset="plate")
    hold = {
        "command": "boundary.add",
        "name": "hold",
        "pointset": "plate",
        "constrained": ["y", "z"],
    }
    turn = {
        "command": "boundary.add",
        "name": "locked",
        "pointset": "turn",
        "constrained": ["x", "y", "z"],
    }
    mpc = {
        "command": "mpc.add",
        "name": "glue",
        "points": "right",
        "center": "plate",
        "constrained": ["x", "y", "z"],
        "rotation": "turn",
    }
    index = next(i for i, c in enumerate(commands) if c["command"] == "step.add")
    commands[index:index] = [hold, turn, mpc]
    script = codegen(two_sections)
    assert "glue = fem.MultiPointConstraint(\n    field,\n" in script
    assert '    centerpoint=single_point(plate, "plate"),\n' in script
    assert '    rotationpoint=single_point(turn, "turn"),\n' in script
    assert "items=[solid_section_hard, solid_section_soft, glue]" in script
    namespace = run(two_sections, tmp_path, monkeypatch)
    points = namespace["points"]
    u = namespace["field"][0].values
    right = namespace["right"]
    # the end face moves rigidly with the control point
    np.testing.assert_allclose(u[right], [[0.5, 0, 0]] * right.sum(), atol=1e-3)
    assert force(namespace)[-1] > 0
    assert np.flatnonzero(namespace["plate"])[0] == len(points) - 2

    # skipped components without a rotation point, and the default multiplier
    del mpc["rotation"]
    mpc.update(constrained=["x"], multiplier=5000.0)
    script = codegen(two_sections)
    assert "    skip=(False, True, True),\n    multiplier=5000.0,\n)" in script

    # a center point of more than one point is an error of the script
    mpc.update(center="right", constrained=["x", "y", "z"])
    move.update(pointset="right")
    commands.remove(hold)
    commands.remove(controls[0])
    with pytest.raises(ValueError, match="'right' has 25 points, not one"):
        run(two_sections, tmp_path, monkeypatch)


def test_rotation_point_and_moment(two_sections, tmp_path, monkeypatch):
    mesh, tag = bar()
    write(tmp_path / "specimen.vtu", mesh, tag)
    commands = two_sections["commands"]
    # the right end face is twisted about x by a rotation point (#98)
    commands[9:9] = [
        {"command": "point.add", "name": "plate", "coordinates": [3.5, 0.5, 0.5]},
        {"command": "point.add", "name": "turn", "coordinates": [4, 0.5, 0.5]},
    ]
    move = next(c for c in commands if c["name"] == "move")
    move.update(pointset="turn", constrained=["x"])
    index = next(i for i, c in enumerate(commands) if c["command"] == "step.add")
    commands[index:index] = [
        {
            "command": "boundary.add",
            "name": "hold",
            "pointset": "plate",
            "constrained": ["x", "y", "z"],
        },
        {
            "command": "boundary.add",
            "name": "axis",
            "pointset": "turn",
            "constrained": ["y", "z"],
        },
        {
            "command": "mpc.add",
            "name": "glue",
            "points": "right",
            "center": "plate",
            "constrained": ["x", "y", "z"],
            "rotation": "turn",
        },
    ]
    step = next(c for c in commands if c["command"] == "step.add")
    step["ramp"] = {"num": 2, "items": [{"target": "move", "end": 0.1}]}
    namespace = run(two_sections, tmp_path, monkeypatch)
    points = namespace["points"]
    u = namespace["field"][0].values
    right = namespace["right"]

    # the points of the end face are rotated by 0.1 rad about x through the center
    angle = 0.1
    rotation = np.array(
        [
            [1, 0, 0],
            [0, np.cos(angle), -np.sin(angle)],
            [0, np.sin(angle), np.cos(angle)],
        ]
    )
    arms = points[right] - [3.5, 0.5, 0.5]
    np.testing.assert_allclose(u[right], arms @ rotation.T - arms, atol=1e-3)

    # the curve of the rotation point: the moment over the rotation
    job = namespace["job_1"]
    rotations = np.array(job.x)[:, 0]
    moments = np.array(job.y)[:, 0]
    np.testing.assert_allclose(rotations, [0, 0.05, 0.1])
    assert 0 < moments[1] < moments[2]
    np.testing.assert_allclose(
        moments[-1], namespace["glue"].results.moment[0], rtol=1e-6
    )


def test_point_load(two_sections, tmp_path, monkeypatch):
    mesh, tag = bar()
    write(tmp_path / "specimen.vtu", mesh, tag)
    commands = two_sections["commands"]
    # the right end face is pulled by a force at a control point (#100)
    commands[9:9] = [
        {"command": "point.add", "name": "plate", "coordinates": [3.5, 0.5, 0.5]},
    ]
    commands[:] = [c for c in commands if c["name"] != "move"]
    index = next(i for i, c in enumerate(commands) if c["command"] == "step.add")
    commands[index:index] = [
        {
            "command": "mpc.add",
            "name": "glue",
            "points": "right",
            "center": "plate",
            "constrained": ["x", "y", "z"],
        },
        {"command": "load.add", "name": "pull", "points": "plate", "force": [2, 0, 0]},
    ]
    step = next(c for c in commands if c["command"] == "step.add")
    step["ramp"] = {"num": 4, "items": [{"target": "pull", "end": 1}]}
    job = next(c for c in commands if c["command"] == "job.add")
    job["curve"] = "pull"
    script = codegen(two_sections)
    assert "pull = fem.PointLoad(field, points=plate, values=[2, 0, 0])\n" in script
    assert "ramp={pull: np.outer(ramp_step_1, [2, 0, 0])}" in script
    assert "items=[solid_section_hard, solid_section_soft, glue, pull]" in script
    items = "items=[solid_section_hard, solid_section_soft, glue]"
    assert f"boundary=pull, {items}" in script
    namespace = run(two_sections, tmp_path, monkeypatch)
    curve = namespace["job_1"]
    forces = np.array(curve.y)[:, 0]
    moves = np.array(curve.x)[:, 0]
    # the force over the displacement of the control point
    np.testing.assert_allclose(forces, [0, 0.5, 1, 1.5, 2], atol=1e-8)
    assert 0 < moves[1] < moves[2] < moves[-1]
    u = namespace["field"][0].values
    np.testing.assert_allclose(u[namespace["plate"]][0, 0], moves[-1])


def test_object_lines_of_the_glued_plate():
    "The script view (#130) highlights the lines of the selected object."
    folder = Path(__file__).parents[1] / "app" / "public" / "samples" / "glued-plate"
    document = json.loads((folder / "model.felupe.json").read_text(encoding="utf-8"))
    script = codegen(document)
    lines = object_lines(script, document)
    text = script.splitlines()

    def code(name):
        return [text[a - 1 : b] for a, b in lines[name]]

    assert set(lines) == {c["name"] for c in document["commands"]}
    assert code("rubber") == [
        ["rubber = fem.Hyperelastic(fem.mooney_rivlin, C10=0.4, C01=0.1)"]
    ]
    # the comment of the units (#132)
    assert code("settings") == [
        [
            "# units: mm (lengths), N (forces) and MPa (stresses); FElupe does not "
            "convert them"
        ]
    ]
    # the region, the field and the solid body of a section
    section = code("rubber_block")
    assert section[0][0].startswith("region_rubber_block = ")
    assert section[0][1].startswith("field_rubber_block = ")
    assert section[1][0].startswith("solid_rubber_block = fem.SolidBody(")
    # an entry of the boundaries, the vertices of the control points
    assert code("shift") == [
        ['    "shift": fem.Boundary(field[0], mask=plate, skip=(0, 1, 1)),']
    ]
    assert code("plate")[0][0].startswith("region_control_points = ")
    assert code("plate")[1] == ["plate = points_at(points, [20, 20, 25])"]
    # the ramp and the step, and the evaluation of the job
    assert code("shift_and_tilt")[0][0].startswith("ramp_shift_and_tilt = [")
    assert code("shift_and_tilt")[0][-1] == ")"
    assert code("job")[-1] == ["job.evaluate(x0=field)"]
    # ranges are sorted and joined
    for ranges in lines.values():
        assert all(a <= b for a, b in ranges)
        assert all(
            b + 1 < c for (_, b), (c, _) in zip(ranges, ranges[1:], strict=False)
        )


def test_object_lines_of_load_cases_and_merged_fields():
    document = {
        "schema_version": 3,
        "commands": [
            {"command": "mesh.import", "name": "bar", "file": "bar.vtu"},
            {"command": "mesh.merge", "name": "merge", "decimals": 6},
            {"command": "cellset.from_file", "name": "cells", "mesh": "bar"},
            {
                "command": "material.add",
                "name": "nh",
                "model": "NeoHooke",
                "parameters": {"mu": 1, "bulk": 5000},
            },
            {
                "command": "section.add",
                "name": "body",
                "cellset": "cells",
                "material": "nh",
                "formulation": "u",
            },
            {"command": "loadcase.add", "name": "pull", "type": "uniaxial"},
        ],
    }
    script = codegen(document, evaluate=False)
    lines = object_lines(script, document)
    text = script.splitlines()
    assert text[lines["merge"][0][0] - 1].startswith("field = fem.field.merge(")
    pull = [text[a - 1] for a, _ in lines["pull"]]
    assert pull[0].startswith("pull = fem.dof.uniaxial(")
    assert pull[1].strip().startswith('**{f"pull/{k}"')
