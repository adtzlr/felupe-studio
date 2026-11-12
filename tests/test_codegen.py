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


def volumetric_bar(volumetric):
    """The bar of a rubber in the u-p-J formulation with a small bulk modulus."""
    upj = {**section("body", "all_cells", "rubber"), "formulation": "u-p-J"}
    upj["bulk"] = 10
    if volumetric is not None:
        upj["volumetric"] = volumetric
    return {
        "schema_version": 3,
        "commands": [
            {"command": "mesh.import", "name": "specimen", "file": "bar.vtu"},
            {"command": "cellset.from_file", "name": "all_cells", "mesh": "specimen"},
            {
                "command": "material.add",
                "name": "rubber",
                "model": "NeoHooke",
                "parameters": {"mu": 1.0},
            },
            upj,
            *uniaxial(),
        ],
    }


@pytest.mark.parametrize("volumetric", ["volume-ratio", "stretch", "log"])
def test_volumetric_matches_felupe(volumetric, tmp_path, monkeypatch):
    # the volumetric part of the strain energy of the u-p-J formulation (#134)
    mesh, _ = bar()
    write(tmp_path / "bar.vtu", mesh)
    document = volumetric_bar(volumetric)
    script = codegen(document)
    if volumetric == "volume-ratio":
        assert "fem.NearlyIncompressible(rubber, bulk=10)" in script
        assert codegen(volumetric_bar(None)) == script
    else:
        assert f'bulk=10, volumetric="{volumetric}")' in script
    curve = force(run(document, tmp_path, monkeypatch))

    field = fem.FieldsMixed(fem.RegionHexahedron(mesh), n=3)
    x = mesh.points[:, 0]
    boundaries = {
        "fixed": fem.Boundary(field[0], mask=np.isclose(x, 0)),
        "move": fem.Boundary(field[0], mask=np.isclose(x, 3), skip=(0, 1, 1)),
    }
    umat = fem.NearlyIncompressible(
        fem.NeoHooke(mu=1.0), bulk=10, volumetric=volumetric
    )
    solid = fem.SolidBody(umat, field)
    move = fem.math.linsteps([0, 0.5], num=5)
    step = fem.Step([solid], ramp={boundaries["move"]: move}, boundaries=boundaries)
    job = fem.CharacteristicCurve(steps=[step], boundary=boundaries["move"])
    job.evaluate(verbose=0)
    reference = np.array(job.y)[:, 0]
    np.testing.assert_allclose(curve, reference, rtol=1e-8, atol=1e-12)

    # the kinds differ: the derivatives of U(J) at J = 1.2
    default = fem.NearlyIncompressible(fem.NeoHooke(mu=1.0), bulk=10)
    J = np.array([1.2])
    same = np.isclose(umat.volumetric.dUdJ(J), default.volumetric.dUdJ(J))
    assert same.all() == (volumetric == "volume-ratio")


def test_volumetric_needs_u_p_j(tmp_path):
    document = volumetric_bar("log")
    document["commands"][3]["formulation"] = "u"
    del document["commands"][3]["bulk"]
    with pytest.raises(ValidationError):
        codegen(document)


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

    # the right half in metres of the model in millimetres, scaled by 1000 (#135):
    # the scaled points coincide with the left half, the point sets by coordinates
    # are in the scaled coordinates
    right = fem.Cube(a=(1.5, 0, 0), b=(3, 1, 1), n=(7, 5, 5))
    write(tmp_path / "right_m.vtu", right.copy(points=right.points / 1000))
    files["commands"][1].update(file="right_m.vtu", scale=1000)
    assert 'volume_cells(meshio.read("right_m.vtu"), scale=1000)' in codegen(files)
    namespace = run(files, tmp_path, monkeypatch)
    assert len(namespace["points"]) == mesh.npoints
    assert np.allclose(force(namespace), reference)
    # a scale of 1 is not written
    files["commands"][1].update(file="right.vtu", scale=1)
    assert 'volume_cells(meshio.read("right.vtu"))' in codegen(files)


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

    # the material of a section in a nested call that is exploded (#134)
    for cmd in ramped["commands"]:
        if cmd["command"] == "section.add" and cmd["formulation"] == "u-p-J":
            cmd["volumetric"] = "stretch"
            cmd["bulk"] = 5000.0
    nested = codegen(ramped)
    assert "    fem.NearlyIncompressible(\n" in nested
    assert max(len(line) for line in nested.splitlines()) <= 88

    ruff = shutil.which("ruff")
    if ruff:
        for text in (script, long, own, nested):
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


def test_face_sets(two_sections, tmp_path, monkeypatch):
    "Face sets (#142): boundary regions of the sections, with a linked field."
    mesh, tag = bar()
    write(tmp_path / "specimen.vtu", mesh, tag)
    commands = two_sections["commands"]
    # the right end face of the soft section, and picked faces of the hard one
    end = {
        "command": "faceset.add",
        "name": "end",
        "section": "section_soft",
        "select": {"axis": "x", "value": 3},
    }
    picked = {
        "command": "faceset.add",
        "name": "picked",
        "section": "section_hard",
        "select": {"centers": [[0.125, 0.125, 1.0], [0.375, 0.125, 1.0]]},
    }
    commands[9:9] = [end, picked]
    script = codegen(two_sections)
    assert "region_end = boundary_faces(region_section_soft.mesh, plane=(0, 3))\n" in (
        script
    )
    assert "field_end = fem.FieldContainer([fem.Field(region_end, dim=3)])\n" in script
    assert "field_end.link(field)\n" in script
    # the script without the evaluation of the jobs (which link the fields of their
    # items again)
    path = tmp_path / "script.py"
    path.write_text(codegen(two_sections, evaluate=False), encoding="utf-8")
    monkeypatch.chdir(tmp_path)
    namespace = runpy.run_path(str(path))
    # 4 x 4 faces on the end face, their area and their outward normal
    region = namespace["region_end"]
    assert len(region.mesh.cells) == 16
    np.testing.assert_allclose(region.dV.sum(), 1.0)
    np.testing.assert_allclose(region.normals[0], 1.0)
    # the field shares the values of the merged field
    assert namespace["field_end"][0].values is namespace["field"][0].values
    # the picked faces on the top face, with the normal z
    region = namespace["region_picked"]
    assert len(region.mesh.cells) == 2
    np.testing.assert_allclose(region.normals[2], 1.0)
    centers = region.mesh.points[region.mesh.cells_faces].mean(axis=1)
    np.testing.assert_allclose(
        centers[np.argsort(centers[:, 0])], picked["select"]["centers"]
    )

    # the helpers of face sets are only in scripts with face sets
    assert "def boundary_faces(" in script
    assert "def boundary_faces(" not in codegen(
        {**two_sections, "commands": commands[:9] + commands[11:]}
    )
    ruff = shutil.which("ruff")
    if ruff:
        lint = [ruff, "check", "--isolated", "--select", "E,F,W,I", str(path)]
        assert subprocess.run(lint, capture_output=True).returncode == 0
        fmt = [ruff, "format", "--isolated", "--check", str(path)]
        assert subprocess.run(fmt, capture_output=True).returncode == 0

    # the lines of a face set in the script view
    lines = object_lines(script, two_sections)
    text = script.splitlines()
    assert [text[a - 1 : b] for a, b in lines["end"]] == [
        [
            "region_end = boundary_faces(region_section_soft.mesh, plane=(0, 3))",
            "field_end = fem.FieldContainer([fem.Field(region_end, dim=3)])",
            "field_end.link(field)",
        ]
    ]

    # a center without a face, and a tolerance
    picked["select"] = {"centers": [[0.1, 0.1, 1.0]]}
    with pytest.raises(ValueError, match=r"no face with the center \[\[0.1"):
        run(two_sections, tmp_path, monkeypatch)
    picked["select"]["atol"] = 0.05
    assert "atol=0.05" in codegen(two_sections)
    namespace = run(two_sections, tmp_path, monkeypatch)
    assert len(namespace["region_picked"].mesh.cells) == 1

    # the section must be a section
    end["section"] = "hard"
    with pytest.raises(ValidationError, match="is a cellset, not a section"):
        codegen(two_sections)


def test_boundary_faces():
    "The faces of picked centers are exact, also in a ring around a face (#142)."
    from felupe_studio._helpers import boundary_faces

    quadratic = fem.Cube(n=4).add_midpoints_edges()
    for mesh in [
        fem.Cube(n=4),
        quadratic,
        quadratic.add_midpoints_faces().add_midpoints_volumes(),
    ]:
        faces = boundary_faces(mesh, plane=(2, 1.0))
        assert len(faces.mesh.cells) == 9
        middle = mesh.points[faces.mesh.cells_faces].mean(axis=1)
        # a ring of 8 faces around the face in the middle: its points are all in
        # the ring, but it is not picked
        ring = middle[np.linalg.norm(middle[:, :2] - 0.5, axis=1) > 1e-8]
        assert len(boundary_faces(mesh, centers=ring).mesh.cells) == 8
        # three faces of a corner cell
        corner = [[0.0, 1 / 6, 1 / 6], [1 / 6, 0.0, 1 / 6], [1 / 6, 1 / 6, 0.0]]
        assert len(boundary_faces(mesh, centers=corner).mesh.cells) == 3

    # both sides of a plate of one cell: the points select the rim too
    plate = fem.Cube(b=(1, 1, 0.1), n=(3, 3, 2))
    centers = [[0.25, 0.25, 0.0], [0.25, 0.25, 0.1], [0.75, 0.25, 0.0]]
    with pytest.raises(ValueError, match="take the faces of one side"):
        boundary_faces(plate, centers=centers)
    # tetrahedrons have no boundary region in FElupe 12
    with pytest.raises(NotImplementedError, match="tetra cells"):
        boundary_faces(fem.Cube(n=2).triangulate(), plane=(2, 1.0))


def test_pressure(tmp_path, monkeypatch):
    "A pressure on a face set is in equilibrium with the reactions (#105)."
    golden = Path(__file__).parent / "golden" / "block_pressure"
    document = json.loads((golden / "commands.json").read_text(encoding="utf-8"))
    shutil.copy(golden / "block.vtu", tmp_path)
    namespace = run(document, tmp_path, monkeypatch)
    # the end face x = 1 of the unit cube is pulled by 0.5 per deformed area: the
    # deformation is homogeneous, and the reaction at x = 0 is the pressure times
    # the deformed area of the end face
    u = namespace["field"][0].values
    points = namespace["field"].mesh_container.points
    corner = np.flatnonzero(np.all(np.isclose(points, 1), axis=1))[0]
    stretch = 1 + u[corner]
    assert stretch[0] > 1 > stretch[1]
    np.testing.assert_allclose(stretch[1], stretch[2])
    job = namespace["job_1"]
    reaction = np.array(job.y)[-1, 0]
    np.testing.assert_allclose(reaction, -0.5 * stretch[1] * stretch[2], rtol=1e-8)

    # a positive pressure pushes onto the faces, and a step without a ramp applies
    # it in full
    for command in document["commands"]:
        if command["command"] == "pressure.add":
            command["pressure"] = 0.2
        if command["command"] == "step.add":
            del command["ramp"]
    script = codegen(document)
    assert "items=[solid_body, pull]," in script
    namespace = run(document, tmp_path, monkeypatch)
    u = namespace["field"][0].values
    assert u[corner, 0] < 0 < u[corner, 1]

    # the step lists its pressures as loads, and a pressure is not a curve
    document["commands"][-2]["loads"] = ["end"]
    with pytest.raises(ValidationError, match="is a faceset, not a load or pressure"):
        codegen(document)
    del document["commands"][-2]["loads"]
    document["commands"][-1]["curve"] = "pull"
    with pytest.raises(ValidationError, match="is a pressure, not a boundary or load"):
        codegen(document)
